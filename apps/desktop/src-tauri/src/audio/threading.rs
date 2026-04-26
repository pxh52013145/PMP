use std::cell::Cell;

use crate::audio::realtime_scheduler::RealtimePressureProfile;
use crate::audio::stability::AudioSourcePrepareProfile;
use once_cell::sync::Lazy;

#[derive(Clone, Copy, Debug)]
enum PriorityProfileCap {
    Normal,
    Guarded,
    Critical,
}

impl PriorityProfileCap {
    fn from_env() -> Self {
        let raw = std::env::var("PMP_AUDIO_PRIORITY_PROFILE_CAP")
            .ok()
            .unwrap_or_else(|| "critical".to_string());

        match raw.trim().to_ascii_lowercase().as_str() {
            "normal" => Self::Normal,
            "guarded" => Self::Guarded,
            _ => Self::Critical,
        }
    }
}

static PRESSURE_PRIORITY_CAP: Lazy<PriorityProfileCap> = Lazy::new(PriorityProfileCap::from_env);

fn clamp_pressure_profile(profile: RealtimePressureProfile) -> RealtimePressureProfile {
    match (*PRESSURE_PRIORITY_CAP, profile) {
        (PriorityProfileCap::Normal, _) => RealtimePressureProfile::Normal,
        (PriorityProfileCap::Guarded, RealtimePressureProfile::Critical) => {
            RealtimePressureProfile::Guarded
        }
        _ => profile,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ThreadRole {
    Decode,
    Transfer,
    Output,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ThreadPriorityBand {
    Normal,
    AboveNormal,
    Highest,
    TimeCritical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MmcssPriorityBand {
    Normal,
    High,
    Critical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ThreadSchedulingProfile {
    thread_priority: ThreadPriorityBand,
    mmcss_priority: MmcssPriorityBand,
}

fn resolve_thread_scheduling_profile(
    role: ThreadRole,
    source_prepare_profile: AudioSourcePrepareProfile,
    pressure_profile: RealtimePressureProfile,
) -> ThreadSchedulingProfile {
    match role {
        ThreadRole::Output => ThreadSchedulingProfile {
            thread_priority: match pressure_profile {
                RealtimePressureProfile::Critical => ThreadPriorityBand::TimeCritical,
                RealtimePressureProfile::Normal | RealtimePressureProfile::Guarded => {
                    ThreadPriorityBand::Highest
                }
            },
            mmcss_priority: MmcssPriorityBand::Critical,
        },
        ThreadRole::Decode => {
            let thread_priority = match pressure_profile {
                RealtimePressureProfile::Critical | RealtimePressureProfile::Guarded => {
                    ThreadPriorityBand::Highest
                }
                RealtimePressureProfile::Normal => match source_prepare_profile {
                    AudioSourcePrepareProfile::Aggressive | AudioSourcePrepareProfile::Failsafe => {
                        ThreadPriorityBand::Highest
                    }
                    AudioSourcePrepareProfile::Baseline | AudioSourcePrepareProfile::Steady => {
                        ThreadPriorityBand::AboveNormal
                    }
                },
            };
            let mmcss_priority = match source_prepare_profile {
                AudioSourcePrepareProfile::Baseline => MmcssPriorityBand::Normal,
                AudioSourcePrepareProfile::Steady
                | AudioSourcePrepareProfile::Aggressive
                | AudioSourcePrepareProfile::Failsafe => MmcssPriorityBand::High,
            };
            ThreadSchedulingProfile {
                thread_priority,
                mmcss_priority,
            }
        }
        ThreadRole::Transfer => {
            let thread_priority = match pressure_profile {
                RealtimePressureProfile::Critical => ThreadPriorityBand::Highest,
                RealtimePressureProfile::Guarded => match source_prepare_profile {
                    AudioSourcePrepareProfile::Aggressive | AudioSourcePrepareProfile::Failsafe => {
                        ThreadPriorityBand::Highest
                    }
                    AudioSourcePrepareProfile::Baseline | AudioSourcePrepareProfile::Steady => {
                        ThreadPriorityBand::AboveNormal
                    }
                },
                RealtimePressureProfile::Normal => match source_prepare_profile {
                    AudioSourcePrepareProfile::Baseline => ThreadPriorityBand::Normal,
                    AudioSourcePrepareProfile::Steady
                    | AudioSourcePrepareProfile::Aggressive
                    | AudioSourcePrepareProfile::Failsafe => ThreadPriorityBand::AboveNormal,
                },
            };
            let mmcss_priority = match source_prepare_profile {
                AudioSourcePrepareProfile::Aggressive | AudioSourcePrepareProfile::Failsafe => {
                    MmcssPriorityBand::High
                }
                AudioSourcePrepareProfile::Baseline | AudioSourcePrepareProfile::Steady => {
                    MmcssPriorityBand::Normal
                }
            };
            ThreadSchedulingProfile {
                thread_priority,
                mmcss_priority,
            }
        }
    }
}

#[cfg(target_os = "windows")]
thread_local! {
    static CURRENT_AUDIO_THREAD_ROLE: Cell<u8> = const { Cell::new(0) };
    static CURRENT_AUDIO_MMCSS_HANDLE_RAW: Cell<isize> = const { Cell::new(0) };
}

#[cfg(target_os = "windows")]
fn thread_role_tag(role: ThreadRole) -> u8 {
    match role {
        ThreadRole::Decode => 1,
        ThreadRole::Transfer => 2,
        ThreadRole::Output => 3,
    }
}

#[cfg(target_os = "windows")]
fn register_current_audio_thread_context(
    role: ThreadRole,
    handle: Option<windows::Win32::Foundation::HANDLE>,
) {
    CURRENT_AUDIO_THREAD_ROLE.with(|current| current.set(thread_role_tag(role)));
    CURRENT_AUDIO_MMCSS_HANDLE_RAW.with(|raw| raw.set(handle.map(|value| value.0).unwrap_or(0)));
}

#[cfg(target_os = "windows")]
fn clear_current_audio_thread_context(role: ThreadRole) {
    let tag = thread_role_tag(role);
    CURRENT_AUDIO_THREAD_ROLE.with(|current| {
        if current.get() == tag {
            current.set(0);
        }
    });
    CURRENT_AUDIO_MMCSS_HANDLE_RAW.with(|raw| raw.set(0));
}

#[cfg(target_os = "windows")]
fn translate_thread_priority_band(
    band: ThreadPriorityBand,
) -> windows::Win32::System::Threading::THREAD_PRIORITY {
    use windows::Win32::System::Threading::{
        THREAD_PRIORITY_ABOVE_NORMAL, THREAD_PRIORITY_HIGHEST, THREAD_PRIORITY_NORMAL,
        THREAD_PRIORITY_TIME_CRITICAL,
    };

    match band {
        ThreadPriorityBand::Normal => THREAD_PRIORITY_NORMAL,
        ThreadPriorityBand::AboveNormal => THREAD_PRIORITY_ABOVE_NORMAL,
        ThreadPriorityBand::Highest => THREAD_PRIORITY_HIGHEST,
        ThreadPriorityBand::TimeCritical => THREAD_PRIORITY_TIME_CRITICAL,
    }
}

#[cfg(target_os = "windows")]
fn translate_mmcss_priority_band(
    band: MmcssPriorityBand,
) -> windows::Win32::System::Threading::AVRT_PRIORITY {
    use windows::Win32::System::Threading::{
        AVRT_PRIORITY_CRITICAL, AVRT_PRIORITY_HIGH, AVRT_PRIORITY_NORMAL,
    };

    match band {
        MmcssPriorityBand::Normal => AVRT_PRIORITY_NORMAL,
        MmcssPriorityBand::High => AVRT_PRIORITY_HIGH,
        MmcssPriorityBand::Critical => AVRT_PRIORITY_CRITICAL,
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_thread_scheduling(role: ThreadRole, profile: RealtimePressureProfile) {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Threading::{
        AvSetMmThreadPriority, GetCurrentThread, SetThreadPriority,
    };

    let effective_pressure = profile.max(crate::audio::stability::current_runtime_action_profile());
    let profile = resolve_thread_scheduling_profile(
        role,
        crate::audio::stability::current_source_prepare_profile(),
        clamp_pressure_profile(effective_pressure),
    );

    unsafe {
        let _ = SetThreadPriority(
            GetCurrentThread(),
            translate_thread_priority_band(profile.thread_priority),
        );
    }

    CURRENT_AUDIO_MMCSS_HANDLE_RAW.with(|raw| {
        let value = raw.get();
        if value == 0 {
            return;
        }
        unsafe {
            let _ = AvSetMmThreadPriority(
                HANDLE(value),
                translate_mmcss_priority_band(profile.mmcss_priority),
            );
        }
    });
}

#[derive(Default)]
pub(crate) struct ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    mmcss_handle: Option<windows::Win32::Foundation::HANDLE>,
    #[cfg(target_os = "windows")]
    role: Option<ThreadRole>,
    #[cfg(target_os = "windows")]
    background_mode_enabled: bool,
}

impl Drop for ThreadPriorityGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        unsafe {
            if let Some(role) = self.role.take() {
                clear_current_audio_thread_context(role);
            }

            if self.background_mode_enabled {
                let _ = windows::Win32::System::Threading::SetThreadPriority(
                    windows::Win32::System::Threading::GetCurrentThread(),
                    windows::Win32::System::Threading::THREAD_MODE_BACKGROUND_END,
                );
                self.background_mode_enabled = false;
            }

            if let Some(handle) = self.mmcss_handle.take() {
                let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(handle);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn promote_current_thread_for_audio_role(role: ThreadRole) -> ThreadPriorityGuard {
    use windows::core::w;
    use windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW;

    let mut task_index = 0u32;
    let handle = unsafe {
        match role {
            ThreadRole::Output => AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index))
                .ok(),
            ThreadRole::Decode | ThreadRole::Transfer => {
                AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index)
                    .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index))
                    .ok()
            }
        }
    };

    register_current_audio_thread_context(role, handle);
    apply_windows_thread_scheduling(role, RealtimePressureProfile::Normal);

    ThreadPriorityGuard {
        mmcss_handle: handle,
        role: Some(role),
        background_mode_enabled: false,
    }
}

pub(crate) fn promote_current_thread_for_audio_decode() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        promote_current_thread_for_audio_role(ThreadRole::Decode)
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn promote_current_thread_for_audio_transfer() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        promote_current_thread_for_audio_role(ThreadRole::Transfer)
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn promote_current_thread_for_audio_output() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        promote_current_thread_for_audio_role(ThreadRole::Output)
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn apply_audio_output_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        apply_windows_thread_scheduling(ThreadRole::Output, profile);
    }
}

pub(crate) fn apply_audio_decode_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        apply_windows_thread_scheduling(ThreadRole::Decode, profile);
    }
}

pub(crate) fn apply_audio_transfer_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        apply_windows_thread_scheduling(ThreadRole::Transfer, profile);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_pressure_profile_respects_cap() {
        assert_eq!(
            clamp_pressure_profile(RealtimePressureProfile::Normal),
            RealtimePressureProfile::Normal
        );

        match *PRESSURE_PRIORITY_CAP {
            PriorityProfileCap::Normal => {
                assert_eq!(
                    clamp_pressure_profile(RealtimePressureProfile::Guarded),
                    RealtimePressureProfile::Normal
                );
                assert_eq!(
                    clamp_pressure_profile(RealtimePressureProfile::Critical),
                    RealtimePressureProfile::Normal
                );
            }
            PriorityProfileCap::Guarded => {
                assert_eq!(
                    clamp_pressure_profile(RealtimePressureProfile::Guarded),
                    RealtimePressureProfile::Guarded
                );
                assert_eq!(
                    clamp_pressure_profile(RealtimePressureProfile::Critical),
                    RealtimePressureProfile::Guarded
                );
            }
            PriorityProfileCap::Critical => {
                assert_eq!(
                    clamp_pressure_profile(RealtimePressureProfile::Critical),
                    RealtimePressureProfile::Critical
                );
            }
        }
    }

    #[test]
    fn output_thread_keeps_top_priority_lane() {
        let schedule = resolve_thread_scheduling_profile(
            ThreadRole::Output,
            AudioSourcePrepareProfile::Aggressive,
            RealtimePressureProfile::Critical,
        );
        assert_eq!(schedule.thread_priority, ThreadPriorityBand::TimeCritical);
        assert_eq!(schedule.mmcss_priority, MmcssPriorityBand::Critical);
    }

    #[test]
    fn decode_thread_never_escalates_to_time_critical() {
        let schedule = resolve_thread_scheduling_profile(
            ThreadRole::Decode,
            AudioSourcePrepareProfile::Failsafe,
            RealtimePressureProfile::Critical,
        );
        assert_eq!(schedule.thread_priority, ThreadPriorityBand::Highest);
        assert_eq!(schedule.mmcss_priority, MmcssPriorityBand::High);
    }

    #[test]
    fn transfer_thread_stays_below_output_lane() {
        let transfer = resolve_thread_scheduling_profile(
            ThreadRole::Transfer,
            AudioSourcePrepareProfile::Steady,
            RealtimePressureProfile::Critical,
        );
        let output = resolve_thread_scheduling_profile(
            ThreadRole::Output,
            AudioSourcePrepareProfile::Steady,
            RealtimePressureProfile::Critical,
        );
        assert_eq!(transfer.thread_priority, ThreadPriorityBand::Highest);
        assert_eq!(output.thread_priority, ThreadPriorityBand::TimeCritical);
    }
}
