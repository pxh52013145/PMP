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

pub(crate) fn set_current_thread_background_mode_best_effort() -> ThreadPriorityGuard {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
        };

        let enabled =
            unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN).is_ok() };

        ThreadPriorityGuard {
            mmcss_handle: None,
            background_mode_enabled: enabled,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        ThreadPriorityGuard::default()
    }
}
