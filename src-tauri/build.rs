use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
  // Declare custom cfg for `cargo check` / clippy.
  println!("cargo:rustc-check-cfg=cfg(uebrig_apple_fm)");

  // Compile Apple Foundation Models bridge on macOS when the SDK provides it.
  #[cfg(target_os = "macos")]
  compile_apple_fm();

  tauri_build::build();
}

#[cfg(target_os = "macos")]
fn compile_apple_fm() {
  let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
  let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
  let swift_src = manifest_dir.join("apple/FoundationCategorizer.swift");
  let lib_path = out_dir.join("libuebrig_apple_fm.a");

  println!("cargo:rerun-if-changed={}", swift_src.display());

  let target = env::var("TARGET").unwrap_or_default();
  // e.g. aarch64-apple-darwin → arm64-apple-macosx26.0
  let swift_target = if target.starts_with("aarch64-") || target.starts_with("arm64-") {
    "arm64-apple-macosx26.0"
  } else if target.starts_with("x86_64-") {
    "x86_64-apple-macosx26.0"
  } else {
    "arm64-apple-macosx26.0"
  };

  let status = Command::new("xcrun")
    .args([
      "swiftc",
      "-parse-as-library",
      "-emit-library",
      "-static",
      "-O",
      "-module-name",
      "UebrigAppleFM",
      "-target",
      swift_target,
      "-o",
    ])
    .arg(&lib_path)
    .arg(&swift_src)
    .status();

  match status {
    Ok(s) if s.success() => {
      println!("cargo:rustc-link-search=native={}", out_dir.display());
      println!("cargo:rustc-link-lib=static=uebrig_apple_fm");
      println!("cargo:rustc-link-lib=framework=Foundation");
      // Weak-link so the binary still loads on Macs without Apple Intelligence.
      println!("cargo:rustc-link-arg=-weak_framework");
      println!("cargo:rustc-link-arg=FoundationModels");
      println!("cargo:rustc-cfg=uebrig_apple_fm");
      // Swift concurrency: with deployment target < 12, ld rewrites the load
      // path to @rpath/libswift_Concurrency.dylib and the app aborts at launch
      // unless an rpath is present. tauri-build only sets the deployment target
      // for non-dev (`tauri build`), so set it here too (keep in sync with
      // bundle.macOS.minimumSystemVersion in tauri.conf.json).
      println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=12.0");
      if let Ok(sdk) = Command::new("xcrun")
        .args(["--sdk", "macosx", "--show-sdk-path"])
        .output()
      {
        let sdk_root = String::from_utf8_lossy(&sdk.stdout).trim().to_string();
        let sdk_swift = PathBuf::from(&sdk_root).join("usr/lib/swift");
        if sdk_swift.is_dir() {
          println!("cargo:rustc-link-search=native={}", sdk_swift.display());
        }
      }
      // Fallback if anything still records @rpath.
      println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
      // Swift runtime
      println!("cargo:rustc-link-lib=swiftCore");
      println!("cargo:rustc-link-lib=swiftFoundation");
      println!("cargo:rustc-link-lib=swiftDispatch");
      println!("cargo:rustc-link-lib=swiftObjectiveC");
      println!("cargo:rustc-link-lib=swift_Concurrency");
    }
    Ok(s) => {
      println!(
        "cargo:warning=Apple Foundation Models bridge failed to compile (exit {s}); using bundled GGUF only"
      );
    }
    Err(e) => {
      println!(
        "cargo:warning=Could not run swiftc for Apple FM bridge ({e}); using bundled GGUF only"
      );
    }
  }
}
