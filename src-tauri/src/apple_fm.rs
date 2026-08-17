//! FFI to the optional Swift Apple Foundation Models bridge.
//!
//! Compiled only when `build.rs` successfully builds `libuebrig_apple_fm.a`
//! (`cfg(uebrig_apple_fm)`).

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[cfg(uebrig_apple_fm)]
unsafe extern "C" {
  fn uebrig_apple_fm_available() -> i32;
  #[allow(dead_code)]
  fn uebrig_apple_fm_categorize(
    transactions_json: *const c_char,
    category_ids_json: *const c_char,
  ) -> *mut c_char;
  fn uebrig_apple_fm_complete(prompt: *const c_char) -> *mut c_char;
  fn uebrig_apple_fm_free(ptr: *mut c_char);
}

fn take_c_string(ptr: *mut c_char) -> Option<String> {
  if ptr.is_null() {
    return None;
  }
  unsafe {
    let s = CStr::from_ptr(ptr).to_string_lossy().into_owned();
    #[cfg(uebrig_apple_fm)]
    uebrig_apple_fm_free(ptr);
    #[cfg(not(uebrig_apple_fm))]
    let _ = ptr;
    Some(s)
  }
}

/// True when Apple on-device Foundation Models are ready right now.
pub fn apple_fm_available() -> bool {
  #[cfg(uebrig_apple_fm)]
  unsafe {
    return uebrig_apple_fm_available() != 0;
  }
  #[cfg(not(uebrig_apple_fm))]
  {
    false
  }
}

/// Run a single free-form prompt. Returns the model text.
pub fn complete(prompt: &str) -> Result<String, String> {
  #[cfg(not(uebrig_apple_fm))]
  {
    let _ = prompt;
    return Err("Apple Foundation Models bridge not linked".into());
  }

  #[cfg(uebrig_apple_fm)]
  {
    if !apple_fm_available() {
      return Err("Apple Foundation Models unavailable".into());
    }
    let prompt_c = CString::new(prompt).map_err(|_| "prompt contained NUL")?;
    let ptr = unsafe { uebrig_apple_fm_complete(prompt_c.as_ptr()) };
    take_c_string(ptr).ok_or_else(|| "Apple FM returned no result".to_string())
  }
}

/// Run categorization via Apple FM. Inputs/outputs are JSON strings matching
/// the frontend/Rust `LlmTransactionInput` / `LlmCategoryAssignment` shapes.
#[allow(dead_code)]
pub fn categorize_json(
  transactions_json: &str,
  category_ids_json: &str,
) -> Result<String, String> {
  #[cfg(not(uebrig_apple_fm))]
  {
    let _ = (transactions_json, category_ids_json);
    return Err("Apple Foundation Models bridge not linked".into());
  }

  #[cfg(uebrig_apple_fm)]
  {
    if !apple_fm_available() {
      return Err("Apple Foundation Models unavailable".into());
    }

    let tx_c =
      CString::new(transactions_json).map_err(|_| "transactions JSON contained NUL")?;
    let cat_c =
      CString::new(category_ids_json).map_err(|_| "categories JSON contained NUL")?;

    let ptr = unsafe { uebrig_apple_fm_categorize(tx_c.as_ptr(), cat_c.as_ptr()) };
    take_c_string(ptr).ok_or_else(|| "Apple FM returned no result".to_string())
  }
}
