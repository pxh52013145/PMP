use once_cell::sync::{Lazy, OnceCell};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use windows::{
    core::HSTRING,
    Foundation::{TypedEventHandler, TimeSpan},
    Media::{
        MediaPlaybackStatus, MediaPlaybackType,
        SystemMediaTransportControls, SystemMediaTransportControlsButton,
        SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    },
    Win32::Foundation::HWND,
    Win32::System::WinRT::{
        ISystemMediaTransportControlsInterop, RoGetActivationFactory, RoInitialize,
        RO_INIT_MULTITHREADED, RO_INIT_SINGLETHREADED,
    },
};

use crate::windows::EVENT_TASKBAR_MEDIA_CONTROL;
use crate::windows::taskbar_thumbbar::TaskbarMediaControlPayload;

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();

static SMTC: Lazy<Mutex<Option<SmtcController>>> = Lazy::new(|| Mutex::new(None));

struct SmtcController {
    controls: SystemMediaTransportControls,
    last_track_path: Option<String>,
    last_playback_state: Option<String>,
    last_timeline_position_sec: i64,
    last_timeline_duration_sec: i64,
    last_timeline_updated_at: Instant,
}

fn ensure_winrt_initialized() {
    // Best-effort: some environments are already initialized (STA/MTA).
    // We only need WinRT for SMTC registration and events.
    unsafe {
        if RoInitialize(RO_INIT_MULTITHREADED).is_ok() {
            return;
        }
        let _ = RoInitialize(RO_INIT_SINGLETHREADED);
    }
}

fn emit_action(action: &'static str) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    let _ = app.emit_all(EVENT_TASKBAR_MEDIA_CONTROL, TaskbarMediaControlPayload { action });
}

fn title_from_track_path(track_path: &str) -> String {
    let trimmed = track_path.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let path = Path::new(trimmed);
    if let Some(stem) = path.file_stem().and_then(|v| v.to_str()) {
        let title = stem.trim();
        if !title.is_empty() {
            return title.to_string();
        }
    }
    if let Some(name) = path.file_name().and_then(|v| v.to_str()) {
        let title = name.trim();
        if !title.is_empty() {
            return title.to_string();
        }
    }
    trimmed.to_string()
}

fn playback_status_from_str(state: &str) -> MediaPlaybackStatus {
    match state {
        "playing" => MediaPlaybackStatus::Playing,
        "paused" | "loading" => MediaPlaybackStatus::Paused,
        "stopped" | "idle" | "error" => MediaPlaybackStatus::Stopped,
        _ => MediaPlaybackStatus::Stopped,
    }
}

pub fn init(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());

    let mut registry = match SMTC.lock() {
        Ok(v) => v,
        Err(_) => return,
    };
    if registry.is_some() {
        return;
    }

    ensure_winrt_initialized();

    let Some(window) = app.get_window(crate::windows::MAIN_WINDOW_LABEL) else {
        eprintln!("[SMTC] Main window not found");
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        eprintln!("[SMTC] Failed to get main window HWND");
        return;
    };

    let controls = (|| unsafe {
        let factory: ISystemMediaTransportControlsInterop = RoGetActivationFactory(&HSTRING::from(
            "Windows.Media.SystemMediaTransportControls",
        ))?;
        factory.GetForWindow::<_, SystemMediaTransportControls>(HWND(hwnd.0 as isize))
    })()
    .map_err(|err| format!("{err:?}"));

    let controls = match controls {
        Ok(v) => v,
        Err(err) => {
            eprintln!("[SMTC] Failed to get controls via interop: {err}");
            return;
        }
    };

    let _ = controls.SetIsEnabled(true);
    let _ = controls.SetIsPlayEnabled(true);
    let _ = controls.SetIsPauseEnabled(true);
    let _ = controls.SetIsNextEnabled(true);
    let _ = controls.SetIsPreviousEnabled(true);
    let _ = controls.SetIsStopEnabled(true);

    // Register button handlers (global media keys, media flyout, lock screen).
    let handler = TypedEventHandler::new(
        move |_, args: &Option<SystemMediaTransportControlsButtonPressedEventArgs>| {
            if let Some(args) = args {
                let known = match args.Button()? {
                    SystemMediaTransportControlsButton::Next => Some("next"),
                    SystemMediaTransportControlsButton::Previous => Some("previous"),
                    SystemMediaTransportControlsButton::Play => Some("playPause"),
                    SystemMediaTransportControlsButton::Pause => Some("playPause"),
                    SystemMediaTransportControlsButton::Stop => Some("stop"),
                    _ => None,
                };
                if let Some(action) = known {
                    emit_action(action);
                }
            }
            Ok(())
        },
    );
    let _ = controls.ButtonPressed(&handler);

    *registry = Some(SmtcController {
        controls,
        last_track_path: None,
        last_playback_state: None,
        last_timeline_position_sec: -1,
        last_timeline_duration_sec: -1,
        last_timeline_updated_at: Instant::now().checked_sub(Duration::from_secs(60)).unwrap_or_else(Instant::now),
    });
}

pub fn sync_from_native_audio_state(
    playback_state: &str,
    track_path: Option<&str>,
    position_seconds: f64,
    duration_seconds: f64,
) {
    let mut registry = match SMTC.lock() {
        Ok(v) => v,
        Err(_) => return,
    };
    let Some(controller) = registry.as_mut() else {
        return;
    };

    let track_path = track_path.map(|v| v.trim()).filter(|v| !v.is_empty());
    let playback_state = playback_state.trim();

    if controller.last_playback_state.as_deref() != Some(playback_state) {
        let status = playback_status_from_str(playback_state);
        let _ = controller.controls.SetPlaybackStatus(status);
        controller.last_playback_state = Some(playback_state.to_string());
    }

    let track_changed = match (&controller.last_track_path, track_path) {
        (None, None) => false,
        (Some(prev), Some(next)) => prev != next,
        _ => true,
    };

    if track_changed {
        controller.last_track_path = track_path.map(|v| v.to_string());

        if let Ok(updater) = controller.controls.DisplayUpdater() {
            let _ = updater.SetType(MediaPlaybackType::Music);
            if let Ok(props) = updater.MusicProperties() {
                let title = track_path.map(title_from_track_path).unwrap_or_default();
                let _ = props.SetTitle(&HSTRING::from(title));
            }
            let _ = updater.Update();
        }
    }

    // Timeline updates can be moderately expensive; throttle.
    let duration_ok = duration_seconds.is_finite() && duration_seconds > 0.0;
    let position_ok = position_seconds.is_finite() && position_seconds >= 0.0;
    if duration_ok && position_ok {
        let duration_sec = duration_seconds.floor() as i64;
        let position_sec = position_seconds.floor() as i64;

        let now = Instant::now();
        let needs_update = track_changed
            || duration_sec != controller.last_timeline_duration_sec
            || position_sec != controller.last_timeline_position_sec
            || now
                .duration_since(controller.last_timeline_updated_at)
                .gt(&Duration::from_secs(1));

        if needs_update {
            controller.last_timeline_updated_at = now;
            controller.last_timeline_duration_sec = duration_sec;
            controller.last_timeline_position_sec = position_sec;

            if let Ok(timeline) = SystemMediaTransportControlsTimelineProperties::new() {
                let _ = timeline.SetStartTime(TimeSpan { Duration: 0 });
                let _ = timeline.SetEndTime(TimeSpan {
                    Duration: (duration_seconds * 10_000_000.0) as i64,
                });
                let _ = timeline.SetPosition(TimeSpan {
                    Duration: (position_seconds * 10_000_000.0) as i64,
                });
                let _ = controller.controls.UpdateTimelineProperties(&timeline);
            }
        }
    }
}
