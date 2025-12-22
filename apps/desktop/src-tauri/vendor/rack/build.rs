use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Declare custom cfg for VST3 SDK availability
    println!("cargo::rustc-check-cfg=cfg(vst3_sdk)");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();

    // VST3 is only supported on desktop platforms (macOS, Linux, Windows)
    // Skip VST3 SDK setup on iOS/tvOS/watchOS/visionOS
    // Also skip during cargo publish to avoid modifying source directory
    let is_desktop = matches!(target_os.as_str(), "macos" | "linux" | "windows");

    // Detect if we're in a cargo publish verification build
    let current_dir = env::current_dir().unwrap();
    let in_publish_verify = current_dir
        .to_str()
        .map(|s| s.contains("/target/package/"))
        .unwrap_or(false);

    // Determine VST3 SDK path and ensure it's available
    let vst3_sdk_path = if is_desktop && !in_publish_verify {
        ensure_vst3_sdk()
    } else {
        if in_publish_verify {
            eprintln!("Skipping VST3 SDK auto-clone for cargo publish (VST3 support disabled)");
        } else {
            eprintln!("Skipping VST3 SDK setup for {} (VST3 only supported on desktop platforms)", target_os);
        }
        None
    };

    // Check if ASAN should be enabled
    let enable_asan = env::var("CARGO_FEATURE_ASAN").is_ok() || env::var("ENABLE_ASAN").is_ok();

    // Detect docs.rs environment
    let is_docs_rs = env::var("DOCS_RS").is_ok();

    // Configure CMake build
    let mut config = cmake::Config::new("rack-sys");
    config
        .define("CMAKE_BUILD_TYPE", "Release")
        .define("BUILD_TESTS", "OFF"); // Don't build C++ tests in Rust build

    // On Windows/MSVC, building the C++ host in "Debug" causes CRT mismatch when
    // linking from Rust (Rust always links the non-debug CRT). Force "Release".
    if target_os == "windows" {
        config.profile("Release");
    }

    // On docs.rs, allow build to succeed even without plugin formats
    if is_docs_rs {
        config.define("DOCS_RS_BUILD", "ON");
    }

    // Pass VST3 SDK path to CMake if available
    let have_vst3 = if let Some(sdk_path) = vst3_sdk_path {
        // Convert to absolute path - CMake runs in build dir, needs absolute path
        let sdk_path_abs = if sdk_path.is_absolute() {
            sdk_path
        } else {
            env::current_dir().unwrap().join(&sdk_path)
        };
        config.define("VST3_SDK_PATH", sdk_path_abs.to_str().unwrap());
        eprintln!("Configuring CMake with VST3 SDK at: {}", sdk_path_abs.display());
        true
    } else {
        eprintln!("VST3 SDK not available - VST3 support will be disabled");
        false
    };

    // Tell Cargo about VST3 availability for conditional compilation
    if have_vst3 {
        println!("cargo:rustc-cfg=vst3_sdk");
    }

    if enable_asan {
        config.define("ENABLE_ASAN", "ON");
        eprintln!("Building with AddressSanitizer enabled");
    }

    let dst = config.build();

    // Library name comes from CMake configuration (librack_sys.a)
    let lib_name = "rack_sys";

    // Tell cargo where to find the library
    println!("cargo:rustc-link-search=native={}/lib", dst.display());
    println!("cargo:rustc-link-lib=static={}", lib_name);

    // Platform-specific linking
    match target_os.as_str() {
        "macos" | "ios" | "tvos" | "watchos" => {
            link_apple_frameworks(&target_os);
            // Link C++ standard library (libc++ on Apple platforms)
            println!("cargo:rustc-link-lib=c++");
        }
        "linux" => {
            // Link C++ standard library (libstdc++ on Linux)
            println!("cargo:rustc-link-lib=stdc++");
            // Link dynamic loader (needed for VST3 module loading)
            println!("cargo:rustc-link-lib=dl");
        }
        "windows" => {
            // VST3 SDK uses COM helpers like `CoCreateGuid` on Windows.
            println!("cargo:rustc-link-lib=ole32");
            // VST3 editor hosting uses Win32 windowing APIs (HWND / message loop).
            println!("cargo:rustc-link-lib=user32");
            // Some editor paths use GDI types / helpers on Windows.
            println!("cargo:rustc-link-lib=gdi32");
        }
        _ => {
            eprintln!("Warning: Unsupported target OS: {}", target_os);
        }
    }

    // Link ASAN runtime if enabled
    if enable_asan {
        println!("cargo:rustc-link-arg=-fsanitize=address");
        println!("cargo:rustc-link-arg=-fno-optimize-sibling-calls");
        println!("cargo:rustc-link-arg=-fsanitize-address-use-after-scope");
        println!("cargo:rustc-link-arg=-fno-omit-frame-pointer");
    }

    // Rerun build script if C++ sources, headers, or build config changes
    println!("cargo:rerun-if-changed=rack-sys/src");
    println!("cargo:rerun-if-changed=rack-sys/include");
    println!("cargo:rerun-if-changed=rack-sys/CMakeLists.txt");
    println!("cargo:rerun-if-changed=rack-sys/external/vst3sdk");
    println!("cargo:rerun-if-env-changed=PMP_VST3_SDK_PATH");
    println!("cargo:rerun-if-env-changed=PMP_VST3_SDK_URL");
    println!("cargo:rerun-if-env-changed=VST3_SDK_PATH");

    // Print target for debugging
    eprintln!(
        "Building rack-sys for target: {} ({})",
        env::var("TARGET").unwrap(),
        target_os
    );
}

fn link_apple_frameworks(target_os: &str) {
    // AudioUnit frameworks (macOS and iOS)
    println!("cargo:rustc-link-lib=framework=AudioToolbox");
    println!("cargo:rustc-link-lib=framework=CoreAudio");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
    println!("cargo:rustc-link-lib=framework=CoreAudioKit");

    // Link platform-specific UI frameworks
    let is_ios_family = target_os == "ios" || target_os.contains("vision");
    if is_ios_family {
        println!("cargo:rustc-link-lib=framework=UIKit");
        eprintln!("Building rack-sys for iOS/visionOS (GUI provided by app extensions)");
    } else {
        println!("cargo:rustc-link-lib=framework=AppKit");
        eprintln!("Building rack-sys for macOS (GUI enabled)");
    }
}

/// Ensure VST3 SDK is available, cloning it if necessary
/// Returns the path to the VST3 SDK, or None if unavailable
fn ensure_vst3_sdk() -> Option<PathBuf> {
    // Allow user-provided SDK path to avoid network fetches (useful behind flaky networks).
    if let Ok(value) = env::var("PMP_VST3_SDK_PATH").or_else(|_| env::var("VST3_SDK_PATH")) {
        let candidate = PathBuf::from(value);
        let valid = candidate.exists()
            && candidate.join("CMakeLists.txt").exists()
            && candidate.join("pluginterfaces/base/funknown.cpp").exists()
            && candidate.join("pluginterfaces/gui/iplugview.h").exists()
            && candidate.join("public.sdk/source/common/commoniids.cpp").exists();
        if valid {
            eprintln!("Using VST3 SDK from {}", candidate.display());
            return Some(candidate);
        }
        eprintln!(
            "VST3 SDK path is set but invalid (missing required files): {}",
            candidate.display()
        );
    }

    let vst3_sdk_path = PathBuf::from("rack-sys/external/vst3sdk");

    // Check if SDK exists and has content (in source tree)
    // Verify actual source files exist, not just empty directories
    let sdk_exists = vst3_sdk_path.exists()
        && vst3_sdk_path.join("CMakeLists.txt").exists()
        && vst3_sdk_path.join("pluginterfaces/base/funknown.cpp").exists()
        && vst3_sdk_path.join("pluginterfaces/gui/iplugview.h").exists()
        && vst3_sdk_path.join("public.sdk/source/common/commoniids.cpp").exists();

    if sdk_exists {
        eprintln!("VST3 SDK found at {}", vst3_sdk_path.display());
        return Some(vst3_sdk_path);
    }

    eprintln!("VST3 SDK not found in source tree, cloning to OUT_DIR...");

    // Clone to OUT_DIR (always writable) to avoid modifying source tree.
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let clone_target = out_dir.join("vst3sdk");

    // Check if already cloned to target location (with content verification)
    // Verify actual source files exist, not just empty directories
    if clone_target.exists()
        && clone_target.join("CMakeLists.txt").exists()
        && clone_target.join("pluginterfaces/base/funknown.cpp").exists()
        && clone_target.join("pluginterfaces/gui/iplugview.h").exists()
        && clone_target.join("public.sdk/source/common/commoniids.cpp").exists() {
        eprintln!("VST3 SDK already exists at {}", clone_target.display());
        return Some(clone_target);
    }

    // Clone directly (shallow). Avoid `--recursive` to reduce download size; only init required submodules.
    let sdk_url = env::var("PMP_VST3_SDK_URL")
        .unwrap_or_else(|_| "https://github.com/steinbergmedia/vst3sdk.git".to_string());

    eprintln!("Cloning VST3 SDK to {}...", clone_target.display());

    // Create parent directory if it doesn't exist
    if let Some(parent) = clone_target.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let clone_target_str = clone_target.to_str().unwrap();

    for attempt in 1..=3 {
        if clone_target.exists() {
            let _ = std::fs::remove_dir_all(&clone_target);
        }

        let clone_result = Command::new("git")
            .args(&[
                "-c",
                "http.version=HTTP/1.1",
                "clone",
                "--depth=1",
                sdk_url.as_str(),
                clone_target_str,
            ])
            .status();

        let cloned_ok = matches!(clone_result, Ok(status) if status.success());
        if !cloned_ok {
            let code = clone_result.ok().and_then(|s| s.code());
            eprintln!(
                "Warning: Failed to clone VST3 SDK (attempt {attempt}/3, exit={code:?})."
            );
            std::thread::sleep(std::time::Duration::from_secs(2));
            continue;
        }

        let submodule_result = Command::new("git")
            .args(&[
                "-c",
                "http.version=HTTP/1.1",
                "-C",
                clone_target_str,
                "submodule",
                "update",
                "--init",
                "--depth=1",
                "pluginterfaces",
                "public.sdk",
            ])
            .status();

        if !matches!(submodule_result, Ok(status) if status.success()) {
            let code = submodule_result.ok().and_then(|s| s.code());
            eprintln!(
                "Warning: Failed to init VST3 submodules (attempt {attempt}/3, exit={code:?})."
            );
            std::thread::sleep(std::time::Duration::from_secs(2));
            continue;
        }

        let valid = clone_target.join("CMakeLists.txt").exists()
            && clone_target.join("pluginterfaces/base/funknown.cpp").exists()
            && clone_target.join("public.sdk/source/common/commoniids.cpp").exists();
        if valid {
            eprintln!("VST3 SDK cloned successfully to {}", clone_target.display());
            return Some(clone_target);
        }

        eprintln!("Warning: VST3 SDK clone is incomplete (attempt {attempt}/3).");
        std::thread::sleep(std::time::Duration::from_secs(2));
    }

    eprintln!("VST3 support will be disabled.");
    None
}
