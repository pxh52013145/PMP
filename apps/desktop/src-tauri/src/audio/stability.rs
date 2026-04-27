#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::time::Duration;

use crate::audio::policy::NativeAudioStabilityProfile;
use crate::audio::realtime_scheduler::RealtimePressureProfile;

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
static CURRENT_RUNTIME_ACTION_PROFILE: AtomicU8 =
    AtomicU8::new(RealtimePressureProfile::Normal as u8);
static EXTERNAL_HINT_SOURCE_PREPARE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static EXTERNAL_HINT_SOURCE_PREPARE_PROFILE: AtomicU8 =
    AtomicU8::new(RealtimePressureProfile::Normal as u8);
static EXTERNAL_HINT_PLATFORM_CACHE_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static EXTERNAL_HINT_PLATFORM_CACHE_PROFILE: AtomicU8 =
    AtomicU8::new(RealtimePressureProfile::Normal as u8);
static EXTERNAL_HINT_FOREGROUND_HEAVY_APP_UNTIL_MS: AtomicU64 = AtomicU64::new(0);
static EXTERNAL_HINT_FOREGROUND_HEAVY_APP_PROFILE: AtomicU8 =
    AtomicU8::new(RealtimePressureProfile::Normal as u8);

const EXTERNAL_HINT_MIN_HOLD_MS: u64 = 250;
const EXTERNAL_HINT_MAX_HOLD_MS: u64 = 120_000;
const DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_LOW_LATENCY: u64 = 1_500;
const DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_BALANCED: u64 = 2_400;
const DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_STABLE: u64 = 4_500;
const DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_GAME_SAFE: u64 = 7_000;
const DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_SAFE_MODE: u64 = 9_000;
const DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_LOW_LATENCY: u64 = 5_000;
const DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_BALANCED: u64 = 8_000;
const DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_STABLE: u64 = 12_000;
const DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_GAME_SAFE: u64 = 16_000;
const DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_SAFE_MODE: u64 = 20_000;
const DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_LOW_LATENCY: u64 = 8_000;
const DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_BALANCED: u64 = 12_000;
const DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_STABLE: u64 = 18_000;
const DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_GAME_SAFE: u64 = 24_000;
const DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_SAFE_MODE: u64 = 30_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AudioStabilityHintReason {
    SourcePrepareWarmup,
    PlatformCacheMaterializing,
    ForegroundHeavyAppStart,
}

impl AudioStabilityHintReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::SourcePrepareWarmup => "source-prepare-warmup",
            Self::PlatformCacheMaterializing => "platform-cache-materializing",
            Self::ForegroundHeavyAppStart => "foreground-heavy-app-start",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "source-prepare-warmup" => Some(Self::SourcePrepareWarmup),
            "platform-cache-materializing" => Some(Self::PlatformCacheMaterializing),
            "foreground-heavy-app-start" => Some(Self::ForegroundHeavyAppStart),
            _ => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct AudioStabilityHintSnapshot {
    pub minimum_profile: RealtimePressureProfile,
    pub primary_reason: Option<&'static str>,
    pub reason_codes: Vec<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum AudioSourcePrepareProfile {
    Baseline = 0,
    Steady = 1,
    Aggressive = 2,
    Failsafe = 3,
}

impl AudioSourcePrepareProfile {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Baseline => "baseline",
            Self::Steady => "steady",
            Self::Aggressive => "aggressive",
            Self::Failsafe => "failsafe",
        }
    }

    fn from_rank(rank: u8) -> Self {
        match rank {
            1 => Self::Steady,
            2 => Self::Aggressive,
            3 => Self::Failsafe,
            _ => Self::Baseline,
        }
    }
}

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

pub(crate) fn set_runtime_action_profile(profile: RealtimePressureProfile) {
    CURRENT_RUNTIME_ACTION_PROFILE.store(profile as u8, Ordering::Release);
}

fn pressure_profile_from_u8(value: u8) -> RealtimePressureProfile {
    match value {
        1 => RealtimePressureProfile::Guarded,
        2 => RealtimePressureProfile::Critical,
        _ => RealtimePressureProfile::Normal,
    }
}

fn current_timestamp_ms() -> u64 {
    crate::audio::diagnostics::current_timestamp_ms()
}

fn external_hint_storage(
    reason: AudioStabilityHintReason,
) -> (&'static AtomicU64, &'static AtomicU8) {
    match reason {
        AudioStabilityHintReason::SourcePrepareWarmup => (
            &EXTERNAL_HINT_SOURCE_PREPARE_UNTIL_MS,
            &EXTERNAL_HINT_SOURCE_PREPARE_PROFILE,
        ),
        AudioStabilityHintReason::PlatformCacheMaterializing => (
            &EXTERNAL_HINT_PLATFORM_CACHE_UNTIL_MS,
            &EXTERNAL_HINT_PLATFORM_CACHE_PROFILE,
        ),
        AudioStabilityHintReason::ForegroundHeavyAppStart => (
            &EXTERNAL_HINT_FOREGROUND_HEAVY_APP_UNTIL_MS,
            &EXTERNAL_HINT_FOREGROUND_HEAVY_APP_PROFILE,
        ),
    }
}

fn clear_external_hint(reason: AudioStabilityHintReason) {
    let (until, profile) = external_hint_storage(reason);
    until.store(0, Ordering::Release);
    profile.store(RealtimePressureProfile::Normal as u8, Ordering::Release);
}

fn current_external_hint_profile_only() -> RealtimePressureProfile {
    let now_ms = current_timestamp_ms();
    [
        AudioStabilityHintReason::ForegroundHeavyAppStart,
        AudioStabilityHintReason::PlatformCacheMaterializing,
        AudioStabilityHintReason::SourcePrepareWarmup,
    ]
    .into_iter()
    .fold(RealtimePressureProfile::Normal, |current, reason| {
        let (until, profile) = external_hint_storage(reason);
        let until_ms = until.load(Ordering::Acquire);
        if until_ms <= now_ms {
            if until_ms > 0 {
                clear_external_hint(reason);
            }
            return current;
        }

        current.max(pressure_profile_from_u8(profile.load(Ordering::Acquire)))
    })
}

pub(crate) fn clear_external_hints() {
    clear_external_hint(AudioStabilityHintReason::SourcePrepareWarmup);
    clear_external_hint(AudioStabilityHintReason::PlatformCacheMaterializing);
    clear_external_hint(AudioStabilityHintReason::ForegroundHeavyAppStart);
}

pub(crate) fn record_external_hint(
    reason: AudioStabilityHintReason,
    minimum_profile: RealtimePressureProfile,
    hold_ms: u64,
) {
    let hold_ms = hold_ms.clamp(EXTERNAL_HINT_MIN_HOLD_MS, EXTERNAL_HINT_MAX_HOLD_MS);
    let until_target = current_timestamp_ms().saturating_add(hold_ms);
    let (until, profile) = external_hint_storage(reason);

    let minimum = minimum_profile as u8;
    let mut current_profile = profile.load(Ordering::Acquire);
    while current_profile < minimum {
        match profile.compare_exchange(
            current_profile,
            minimum,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => break,
            Err(next) => current_profile = next,
        }
    }

    let mut current_until = until.load(Ordering::Acquire);
    while current_until < until_target {
        match until.compare_exchange(
            current_until,
            until_target,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => break,
            Err(next) => current_until = next,
        }
    }
}

pub(crate) fn current_external_hint_snapshot() -> AudioStabilityHintSnapshot {
    let now_ms = current_timestamp_ms();
    let mut minimum_profile = RealtimePressureProfile::Normal;
    let mut primary_reason = None;
    let mut reason_codes = Vec::new();

    for reason in [
        AudioStabilityHintReason::ForegroundHeavyAppStart,
        AudioStabilityHintReason::PlatformCacheMaterializing,
        AudioStabilityHintReason::SourcePrepareWarmup,
    ] {
        let (until, profile) = external_hint_storage(reason);
        let until_ms = until.load(Ordering::Acquire);
        if until_ms <= now_ms {
            if until_ms > 0 {
                clear_external_hint(reason);
            }
            continue;
        }

        let profile = pressure_profile_from_u8(profile.load(Ordering::Acquire));
        minimum_profile = minimum_profile.max(profile);
        let code = reason.as_str();
        if primary_reason.is_none() {
            primary_reason = Some(code);
        }
        reason_codes.push(code);
    }

    AudioStabilityHintSnapshot {
        minimum_profile,
        primary_reason,
        reason_codes,
    }
}

pub(crate) fn current_runtime_action_profile() -> RealtimePressureProfile {
    pressure_profile_from_u8(CURRENT_RUNTIME_ACTION_PROFILE.load(Ordering::Acquire))
}

pub(crate) fn source_prepare_profile_for(
    stability_profile: NativeAudioStabilityProfile,
    action_profile: RealtimePressureProfile,
) -> AudioSourcePrepareProfile {
    let base_rank = match stability_profile {
        NativeAudioStabilityProfile::LowLatency | NativeAudioStabilityProfile::Balanced => 0u8,
        NativeAudioStabilityProfile::Stable => 1u8,
        NativeAudioStabilityProfile::GameSafe => 2u8,
        NativeAudioStabilityProfile::SafeMode => 3u8,
    };
    let uplift = match action_profile {
        RealtimePressureProfile::Normal => 0u8,
        RealtimePressureProfile::Guarded => 1u8,
        RealtimePressureProfile::Critical => 2u8,
    };
    AudioSourcePrepareProfile::from_rank(base_rank.saturating_add(uplift).min(3))
}

pub(crate) fn current_source_prepare_profile() -> AudioSourcePrepareProfile {
    source_prepare_profile_for(
        current_stability_profile(),
        current_runtime_action_profile(),
    )
}

fn source_prepare_scale(profile: AudioSourcePrepareProfile) -> f64 {
    match profile {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.10,
        AudioSourcePrepareProfile::Aggressive => 1.25,
        AudioSourcePrepareProfile::Failsafe => 1.42,
    }
}

fn source_prepare_recovery_scale(profile: AudioSourcePrepareProfile) -> f64 {
    match profile {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.12,
        AudioSourcePrepareProfile::Aggressive => 1.28,
        AudioSourcePrepareProfile::Failsafe => 1.46,
    }
}

fn source_prepare_rebuffer_scale(profile: AudioSourcePrepareProfile) -> f64 {
    match profile {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.08,
        AudioSourcePrepareProfile::Aggressive => 1.20,
        AudioSourcePrepareProfile::Failsafe => 1.34,
    }
}

fn source_prepare_chunk_scale(profile: AudioSourcePrepareProfile) -> f64 {
    match profile {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.10,
        AudioSourcePrepareProfile::Aggressive => 1.24,
        AudioSourcePrepareProfile::Failsafe => 1.38,
    }
}

fn source_prepare_wait_scale(profile: AudioSourcePrepareProfile) -> f64 {
    match profile {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.08,
        AudioSourcePrepareProfile::Aggressive => 1.20,
        AudioSourcePrepareProfile::Failsafe => 1.32,
    }
}

fn scaled_seconds(base: f64, scale: f64, min: f64, max: f64) -> f64 {
    (base * scale).clamp(min, max)
}

fn scaled_millis(base: u64, scale: f64, min: u64, max: u64) -> u64 {
    (((base as f64) * scale).round() as u64).clamp(min, max)
}

fn source_prepare_profile_scale() -> f64 {
    source_prepare_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_prebuffer_scale() -> f64 {
    source_prepare_profile_scale()
}

pub(crate) fn source_prepare_min_start_scale() -> f64 {
    source_prepare_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_recovery_threshold_scale() -> f64 {
    source_prepare_recovery_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_rebuffer_threshold_scale() -> f64 {
    source_prepare_rebuffer_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_chunk_scale_factor() -> f64 {
    source_prepare_chunk_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_wait_scale_factor() -> f64 {
    source_prepare_wait_scale(current_source_prepare_profile())
}

pub(crate) fn source_prepare_hot_path_extra_frames() -> usize {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 2_048,
        AudioSourcePrepareProfile::Steady => 3_072,
        AudioSourcePrepareProfile::Aggressive => 4_096,
        AudioSourcePrepareProfile::Failsafe => 6_144,
    }
}

pub(crate) fn source_prepare_transfer_watermark_boost() -> (usize, usize) {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => (0, 0),
        AudioSourcePrepareProfile::Steady => (4, 3),
        AudioSourcePrepareProfile::Aggressive => (10, 7),
        AudioSourcePrepareProfile::Failsafe => (16, 12),
    }
}

pub(crate) fn source_prepare_shared_render_watermark_boost() -> (usize, usize) {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => (0, 0),
        AudioSourcePrepareProfile::Steady => (4, 2),
        AudioSourcePrepareProfile::Aggressive => (10, 6),
        AudioSourcePrepareProfile::Failsafe => (16, 10),
    }
}

pub(crate) fn source_prepare_shared_ready_extra_frames() -> usize {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 96,
        AudioSourcePrepareProfile::Steady => 192,
        AudioSourcePrepareProfile::Aggressive => 384,
        AudioSourcePrepareProfile::Failsafe => 768,
    }
}

pub(crate) fn source_prepare_consumer_chunk_scale_factor() -> f64 {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 1.0,
        AudioSourcePrepareProfile::Steady => 1.10,
        AudioSourcePrepareProfile::Aggressive => 1.24,
        AudioSourcePrepareProfile::Failsafe => 1.42,
    }
}

pub(crate) fn default_external_hint_profile(
    reason: AudioStabilityHintReason,
) -> RealtimePressureProfile {
    match reason {
        AudioStabilityHintReason::SourcePrepareWarmup
        | AudioStabilityHintReason::PlatformCacheMaterializing => match current_stability_profile()
        {
            NativeAudioStabilityProfile::Stable
            | NativeAudioStabilityProfile::GameSafe
            | NativeAudioStabilityProfile::SafeMode => RealtimePressureProfile::Critical,
            NativeAudioStabilityProfile::LowLatency | NativeAudioStabilityProfile::Balanced => {
                RealtimePressureProfile::Guarded
            }
        },
        AudioStabilityHintReason::ForegroundHeavyAppStart => match current_stability_profile() {
            NativeAudioStabilityProfile::LowLatency | NativeAudioStabilityProfile::Balanced => {
                RealtimePressureProfile::Guarded
            }
            NativeAudioStabilityProfile::Stable
            | NativeAudioStabilityProfile::GameSafe
            | NativeAudioStabilityProfile::SafeMode => RealtimePressureProfile::Critical,
        },
    }
}

pub(crate) fn default_external_hint_hold_ms(reason: AudioStabilityHintReason) -> u64 {
    match reason {
        AudioStabilityHintReason::SourcePrepareWarmup => match current_stability_profile() {
            NativeAudioStabilityProfile::LowLatency => {
                DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_LOW_LATENCY
            }
            NativeAudioStabilityProfile::Balanced => DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_BALANCED,
            NativeAudioStabilityProfile::Stable => DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_STABLE,
            NativeAudioStabilityProfile::GameSafe => DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_GAME_SAFE,
            NativeAudioStabilityProfile::SafeMode => DEFAULT_SOURCE_PREPARE_HINT_HOLD_MS_SAFE_MODE,
        },
        AudioStabilityHintReason::PlatformCacheMaterializing => match current_stability_profile() {
            NativeAudioStabilityProfile::LowLatency => {
                DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_LOW_LATENCY
            }
            NativeAudioStabilityProfile::Balanced => DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_BALANCED,
            NativeAudioStabilityProfile::Stable => DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_STABLE,
            NativeAudioStabilityProfile::GameSafe => DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_GAME_SAFE,
            NativeAudioStabilityProfile::SafeMode => DEFAULT_PLATFORM_CACHE_HINT_HOLD_MS_SAFE_MODE,
        },
        AudioStabilityHintReason::ForegroundHeavyAppStart => match current_stability_profile() {
            NativeAudioStabilityProfile::LowLatency => {
                DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_LOW_LATENCY
            }
            NativeAudioStabilityProfile::Balanced => {
                DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_BALANCED
            }
            NativeAudioStabilityProfile::Stable => DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_STABLE,
            NativeAudioStabilityProfile::GameSafe => {
                DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_GAME_SAFE
            }
            NativeAudioStabilityProfile::SafeMode => {
                DEFAULT_FOREGROUND_HEAVY_APP_HINT_HOLD_MS_SAFE_MODE
            }
        },
    }
}

pub(crate) fn source_prepare_warmup_hold_ms_for(timeout: Duration) -> u64 {
    let timeout_ms = timeout.as_millis().min(u64::MAX as u128) as u64;
    default_external_hint_hold_ms(AudioStabilityHintReason::SourcePrepareWarmup)
        .max(timeout_ms.saturating_add(250))
        .clamp(EXTERNAL_HINT_MIN_HOLD_MS, EXTERNAL_HINT_MAX_HOLD_MS)
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
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 1.0,
        NativeAudioStabilityProfile::Balanced => 1.5,
        NativeAudioStabilityProfile::Stable => 2.4,
        NativeAudioStabilityProfile::GameSafe => 3.0,
        NativeAudioStabilityProfile::SafeMode => 3.5,
    };
    scaled_seconds(base, source_prepare_profile_scale(), 0.2, 4.0)
}

pub(crate) fn shared_render_ahead_seconds_default() -> f64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.55,
        NativeAudioStabilityProfile::Balanced => 0.85,
        NativeAudioStabilityProfile::Stable => 1.25,
        NativeAudioStabilityProfile::GameSafe => 1.6,
        NativeAudioStabilityProfile::SafeMode => 2.0,
    };
    scaled_seconds(base, source_prepare_profile_scale(), 0.2, 8.0)
}

pub(crate) fn shared_render_ahead_preroll_seconds_default() -> f64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.16,
        NativeAudioStabilityProfile::Balanced => 0.28,
        NativeAudioStabilityProfile::Stable => 0.42,
        NativeAudioStabilityProfile::GameSafe => 0.55,
        NativeAudioStabilityProfile::SafeMode => 0.70,
    };
    scaled_seconds(base, source_prepare_profile_scale(), 0.02, 1.2)
}

pub(crate) fn shared_render_ahead_capacity_scale_default() -> f64 {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 1.20,
        AudioSourcePrepareProfile::Steady => 1.34,
        AudioSourcePrepareProfile::Aggressive => 1.56,
        AudioSourcePrepareProfile::Failsafe => 1.82,
    }
}

pub(crate) fn shared_render_ahead_preroll_timeout_ms_default() -> u64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 280,
        NativeAudioStabilityProfile::Balanced => 450,
        NativeAudioStabilityProfile::Stable => 650,
        NativeAudioStabilityProfile::GameSafe => 900,
        NativeAudioStabilityProfile::SafeMode => 1_150,
    };
    scaled_millis(base, source_prepare_wait_scale_factor(), 180, 2_500)
}

pub(crate) fn interactive_shared_cap_scale_default() -> f64 {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 1.8,
        AudioSourcePrepareProfile::Steady => 2.1,
        AudioSourcePrepareProfile::Aggressive => 2.5,
        AudioSourcePrepareProfile::Failsafe => 3.0,
    }
}

pub(crate) fn interactive_shared_timeout_scale_default() -> f64 {
    match current_source_prepare_profile() {
        AudioSourcePrepareProfile::Baseline => 1.6,
        AudioSourcePrepareProfile::Steady => 1.9,
        AudioSourcePrepareProfile::Aggressive => 2.3,
        AudioSourcePrepareProfile::Failsafe => 2.8,
    }
}

pub(crate) fn shared_resume_guard_seconds_default() -> f64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.18,
        NativeAudioStabilityProfile::Balanced => 0.24,
        NativeAudioStabilityProfile::Stable => 0.34,
        NativeAudioStabilityProfile::GameSafe => 0.48,
        NativeAudioStabilityProfile::SafeMode => 0.60,
    };
    scaled_seconds(base, source_prepare_wait_scale_factor(), 0.0, 2.0)
}

pub(crate) fn shared_resume_guard_min_seconds_default() -> f64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 0.06,
        NativeAudioStabilityProfile::Balanced => 0.08,
        NativeAudioStabilityProfile::Stable => 0.14,
        NativeAudioStabilityProfile::GameSafe => 0.20,
        NativeAudioStabilityProfile::SafeMode => 0.28,
    };
    scaled_seconds(base, source_prepare_wait_scale_factor(), 0.0, 0.8)
}

pub(crate) fn wasapi_shared_raw_prefill_ms_default() -> u64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 240,
        NativeAudioStabilityProfile::Balanced => 360,
        NativeAudioStabilityProfile::Stable => 520,
        NativeAudioStabilityProfile::GameSafe => 700,
        NativeAudioStabilityProfile::SafeMode => 900,
    };
    scaled_millis(base, source_prepare_profile_scale(), 20, 2_000)
}

pub(crate) fn wasapi_shared_raw_prefill_timeout_ms_default() -> u64 {
    let base = match current_stability_profile() {
        NativeAudioStabilityProfile::LowLatency => 320,
        NativeAudioStabilityProfile::Balanced => 520,
        NativeAudioStabilityProfile::Stable => 720,
        NativeAudioStabilityProfile::GameSafe => 950,
        NativeAudioStabilityProfile::SafeMode => 1200,
    };
    scaled_millis(base, source_prepare_wait_scale_factor(), 40, 3_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_prepare_profile_ramps_with_stability_and_action() {
        assert_eq!(
            source_prepare_profile_for(
                NativeAudioStabilityProfile::Balanced,
                RealtimePressureProfile::Normal
            ),
            AudioSourcePrepareProfile::Baseline
        );
        assert_eq!(
            source_prepare_profile_for(
                NativeAudioStabilityProfile::Balanced,
                RealtimePressureProfile::Guarded
            ),
            AudioSourcePrepareProfile::Steady
        );
        assert_eq!(
            source_prepare_profile_for(
                NativeAudioStabilityProfile::Balanced,
                RealtimePressureProfile::Critical
            ),
            AudioSourcePrepareProfile::Aggressive
        );
        assert_eq!(
            source_prepare_profile_for(
                NativeAudioStabilityProfile::Stable,
                RealtimePressureProfile::Critical
            ),
            AudioSourcePrepareProfile::Failsafe
        );
        assert_eq!(
            source_prepare_profile_for(
                NativeAudioStabilityProfile::GameSafe,
                RealtimePressureProfile::Normal
            ),
            AudioSourcePrepareProfile::Aggressive
        );
    }

    #[test]
    fn external_hint_is_reported_without_mutating_runtime_action_profile() {
        clear_external_hints();
        set_stability_profile(NativeAudioStabilityProfile::Balanced);
        set_runtime_action_profile(RealtimePressureProfile::Normal);

        record_external_hint(
            AudioStabilityHintReason::PlatformCacheMaterializing,
            RealtimePressureProfile::Critical,
            2_000,
        );

        let snapshot = current_external_hint_snapshot();
        assert!(matches!(
            snapshot.minimum_profile,
            RealtimePressureProfile::Critical
        ));
        assert_eq!(
            snapshot.primary_reason,
            Some("platform-cache-materializing")
        );
        assert!(snapshot
            .reason_codes
            .contains(&"platform-cache-materializing"));
        assert!(matches!(
            current_runtime_action_profile(),
            RealtimePressureProfile::Normal
        ));

        clear_external_hints();
        set_runtime_action_profile(RealtimePressureProfile::Normal);
    }
}
