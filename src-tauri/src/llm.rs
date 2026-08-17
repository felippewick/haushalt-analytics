//! Local LLM auto-categorization for bank transactions.
//!
//! Preference order:
//! 1. Apple on-device Foundation Models (macOS 26+, Apple Intelligence)
//! 2. Bundled GGUF via llama.cpp (~940 MB Qwen2.5-1.5B)

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::context::LlamaContext;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::apple_fm;

pub const MODEL_FILE: &str = "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf";

/// Max new tokens — category ids are short.
const MAX_NEW_TOKENS: i32 = 24;
const N_CTX: u32 = 2048;
/// llama.cpp decode batch. Must be ≥ prompt length if we feed the prompt in one go.
const N_BATCH: u32 = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTransactionInput {
  pub id: String,
  pub counterparty: String,
  pub purpose: String,
  pub amount: f64,
  pub booking_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmCategoryAssignment {
  pub id: String,
  pub category_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
  pub available: bool,
  /// `"apple"` | bundled GGUF filename | empty
  pub model: String,
  /// `"apple"` | `"bundled"` | `"none"`
  pub provider: String,
  pub loaded: bool,
  pub error: Option<String>,
}

pub struct LlmState {
  inner: Mutex<LlmEngine>,
}

impl LlmState {
  pub fn new() -> Self {
    Self {
      inner: Mutex::new(LlmEngine::unloaded()),
    }
  }
}

struct LlmEngine {
  backend: Option<LlamaBackend>,
  model: Option<LlamaModel>,
  model_path: Option<PathBuf>,
  last_error: Option<String>,
}

impl LlmEngine {
  fn unloaded() -> Self {
    Self {
      backend: None,
      model: None,
      model_path: None,
      last_error: None,
    }
  }

  fn ensure_loaded(&mut self, path: &Path) -> Result<(), String> {
    if self.model.is_some() {
      return Ok(());
    }

    // Quiet llama.cpp chatter in release; keep failures in last_error.
    let _ = llama_cpp_2::send_logs_to_tracing(
      llama_cpp_2::LogOptions::default().with_logs_enabled(cfg!(debug_assertions)),
    );

    let backend = LlamaBackend::init().map_err(|e| format!("LLM backend init failed: {e}"))?;

    // Offload as many layers as possible (Metal on Apple Silicon; CPU otherwise).
    let model_params = LlamaModelParams::default().with_n_gpu_layers(1000);
    let model = LlamaModel::load_from_file(&backend, path, &model_params)
      .map_err(|e| format!("Failed to load model {}: {e}", path.display()))?;

    self.backend = Some(backend);
    self.model = Some(model);
    self.model_path = Some(path.to_path_buf());
    self.last_error = None;
    Ok(())
  }

  fn categorize_many<F>(
    &mut self,
    transactions: &[LlmTransactionInput],
    allowed: &[String],
    system: &str,
    mut on_progress: F,
  ) -> Result<Vec<LlmCategoryAssignment>, String>
  where
    F: FnMut(u32),
  {
    let backend = self
      .backend
      .as_ref()
      .ok_or_else(|| "LLM backend not loaded".to_string())?;
    let model = self
      .model
      .as_ref()
      .ok_or_else(|| "LLM model not loaded".to_string())?;

    let ctx_params = LlamaContextParams::default()
      .with_n_ctx(NonZeroU32::new(N_CTX))
      .with_n_batch(N_BATCH);
    let mut ctx = model
      .new_context(backend, ctx_params)
      .map_err(|e| format!("LLM context failed: {e}"))?;
    let mut batch = LlamaBatch::new(N_BATCH as usize, 1);

    let mut out = Vec::with_capacity(transactions.len());
    for (i, tx) in transactions.iter().enumerate() {
      ctx.clear_kv_cache();
      match generate_one(model, &mut ctx, &mut batch, tx, allowed, system) {
        Ok((raw, _)) => {
          let cleaned = normalize_category(&raw);
          if allowed.iter().any(|id| id == &cleaned) {
            out.push(LlmCategoryAssignment {
              id: tx.id.clone(),
              category_id: cleaned,
            });
          } else {
            log::warn!("LLM skip {}: invalid category {raw:?}", tx.id);
          }
        }
        Err(e) => {
          log::warn!("LLM skip {} ({}/{}): {e}", tx.id, i + 1, transactions.len());
        }
      }
      on_progress((i + 1) as u32);
    }
    Ok(out)
  }

  fn generate(
    &mut self,
    tx: &LlmTransactionInput,
    allowed: &[String],
    system: &str,
  ) -> Result<(String, String), String> {
    let backend = self
      .backend
      .as_ref()
      .ok_or_else(|| "LLM backend not loaded".to_string())?;
    let model = self
      .model
      .as_ref()
      .ok_or_else(|| "LLM model not loaded".to_string())?;

    let ctx_params = LlamaContextParams::default()
      .with_n_ctx(NonZeroU32::new(N_CTX))
      .with_n_batch(N_BATCH);
    let mut ctx = model
      .new_context(backend, ctx_params)
      .map_err(|e| format!("LLM context failed: {e}"))?;
    let mut batch = LlamaBatch::new(N_BATCH as usize, 1);
    generate_one(model, &mut ctx, &mut batch, tx, allowed, system)
  }
}

/// Greedy decode only. GBNF grammar sampling can `ggml_abort()` when the
/// constraint has no valid next token (common with many category ids).
fn generate_one(
  model: &LlamaModel,
  ctx: &mut LlamaContext,
  batch: &mut LlamaBatch,
  tx: &LlmTransactionInput,
  allowed: &[String],
  system: &str,
) -> Result<(String, String), String> {
  let user = user_prompt(tx);
  let prompt = build_prompt(model, system, &user)?;

  let tokens = model
    .str_to_token(&prompt, AddBos::Always)
    .map_err(|e| format!("Tokenize failed: {e}"))?;

  if tokens.is_empty() {
    return Err("Empty prompt tokens".into());
  }
  if tokens.len() as u32 >= N_CTX.saturating_sub(MAX_NEW_TOKENS as u32) {
    return Err("Prompt too long for context".into());
  }

  let n_batch = N_BATCH as usize;
  let last_idx = tokens.len() - 1;
  for chunk_start in (0..tokens.len()).step_by(n_batch) {
    batch.clear();
    let chunk_end = (chunk_start + n_batch).min(tokens.len());
    for (offset, token) in tokens[chunk_start..chunk_end].iter().enumerate() {
      let pos = (chunk_start + offset) as i32;
      let is_last = chunk_start + offset == last_idx;
      batch
        .add(*token, pos, &[0], is_last)
        .map_err(|e| format!("Batch add failed: {e}"))?;
    }
    ctx
      .decode(batch)
      .map_err(|e| format!("Prompt decode failed: {e}"))?;
  }

  let mut sampler = LlamaSampler::chain_simple([LlamaSampler::greedy()]);
  let mut decoder = encoding_rs::UTF_8.new_decoder();
  let mut output = String::new();
  let mut n_cur = tokens.len() as i32;

  for _ in 0..MAX_NEW_TOKENS {
    let token = sampler.sample(ctx, batch.n_tokens() - 1);
    sampler.accept(token);
    if model.is_eog_token(token) {
      break;
    }
    let piece = model
      .token_to_piece(token, &mut decoder, true, None)
      .map_err(|e| format!("Detokenize failed: {e}"))?;
    output.push_str(&piece);

    batch.clear();
    batch
      .add(token, n_cur, &[0], true)
      .map_err(|e| format!("Batch add failed: {e}"))?;
    ctx
      .decode(batch)
      .map_err(|e| format!("Decode failed: {e}"))?;
    n_cur += 1;

    let cleaned = normalize_category(&output);
    if allowed.iter().any(|id| id == &cleaned) {
      return Ok((output, prompt));
    }
  }

  Ok((output, prompt))
}

fn user_prompt(tx: &LlmTransactionInput) -> String {
  format!(
    "Counterparty: {}\nPurpose: {}\nType: {}\nAmount EUR: {:.2}\n\nCategory id:",
    truncate(&tx.counterparty, 120),
    truncate(&tx.purpose, 200),
    truncate(&tx.booking_type, 40),
    tx.amount
  )
}

fn fallback_system(allowed: &[String]) -> String {
  format!(
    "You categorize German bank transactions. \
Reply with ONLY one category id from this list: {}. \
No punctuation, no explanation.",
    allowed.join(", ")
  )
}

fn resolve_system(system_prompt: Option<String>, allowed: &[String]) -> String {
  match system_prompt {
    Some(s) if !s.trim().is_empty() => s,
    _ => fallback_system(allowed),
  }
}

fn truncate(s: &str, max: usize) -> String {
  let t = s.trim();
  if t.chars().count() <= max {
    return t.to_string();
  }
  t.chars().take(max).collect::<String>() + "…"
}

fn normalize_category(raw: &str) -> String {
  raw
    .trim()
    .trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c == '.')
    .split_whitespace()
    .next()
    .unwrap_or("")
    .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
    .to_ascii_lowercase()
}

fn build_prompt(model: &LlamaModel, system: &str, user: &str) -> Result<String, String> {
  let messages = vec![
    LlamaChatMessage::new("system".into(), system.into())
      .map_err(|e| format!("Chat message failed: {e}"))?,
    LlamaChatMessage::new("user".into(), user.into())
      .map_err(|e| format!("Chat message failed: {e}"))?,
  ];

  let template = match model.chat_template(None) {
    Ok(t) => t,
    Err(_) => LlamaChatTemplate::new("chatml")
      .map_err(|e| format!("Chat template unavailable: {e}"))?,
  };

  match model.apply_chat_template(&template, &messages, true) {
    Ok(p) => Ok(p),
    Err(_) => {
      // Qwen2.5 / ChatML fallback
      Ok(format!(
        "<|im_start|>system\n{system}<|im_end|>\n\
         <|im_start|>user\n{user}<|im_end|>\n\
         <|im_start|>assistant\n"
      ))
    }
  }
}

fn resolve_model_path(app: &AppHandle) -> Result<PathBuf, String> {
  // Packaged app: same relative path as in tauri.conf.json bundle.resources
  let bundled = format!("resources/models/{MODEL_FILE}");
  if let Ok(path) = app
    .path()
    .resolve(&bundled, tauri::path::BaseDirectory::Resource)
  {
    if path.is_file() {
      return Ok(path);
    }
  }

  // Some Tauri layouts flatten the resources/ prefix
  let flat = format!("models/{MODEL_FILE}");
  if let Ok(path) = app
    .path()
    .resolve(&flat, tauri::path::BaseDirectory::Resource)
  {
    if path.is_file() {
      return Ok(path);
    }
  }

  // Dev / `tauri dev`: next to the crate
  let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    .join("resources")
    .join("models")
    .join(MODEL_FILE);
  if dev.is_file() {
    return Ok(dev);
  }

  Err(format!(
    "Bundled model not found (looked for {bundled}). Run: npm run model:download"
  ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorizeWithLlmResult {
  pub assignments: Vec<LlmCategoryAssignment>,
  /// `"apple"` | `"bundled"`
  pub provider: String,
}

#[tauri::command]
pub fn llm_status(app: AppHandle, state: State<'_, LlmState>) -> LlmStatus {
  if apple_fm::apple_fm_available() {
    return LlmStatus {
      available: true,
      model: "Apple Foundation Models".into(),
      provider: "apple".into(),
      loaded: true,
      error: None,
    };
  }

  let path_result = resolve_model_path(&app);
  let (loaded, error) = match state.inner.try_lock() {
    Ok(engine) => (engine.model.is_some(), engine.last_error.clone()),
    Err(_) => (true, None),
  };
  match path_result {
    Ok(_) => LlmStatus {
      available: true,
      model: MODEL_FILE.to_string(),
      provider: "bundled".into(),
      loaded,
      error,
    },
    Err(e) => LlmStatus {
      available: false,
      model: String::new(),
      provider: "none".into(),
      loaded: false,
      error: Some(e),
    },
  }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmProgressPayload {
  done: u32,
  total: u32,
}

fn emit_llm_progress(app: &AppHandle, done: u32, total: u32) {
  let _ = app.emit("llm-progress", LlmProgressPayload { done, total });
}

#[tauri::command]
pub async fn categorize_with_llm(
  app: AppHandle,
  transactions: Vec<LlmTransactionInput>,
  category_ids: Vec<String>,
  system_prompt: Option<String>,
  progress_offset: Option<u32>,
  progress_total: Option<u32>,
) -> Result<CategorizeWithLlmResult, String> {
  tauri::async_runtime::spawn_blocking(move || {
    categorize_with_llm_inner(
      &app,
      transactions,
      category_ids,
      system_prompt,
      progress_offset.unwrap_or(0),
      progress_total,
    )
  })
  .await
  .map_err(|e| format!("LLM worker failed: {e}"))?
}

fn categorize_with_llm_inner(
  app: &AppHandle,
  transactions: Vec<LlmTransactionInput>,
  category_ids: Vec<String>,
  system_prompt: Option<String>,
  progress_offset: u32,
  progress_total: Option<u32>,
) -> Result<CategorizeWithLlmResult, String> {
  let total = progress_total.unwrap_or(transactions.len() as u32);
  emit_llm_progress(app, progress_offset, total);

  if transactions.is_empty() {
    return Ok(CategorizeWithLlmResult {
      assignments: vec![],
      provider: if apple_fm::apple_fm_available() {
        "apple".into()
      } else {
        "bundled".into()
      },
    });
  }

  let allowed: Vec<String> = category_ids
    .into_iter()
    .filter(|id| id != "uncategorized")
    .collect();
  if allowed.is_empty() {
    return Err("No categories available for LLM assignment".into());
  }

  let system = resolve_system(system_prompt, &allowed);

  // Prefer Apple on-device Foundation Models when ready.
  if apple_fm::apple_fm_available() {
    match categorize_via_apple(&transactions, &allowed, &system, |done| {
      emit_llm_progress(app, progress_offset + done, total);
    }) {
      Ok(out) => {
        log::info!(
          "Apple FM categorized {}/{} transactions",
          out.len(),
          transactions.len()
        );
        return Ok(CategorizeWithLlmResult {
          assignments: out,
          provider: "apple".into(),
        });
      }
      Err(e) => {
        log::warn!("Apple FM failed, falling back to bundled model: {e}");
        emit_llm_progress(app, progress_offset, total);
      }
    }
  }

  let path = resolve_model_path(app)?;
  let progress_app = app.clone();
  let state = app.state::<LlmState>();
  let mut engine = state.inner.lock().map_err(|_| "LLM state lock poisoned")?;

  if let Err(e) = engine.ensure_loaded(&path) {
    engine.last_error = Some(e.clone());
    return Err(e);
  }

  let out = engine.categorize_many(&transactions, &allowed, &system, |done| {
    emit_llm_progress(&progress_app, progress_offset + done, total);
  })?;
  log::info!(
    "Bundled LLM categorized {}/{} transactions",
    out.len(),
    transactions.len()
  );

  Ok(CategorizeWithLlmResult {
    assignments: out,
    provider: "bundled".into(),
  })
}

fn categorize_via_apple<F>(
  transactions: &[LlmTransactionInput],
  allowed: &[String],
  system: &str,
  mut on_progress: F,
) -> Result<Vec<LlmCategoryAssignment>, String>
where
  F: FnMut(u32),
{
  let mut out = Vec::with_capacity(transactions.len());
  let mut any_ok = false;
  for (i, tx) in transactions.iter().enumerate() {
    let prompt = format!("{system}\n\n{}", user_prompt(tx));
    let raw = match apple_fm::complete(&prompt) {
      Ok(raw) => {
        any_ok = true;
        raw
      }
      Err(e) => {
        log::warn!("Apple FM skip {}: {e}", tx.id);
        on_progress((i + 1) as u32);
        continue;
      }
    };
    let cleaned = normalize_category(&raw);
    if allowed.iter().any(|id| id == &cleaned) {
      out.push(LlmCategoryAssignment {
        id: tx.id.clone(),
        category_id: cleaned,
      });
    } else {
      log::warn!("Apple FM skip {}: {raw:?}", tx.id);
    }
    on_progress((i + 1) as u32);
  }
  if !any_ok && !transactions.is_empty() {
    return Err("Apple FM returned no results".into());
  }
  Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmDebugResult {
  pub provider: String,
  pub prompt: String,
  pub raw: String,
  pub category_id: Option<String>,
  pub error: Option<String>,
  pub elapsed_ms: u64,
}

#[tauri::command]
pub async fn categorize_llm_debug(
  app: AppHandle,
  transaction: LlmTransactionInput,
  category_ids: Vec<String>,
  system_prompt: String,
  provider: String,
) -> LlmDebugResult {
  tauri::async_runtime::spawn_blocking(move || {
    categorize_llm_debug_inner(
      &app,
      transaction,
      category_ids,
      system_prompt,
      provider,
    )
  })
  .await
  .unwrap_or_else(|e| LlmDebugResult {
    provider: "bundled".into(),
    prompt: String::new(),
    raw: String::new(),
    category_id: None,
    error: Some(format!("LLM worker failed: {e}")),
    elapsed_ms: 0,
  })
}

fn categorize_llm_debug_inner(
  app: &AppHandle,
  transaction: LlmTransactionInput,
  category_ids: Vec<String>,
  system_prompt: String,
  provider: String,
) -> LlmDebugResult {
  let started = Instant::now();
  let elapsed = || started.elapsed().as_millis() as u64;
  let allowed: Vec<String> = category_ids
    .into_iter()
    .filter(|id| id != "uncategorized")
    .collect();
  if allowed.is_empty() {
    return LlmDebugResult {
      provider,
      prompt: system_prompt,
      raw: String::new(),
      category_id: None,
      error: Some("No categories available".into()),
      elapsed_ms: elapsed(),
    };
  }
  let system = resolve_system(Some(system_prompt), &allowed);
  let user = user_prompt(&transaction);

  if provider == "apple" {
    let prompt = format!("{system}\n\n{user}");
    return match apple_fm::complete(&prompt) {
      Ok(raw) => {
        let cleaned = normalize_category(&raw);
        let category_id = allowed.iter().find(|id| *id == &cleaned).cloned();
        LlmDebugResult {
          provider: "apple".into(),
          prompt,
          raw,
          error: if category_id.is_none() {
            Some(format!("Not an allowed category id (parsed {cleaned:?})"))
          } else {
            None
          },
          category_id,
          elapsed_ms: elapsed(),
        }
      }
      Err(e) => LlmDebugResult {
        provider: "apple".into(),
        prompt,
        raw: String::new(),
        category_id: None,
        error: Some(e),
        elapsed_ms: elapsed(),
      },
    };
  }

  let prompt_preview = format!("{system}\n\n{user}");
  let path = match resolve_model_path(app) {
    Ok(p) => p,
    Err(e) => {
      return LlmDebugResult {
        provider: "bundled".into(),
        prompt: prompt_preview,
        raw: String::new(),
        category_id: None,
        error: Some(e),
        elapsed_ms: elapsed(),
      };
    }
  };
  let state = app.state::<LlmState>();
  let mut engine = match state.inner.lock() {
    Ok(g) => g,
    Err(_) => {
      return LlmDebugResult {
        provider: "bundled".into(),
        prompt: prompt_preview,
        raw: String::new(),
        category_id: None,
        error: Some("LLM state lock poisoned".into()),
        elapsed_ms: elapsed(),
      };
    }
  };
  if let Err(e) = engine.ensure_loaded(&path) {
    engine.last_error = Some(e.clone());
    return LlmDebugResult {
      provider: "bundled".into(),
      prompt: prompt_preview,
      raw: String::new(),
      category_id: None,
      error: Some(e),
      elapsed_ms: elapsed(),
    };
  }
  match engine.generate(&transaction, &allowed, &system) {
    Ok((raw, prompt)) => {
      let cleaned = normalize_category(&raw);
      let category_id = allowed.iter().find(|id| *id == &cleaned).cloned();
      LlmDebugResult {
        provider: "bundled".into(),
        prompt,
        raw,
        error: if category_id.is_none() {
          Some(format!("Not an allowed category id (parsed {cleaned:?})"))
        } else {
          None
        },
        category_id,
        elapsed_ms: elapsed(),
      }
    }
    Err(e) => LlmDebugResult {
      provider: "bundled".into(),
      prompt: prompt_preview,
      raw: String::new(),
      category_id: None,
      error: Some(e),
      elapsed_ms: elapsed(),
    },
  }
}
