mod apple_fm;
mod llm;
#[cfg(target_os = "macos")]
mod macos_install;

use llm::{categorize_llm_debug, categorize_with_llm, llm_status, LlmState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "macos")]
  macos_install::relocate_if_needed();

  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(LlmState::new())
    .invoke_handler(tauri::generate_handler![
      llm_status,
      categorize_with_llm,
      categorize_llm_debug
    ])
    .setup(|app| {
      #[cfg(not(any(target_os = "android", target_os = "ios")))]
      app
        .handle()
        .plugin(tauri_plugin_updater::Builder::new().build())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
