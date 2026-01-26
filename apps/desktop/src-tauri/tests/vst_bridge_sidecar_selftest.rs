use std::path::PathBuf;
use std::process::Command;

#[test]
fn sidecar_selftest_returns_expected_json() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = if cfg!(windows) {
        // Built by scripts/prepare-sidecars.mjs
        manifest_dir
            .join("binaries")
            .join("pmp-vst-bridge-x86_64-pc-windows-msvc.exe")
    } else {
        manifest_dir.join("binaries").join("pmp-vst-bridge")
    };

    assert!(
        candidate.exists(),
        "sidecar binary not found at {} (run scripts/prepare-sidecars.mjs)",
        candidate.display()
    );

    let run = |envs: &[(&str, &str)]| -> serde_json::Value {
        let mut cmd = Command::new(&candidate);
        cmd.arg("--selftest");
        for (k, v) in envs {
            cmd.env(k, v);
        }
        let output = cmd.output().expect("run sidecar selftest");
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).expect("utf8 stdout");
        serde_json::from_str(&text).expect("valid json")
    };

    let json = run(&[]);

    assert_eq!(json["ok"], true);
    assert!(json["monoPolicy"].is_string());
    assert!(json["sidechainMode"].is_string());
    assert!(json["editorSafeMode"].is_boolean());
    assert!(json["loadOnUiThread"].is_boolean());

    assert!(json["shmVersion"].is_number());
    assert_eq!(json["shmMainChannels"], 2);
    assert!(json["shmSidechainChannels"].is_number());
    assert!(json["willEnableNonMainBuses"].is_boolean());
    assert!(json["shm"]["supportedVersions"].is_array());
    assert!(json["shm"]["v1HeaderBytes"].is_number());
    assert!(json["shm"]["v2HeaderBytes"].is_number());
    assert!(json["shm"]["v2Layout"].is_string());

    // Sum policy expected outputs.
    let sum = json["downmixSum"].as_array().expect("downmixSum array");
    assert_eq!(sum.len(), 4);
    assert_eq!(sum[0].as_f64().unwrap(), 0.5);
    assert_eq!(sum[1].as_f64().unwrap(), 0.5);
    assert_eq!(sum[2].as_f64().unwrap(), 1.0);
    assert_eq!(sum[3].as_f64().unwrap(), 0.0);

    // Left policy expected outputs.
    let left = json["downmixLeft"].as_array().expect("downmixLeft array");
    assert_eq!(left.len(), 4);
    assert_eq!(left[0].as_f64().unwrap(), 1.0);
    assert_eq!(left[1].as_f64().unwrap(), 0.0);
    assert_eq!(left[2].as_f64().unwrap(), 1.0);
    assert_eq!(left[3].as_f64().unwrap(), -1.0);

    // Ensure env overrides are wired (process reads env per invocation).
    let json = run(&[("PMP_VST_MONO_INPUT", "left")]);
    assert_eq!(json["monoPolicy"], "left");

    let json = run(&[("PMP_VST_SIDECHAIN_MODE", "self")]);
    assert_eq!(json["sidechainMode"], "self");
    assert_eq!(json["willEnableNonMainBuses"], true);

    let json = run(&[("PMP_VST_EDITOR_SAFE_MODE", "1")]);
    assert_eq!(json["editorSafeMode"], true);

    let json = run(&[("PMP_VST_BRIDGE_SHM_VERSION", "1")]);
    assert_eq!(json["shmVersion"], 1);

    let json = run(&[("PMP_VST_BRIDGE_SHM_SIDECHAIN_CHANNELS", "0")]);
    assert_eq!(json["shmSidechainChannels"], 0);
    assert_eq!(json["willEnableNonMainBuses"], false);

    let json = run(&[
        ("PMP_VST_BRIDGE_SHM_SIDECHAIN_CHANNELS", "0"),
        ("PMP_VST_SIDECHAIN_MODE", "self"),
    ]);
    assert_eq!(json["shmSidechainChannels"], 0);
    assert_eq!(json["sidechainMode"], "self");
    assert_eq!(json["willEnableNonMainBuses"], true);
}
