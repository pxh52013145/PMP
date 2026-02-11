use crate::audio::realtime_scheduler::RealtimePressureProfile;

#[derive(Default)]
pub(crate) struct ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    mmcss_handle: Option<windows::Win32::Foundation::HANDLE>,
    #[cfg(target_os = "windows")]
    background_mode_enabled: bool,
}

impl Drop for ThreadPriorityGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        unsafe {
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

pub(crate) fn promote_current_thread_for_audio_decode() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        use windows::core::w;
        use windows::Win32::System::Threading::{
            AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority, GetCurrentThread,
            SetThreadPriority, AVRT_PRIORITY_NORMAL, THREAD_PRIORITY_ABOVE_NORMAL,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
        }

        let mut task_index = 0u32;
        let handle = unsafe {
            AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index))
                .ok()
        };

        if let Some(handle) = handle {
            unsafe {
                let _ = AvSetMmThreadPriority(handle, AVRT_PRIORITY_NORMAL);
            }
        }

        ThreadPriorityGuard {
            mmcss_handle: handle,
            background_mode_enabled: false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn promote_current_thread_for_audio_transfer() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        use windows::core::w;
        use windows::Win32::System::Threading::{
            AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority, GetCurrentThread,
            SetThreadPriority, AVRT_PRIORITY_LOW, THREAD_PRIORITY_NORMAL,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_NORMAL);
        }

        let mut task_index = 0u32;
        let handle = unsafe {
            AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index))
                .ok()
        };

        if let Some(handle) = handle {
            unsafe {
                let _ = AvSetMmThreadPriority(handle, AVRT_PRIORITY_LOW);
            }
        }

        ThreadPriorityGuard {
            mmcss_handle: handle,
            background_mode_enabled: false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn promote_current_thread_for_audio_output() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        use windows::core::w;
        use windows::Win32::System::Threading::{
            AvSetMmThreadCharacteristicsW, AvSetMmThreadPriority, GetCurrentThread,
            SetThreadPriority, AVRT_PRIORITY_HIGH, THREAD_PRIORITY_HIGHEST,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
        }

        let mut task_index = 0u32;
        let handle = unsafe {
            AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index)
                .or_else(|_| AvSetMmThreadCharacteristicsW(w!("Audio"), &mut task_index))
                .ok()
        };

        if let Some(handle) = handle {
            unsafe {
                let _ = AvSetMmThreadPriority(handle, AVRT_PRIORITY_HIGH);
            }
        }

        ThreadPriorityGuard {
            mmcss_handle: handle,
            background_mode_enabled: false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}

pub(crate) fn apply_audio_output_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority,
            THREAD_PRIORITY_HIGHEST, THREAD_PRIORITY_TIME_CRITICAL,
        };

        let priority = match profile {
            RealtimePressureProfile::Normal => THREAD_PRIORITY_HIGHEST,
            RealtimePressureProfile::Guarded => THREAD_PRIORITY_HIGHEST,
            RealtimePressureProfile::Critical => THREAD_PRIORITY_TIME_CRITICAL,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), priority);
        }
    }
}

pub(crate) fn apply_audio_decode_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
            THREAD_PRIORITY_HIGHEST,
        };

        let priority = match profile {
            RealtimePressureProfile::Normal => THREAD_PRIORITY_ABOVE_NORMAL,
            RealtimePressureProfile::Guarded => THREAD_PRIORITY_HIGHEST,
            RealtimePressureProfile::Critical => THREAD_PRIORITY_HIGHEST,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), priority);
        }
    }
}

pub(crate) fn apply_audio_transfer_pressure_profile(profile: RealtimePressureProfile) {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
            THREAD_PRIORITY_NORMAL,
        };

        let priority = match profile {
            RealtimePressureProfile::Normal => THREAD_PRIORITY_NORMAL,
            RealtimePressureProfile::Guarded => THREAD_PRIORITY_NORMAL,
            RealtimePressureProfile::Critical => THREAD_PRIORITY_ABOVE_NORMAL,
        };

        unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), priority);
        }
    }
}

