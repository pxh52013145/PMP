use std::sync::atomic::{AtomicU8, Ordering};

use crate::audio::policy::NativeAudioStabilityProfile;

const DEFAULT_MEMORY_PRESSURE_HOLD_MS_LOW_LATENCY: u64 = 6_000;
const DEFAULT_MEMORY_PRESSURE_HOLD_MS_BALANCED: u64 = 12_000;
const DEFAULT_MEMORY_PRESSURE_HOLD_MS_STABLE: u64 = 22_000;
const DEFAULT_MEMORY_PRESSURE_HOLD_MS_GAME_SAFE: u64 = 30_000;
const DEFAULT_MEMORY_PRESSURE_HOLD_MS_SAFE_MODE: u64 = 45_000;
const DEFAULT_GUARDED_PRESSURE_HOLD_MS_LOW_LATENCY: u64 = 4_000;
const DEFAULT_GUARDED_PRESSURE_HOLD_MS_BALANCED: u64 = 8_000;
const DEFAULT_GUARDED_PRESSURE_HOLD_MS_STABLE: u64 = 14_000;
const DEFAULT_GUARDED_PRESSURE_HOLD_MS_GAME_SAFE: u64 = 20_000;
const DEFAULT_GUARDED_PRESSURE_HOLD_MS_SAFE_MODE: u64 = 28_000;
const DEFAULT_CRITICAL_PRESSURE_HOLD_MS_LOW_LATENCY: u64 = 6_000;
const DEFAULT_CRITICAL_PRESSURE_HOLD_MS_BALANCED: u64 = 12_000;
const DEFAULT_CRITICAL_PRESSURE_HOLD_MS_STABLE: u64 = 18_000;
const DEFAULT_CRITICAL_PRESSURE_HOLD_MS_GAME_SAFE: u64 = 26_000;
const DEFAULT_CRITICAL_PRESSURE_HOLD_MS_SAFE_MODE: u64 = 34_000;
const MIN_MEMORY_PRESSURE_HOLD_MS: u64 = 500;
const MAX_MEMORY_PRESSURE_HOLD_MS: u64 = 120_000;

static CURRENT_STABILITY_PROFILE: AtomicU8 =
    AtomicU8::new(NativeAudioStabilityProfile::Balanced as u8);

fn parse_env_u64(key: &str, min: u64, max: u64) -> Option<u64> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .map(|value| value.clamp(min, max))
}

pub(crate) fn set_stability_profile(profile: NativeAudioStabilityProfile) {
    CURRENT_STABILITY_PROFILE.store(profile as u8, Ordering::Release);
}

pub(crate) fn current_stability_profile() -> NativeAudioStabilityProfile {
    NativeAudioStabilityProfile::from_u8(CURRENT_STABILITY_PROFILE.load(Ordering::Acquire))
}

pub(crate) fn memory_pressure_hold_ms() -> u64 {
    if let Some(value) = parse_env_u64(
        "PMP_AUDIO_MEMORY_PRESSURE_HOLD_MS",
        MIN_MEMORY_PRESSURE_HOLD_MS,
        MAX_MEMORY_PRESSURE_HOLD_MS,
    ) {
        return value;
    }

    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => DEFAULT_MEMORY_PRESSURE_HOLD_MS_LOW_LATENCY,
        NativeAudioStabilityProfile::Balanced => DEFAULT_MEMORY_PRESSURE_HOLD_MS_BALANCED,
        NativeAudioStabilityProfile::Stable => DEFAULT_MEMORY_PRESSURE_HOLD_MS_STABLE,
        NativeAudioStabilityProfile::GameSafe => DEFAULT_MEMORY_PRESSURE_HOLD_MS_GAME_SAFE,
        NativeAudioStabilityProfile::SafeMode => DEFAULT_MEMORY_PRESSURE_HOLD_MS_SAFE_MODE,
    }
}

pub(crate) fn guarded_pressure_hold_ms() -> u64 {
    if let Some(value) = parse_env_u64(
        "PMP_AUDIO_GUARDED_PRESSURE_HOLD_MS",
        MIN_MEMORY_PRESSURE_HOLD_MS,
        MAX_MEMORY_PRESSURE_HOLD_MS,
    ) {
        return value;
    }

    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => DEFAULT_GUARDED_PRESSURE_HOLD_MS_LOW_LATENCY,
        NativeAudioStabilityProfile::Balanced => DEFAULT_GUARDED_PRESSURE_HOLD_MS_BALANCED,
        NativeAudioStabilityProfile::Stable => DEFAULT_GUARDED_PRESSURE_HOLD_MS_STABLE,
        NativeAudioStabilityProfile::GameSafe => DEFAULT_GUARDED_PRESSURE_HOLD_MS_GAME_SAFE,
        NativeAudioStabilityProfile::SafeMode => DEFAULT_GUARDED_PRESSURE_HOLD_MS_SAFE_MODE,
    }
}

pub(crate) fn critical_pressure_hold_ms() -> u64 {
    if let Some(value) = parse_env_u64(
        "PMP_AUDIO_CRITICAL_PRESSURE_HOLD_MS",
        MIN_MEMORY_PRESSURE_HOLD_MS,
        MAX_MEMORY_PRESSURE_HOLD_MS,
    ) {
        return value;
    }

    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => DEFAULT_CRITICAL_PRESSURE_HOLD_MS_LOW_LATENCY,
        NativeAudioStabilityProfile::Balanced => DEFAULT_CRITICAL_PRESSURE_HOLD_MS_BALANCED,
        NativeAudioStabilityProfile::Stable => DEFAULT_CRITICAL_PRESSURE_HOLD_MS_STABLE,
        NativeAudioStabilityProfile::GameSafe => DEFAULT_CRITICAL_PRESSURE_HOLD_MS_GAME_SAFE,
        NativeAudioStabilityProfile::SafeMode => DEFAULT_CRITICAL_PRESSURE_HOLD_MS_SAFE_MODE,
    }
}

pub(crate) fn render_queue_seconds_default() -> f64 {
    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 1.0,
        NativeAudioStabilityProfile::Balanced => 1.5,
        NativeAudioStabilityProfile::Stable => 2.4,
        NativeAudioStabilityProfile::GameSafe => 3.0,
        NativeAudioStabilityProfile::SafeMode => 3.5,
    }
}

pub(crate) fn shared_render_ahead_seconds_default() -> f64 {
    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.55,
        NativeAudioStabilityProfile::Balanced => 0.85,
        NativeAudioStabilityProfile::Stable => 1.25,
        NativeAudioStabilityProfile::GameSafe => 1.6,
        NativeAudioStabilityProfile::SafeMode => 2.0,
    }
}

pub(crate) fn shared_render_ahead_preroll_seconds_default() -> f64 {
    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.16,
        NativeAudioStabilityProfile::Balanced => 0.28,
        NativeAudioStabilityProfile::Stable => 0.42,
        NativeAudioStabilityProfile::GameSafe => 0.55,
        NativeAudioStabilityProfile::SafeMode => 0.70,
    }
}

pub(crate) fn wasapi_shared_raw_prefill_ms_default() -> u64 {
    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 240,
        NativeAudioStabilityProfile::Balanced => 360,
        NativeAudioStabilityProfile::Stable => 520,
        NativeAudioStabilityProfile::GameSafe => 700,
        NativeAudioStabilityProfile::SafeMode => 900,
    }
}

pub(crate) fn wasapi_shared_raw_prefill_timeout_ms_default() -> u64 {
    match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 320,
        NativeAudioStabilityProfile::Balanced => 520,
        NativeAudioStabilityProfile::Stable => 720,
        NativeAudioStabilityProfile::GameSafe => 950,
        NativeAudioStabilityProfile::SafeMode => 1200,
    }
}
