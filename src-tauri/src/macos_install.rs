//! Spotlight indexes apps via Launch Services, which only reliably sees
//! bundles in `/Applications` or `~/Applications`. Opening from a DMG or
//! Downloads uses App Translocation, so search never finds "uebrig".

use std::path::{Path, PathBuf};
use std::process::Command;

const LSREGISTER: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

pub fn relocate_if_needed() {
  let Some(bundle) = app_bundle_path() else {
    return;
  };

  register_with_launch_services(&bundle);

  if !needs_relocate(&bundle) {
    return;
  }

  let dest = PathBuf::from("/Applications").join(bundle.file_name().unwrap_or_default());
  if dest == bundle {
    return;
  }

  if !user_wants_move() {
    return;
  }

  let status = Command::new("/usr/bin/ditto")
    .arg(&bundle)
    .arg(&dest)
    .status();
  if !matches!(status, Ok(s) if s.success()) {
    log::warn!("could not copy uebrig to /Applications");
    return;
  }

  let _ = Command::new("/usr/bin/xattr")
    .args(["-d", "com.apple.quarantine"])
    .arg(&dest)
    .status();

  register_with_launch_services(&dest);

  let _ = Command::new("/usr/bin/open").arg(&dest).status();
  std::process::exit(0);
}

fn app_bundle_path() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let bundle = exe.parent()?.parent()?.parent()?;
  if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
    return None;
  }
  Some(bundle.to_path_buf())
}

fn needs_relocate(bundle: &Path) -> bool {
  let path = bundle.to_string_lossy();
  if path.contains("/target/") {
    return false;
  }
  path.contains("/Volumes/")
    || path.contains("AppTranslocation")
    || path.contains("/Downloads/")
}

fn user_wants_move() -> bool {
  let locale = Command::new("/usr/bin/defaults")
    .args(["read", "-g", "AppleLocale"])
    .output()
    .ok()
    .and_then(|o| String::from_utf8(o.stdout).ok())
    .unwrap_or_default();
  let german = locale.trim().starts_with("de");
  let (prompt, cancel, confirm) = if german {
    (
      "uebrig in den Ordner Programme legen, damit Spotlight die App findet?",
      "Nicht jetzt",
      "Bewegen",
    )
  } else {
    (
      "Move uebrig to the Applications folder so Spotlight can find it?",
      "Not Now",
      "Move",
    )
  };
  let script = format!(
    r#"try
  set theButton to button returned of (display dialog "{prompt}" buttons {{"{cancel}", "{confirm}"}} default button "{confirm}" with title "uebrig")
  return theButton
on error
  return "cancel"
end try"#
  );
  let output = Command::new("/usr/bin/osascript")
    .args(["-e", &script])
    .output();
  matches!(output, Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == confirm)
}

fn register_with_launch_services(bundle: &Path) {
  let _ = Command::new(LSREGISTER).args(["-f"]).arg(bundle).status();
}
