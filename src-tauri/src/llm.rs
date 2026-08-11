//! Local LLM auto-categorization for bank transactions.
//!
//! Preference order:
//! 1. Apple on-device Foundation Models (macOS 26+, Apple Intelligence)
//! 2. Bundled GGUF via llama.cpp (~380 MB Qwen2.5-0.5B)

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaChatTemplate, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::apple_fm;

pub const MODEL_FILE: &str = "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf";

/// Max new tokens — category ids are short.
const MAX_NEW_TOKENS: i32 = 24;
const N_CTX: u32 = 2048;

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

  fn categorize_one(
    &mut self,
    tx: &LlmTransactionInput,
    allowed: &[String],
  ) -> Result<String, String> {
    let backend = self
      .backend
      .as_ref()
      .ok_or_else(|| "LLM backend not loaded".to_string())?;
    let model = self
      .model
      .as_ref()
      .ok_or_else(|| "LLM model not loaded".to_string())?;

    let allowed_list = allowed.join(", ");
    let system = format!(
      "You categorize German bank transactions. \
Reply with ONLY one category id from this list: {allowed_list}. \
No punctuation, no explanation."
    );
    let user = format!(
      "Counterparty: {}\nPurpose: {}\nType: {}\nAmount EUR: {:.2}\n\nCategory id:",
      truncate(&tx.counterparty, 120),
      truncate(&tx.purpose, 200),
      truncate(&tx.booking_type, 40),
      tx.amount
    );

    let prompt = build_prompt(model, &system, &user)?;

    let ctx_params = LlamaContextParams::default()
      .with_n_ctx(NonZeroU32::new(N_CTX))
      .with_n_batch(512);

    let mut ctx = model
      .new_context(backend, ctx_params)
      .map_err(|e| format!("LLM context failed: {e}"))?;

    let tokens = model
      .str_to_token(&prompt, AddBos::Always)
      .map_err(|e| format!("Tokenize failed: {e}"))?;

    if tokens.is_empty() {
      return Err("Empty prompt tokens".into());
    }
    if tokens.len() as u32 >= N_CTX.saturating_sub(MAX_NEW_TOKENS as u32) {
      return Err("Prompt too long for context".into());
    }

    let mut batch = LlamaBatch::new(512, 1);
    let last = (tokens.len() - 1) as i32;
    for (i, token) in (0_i32..).zip(tokens.into_iter()) {
      batch
        .add(token, i, &[0], i == last)
        .map_err(|e| format!("Batch add failed: {e}"))?;
    }
    ctx
      .decode(&mut batch)
      .map_err(|e| format!("Prompt decode failed: {e}"))?;

    let grammar = category_grammar(allowed);
    let mut sampler = match LlamaSampler::grammar(model, &grammar, "root") {
      Ok(g) => LlamaSampler::chain_simple([g, LlamaSampler::greedy()]),
      Err(_) => LlamaSampler::chain_simple([LlamaSampler::greedy()]),
    };

    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut output = String::new();
    let mut n_cur = batch.n_tokens();

    for _ in 0..MAX_NEW_TOKENS {
      let token = sampler.sample(&ctx, batch.n_tokens() - 1);
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
        .decode(&mut batch)
        .map_err(|e| format!("Decode failed: {e}"))?;
      n_cur += 1;

      let cleaned = normalize_category(&output);
      if allowed.iter().any(|id| id == &cleaned) {
        return Ok(cleaned);
      }
    }

    let cleaned = normalize_category(&output);
    if allowed.iter().any(|id| id == &cleaned) {
      Ok(cleaned)
    } else {
      Err(format!("Model returned invalid category: {output:?}"))
    }
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

fn category_grammar(allowed: &[String]) -> String {
  // GBNF: root ::= "groceries" | "transport" | ...
  let alts = allowed
    .iter()
    .map(|id| format!("\"{}\"", id.replace('\\', "\\\\").replace('"', "\\\"")))
    .collect::<Vec<_>>()
    .join(" | ");
  format!("root ::= {alts}\n")
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
  let engine = state.inner.lock().expect("llm mutex");
  match path_result {
    Ok(_) => LlmStatus {
      available: true,
      model: MODEL_FILE.to_string(),
      provider: "bundled".into(),
      loaded: engine.model.is_some(),
      error: engine.last_error.clone(),
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

#[tauri::command]
pub fn categorize_with_llm(
  app: AppHandle,
  state: State<'_, LlmState>,
  transactions: Vec<LlmTransactionInput>,
  category_ids: Vec<String>,
) -> Result<CategorizeWithLlmResult, String> {
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

  // Prefer Apple on-device Foundation Models when ready.
  if apple_fm::apple_fm_available() {
    match categorize_via_apple(&transactions, &allowed) {
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
      }
    }
  }

  let path = resolve_model_path(&app)?;
  let mut engine = state.inner.lock().map_err(|_| "LLM state lock poisoned")?;

  if let Err(e) = engine.ensure_loaded(&path) {
    engine.last_error = Some(e.clone());
    return Err(e);
  }

  let mut out = Vec::with_capacity(transactions.len());
  for tx in &transactions {
    match engine.categorize_one(tx, &allowed) {
      Ok(category_id) => out.push(LlmCategoryAssignment {
        id: tx.id.clone(),
        category_id,
      }),
      Err(e) => {
        log::warn!("LLM skip {}: {e}", tx.id);
      }
    }
  }

  Ok(CategorizeWithLlmResult {
    assignments: out,
    provider: "bundled".into(),
  })
}

fn categorize_via_apple(
  transactions: &[LlmTransactionInput],
  allowed: &[String],
) -> Result<Vec<LlmCategoryAssignment>, String> {
  let tx_json =
    serde_json::to_string(transactions).map_err(|e| format!("serialize tx: {e}"))?;
  let cat_json =
    serde_json::to_string(allowed).map_err(|e| format!("serialize categories: {e}"))?;
  let raw = apple_fm::categorize_json(&tx_json, &cat_json)?;
  let parsed: Vec<LlmCategoryAssignment> =
    serde_json::from_str(&raw).map_err(|e| format!("parse Apple FM result: {e}"))?;

  let allowed_set: std::collections::HashSet<&str> =
    allowed.iter().map(String::as_str).collect();
  Ok(
    parsed
      .into_iter()
      .filter(|a| allowed_set.contains(a.category_id.as_str()))
      .collect(),
  )
}
