use std::sync::mpsc::Receiver;
use std::time::Duration;

use super::{OverlayCommand, OverlayPositionPreset, OverlayText};

#[cfg(target_os = "windows")]
use crate::desktop_lyrics_sidecar::{
    DesktopLyricsSidecarCommand, DesktopLyricsSidecarEvent, DesktopLyricsSidecarText,
};

#[cfg(target_os = "windows")]
fn safe_stderr_log(message: impl AsRef<str>) {
    use std::io::Write;

    let mut stderr = std::io::stderr();
    let _ = writeln!(stderr, "{}", message.as_ref());
}

#[cfg(target_os = "windows")]
fn position_preset_to_wire(preset: OverlayPositionPreset) -> String {
    match preset {
        OverlayPositionPreset::BottomCenter => "bottom-center",
        OverlayPositionPreset::BottomLeft => "bottom-left",
        OverlayPositionPreset::BottomRight => "bottom-right",
        OverlayPositionPreset::TopCenter => "top-center",
    }
    .to_string()
}

#[cfg(target_os = "windows")]
fn map_overlay_command(command: OverlayCommand) -> DesktopLyricsSidecarCommand {
    match command {
        OverlayCommand::SetVisible(visible) => DesktopLyricsSidecarCommand::SetVisible { visible },
        OverlayCommand::SetClickThrough(enabled) => {
            DesktopLyricsSidecarCommand::SetClickThrough { enabled }
        }
        OverlayCommand::SetFontSize(font_size) => {
            DesktopLyricsSidecarCommand::SetFontSize { font_size }
        }
        OverlayCommand::SetOpacityPercent(opacity_percent) => {
            DesktopLyricsSidecarCommand::SetOpacityPercent { opacity_percent }
        }
        OverlayCommand::SetPositionPreset(preset) => {
            DesktopLyricsSidecarCommand::SetPositionPreset {
                preset: position_preset_to_wire(preset),
            }
        }
        OverlayCommand::SetPositionOffset(offset_x, offset_y) => {
            DesktopLyricsSidecarCommand::SetPositionOffset { offset_x, offset_y }
        }
        OverlayCommand::SetRegionSize(width, height) => {
            DesktopLyricsSidecarCommand::SetRegionSize { width, height }
        }
        OverlayCommand::SetText(text) => DesktopLyricsSidecarCommand::SetText {
            text: text.map(
                |OverlayText { primary, secondary }| DesktopLyricsSidecarText {
                    primary,
                    secondary,
                },
            ),
        },
        OverlayCommand::Shutdown => DesktopLyricsSidecarCommand::Shutdown,
    }
}

#[cfg(target_os = "windows")]
mod sidecar_client {
    use super::{safe_stderr_log, DesktopLyricsSidecarCommand, DesktopLyricsSidecarEvent};
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn spawn_stdout_reader(stdout: ChildStdout, ready_flag: Arc<AtomicBool>) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let payload = match line {
                    Ok(content) => content,
                    Err(error) => {
                        safe_stderr_log(format!(
                            "[desktop-lyrics] failed reading sidecar stdout: {error}"
                        ));
                        break;
                    }
                };

                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }

                match serde_json::from_str::<DesktopLyricsSidecarEvent>(payload) {
                    Ok(DesktopLyricsSidecarEvent::Ready) => {
                        ready_flag.store(true, Ordering::SeqCst);
                    }
                    Ok(DesktopLyricsSidecarEvent::Ack { .. }) => {}
                    Ok(DesktopLyricsSidecarEvent::LayoutChanged {
                        offset_x,
                        offset_y,
                        region_width,
                        region_height,
                    }) => {
                        crate::windows::desktop_lyrics::apply_sidecar_layout_changed(
                            offset_x,
                            offset_y,
                            region_width,
                            region_height,
                        );
                    }
                    Ok(DesktopLyricsSidecarEvent::Error { message }) => {
                        safe_stderr_log(format!(
                            "[desktop-lyrics] sidecar reported error: {message}"
                        ));
                    }
                    Err(error) => {
                        safe_stderr_log(format!(
                            "[desktop-lyrics] invalid sidecar stdout payload: {error}"
                        ));
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(stderr: ChildStderr) {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let payload = match line {
                    Ok(content) => content,
                    Err(error) => {
                        safe_stderr_log(format!(
                            "[desktop-lyrics] failed reading sidecar stderr: {error}"
                        ));
                        break;
                    }
                };

                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }

                safe_stderr_log(format!("[desktop-lyrics-sidecar] {payload}"));
            }
        });
    }

    pub struct SidecarProcess {
        child: Child,
        stdin: ChildStdin,
        ready_flag: Arc<AtomicBool>,
    }

    impl SidecarProcess {
        pub fn spawn() -> Result<Self, String> {
            let executable_path = std::env::current_exe()
                .map_err(|error| format!("Resolve current exe failed: {error}"))?;

            let mut command = Command::new(executable_path);
            command
                .arg("--desktop-lyrics-sidecar")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            #[cfg(target_os = "windows")]
            {
                command.creation_flags(CREATE_NO_WINDOW);
            }

            let mut child = command
                .spawn()
                .map_err(|error| format!("Spawn desktop lyrics sidecar failed: {error}"))?;
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "Desktop lyrics sidecar stdin unavailable".to_string())?;

            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "Desktop lyrics sidecar stdout unavailable".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "Desktop lyrics sidecar stderr unavailable".to_string())?;

            let ready_flag = Arc::new(AtomicBool::new(false));
            spawn_stdout_reader(stdout, ready_flag.clone());
            spawn_stderr_reader(stderr);

            Ok(Self {
                child,
                stdin,
                ready_flag,
            })
        }

        pub fn wait_until_ready(&mut self, timeout: Duration) -> bool {
            if self.ready_flag.load(Ordering::SeqCst) {
                return true;
            }

            let start = Instant::now();
            while start.elapsed() < timeout {
                if self.ready_flag.load(Ordering::SeqCst) {
                    return true;
                }

                if self.child.try_wait().ok().flatten().is_some() {
                    return false;
                }

                std::thread::sleep(Duration::from_millis(16));
            }

            self.ready_flag.load(Ordering::SeqCst)
        }

        pub fn send(&mut self, command: &DesktopLyricsSidecarCommand) -> Result<(), String> {
            serde_json::to_writer(&mut self.stdin, command)
                .map_err(|error| format!("Serialize desktop lyrics command failed: {error}"))?;
            self.stdin
                .write_all(b"\n")
                .map_err(|error| format!("Write desktop lyrics command failed: {error}"))?;
            self.stdin
                .flush()
                .map_err(|error| format!("Flush desktop lyrics command failed: {error}"))?;
            Ok(())
        }

        pub fn shutdown(mut self) {
            let _ = self.send(&DesktopLyricsSidecarCommand::Shutdown);

            if self.child.try_wait().ok().flatten().is_none() {
                std::thread::sleep(Duration::from_millis(120));
            }

            if self.child.try_wait().ok().flatten().is_none() {
                let _ = self.child.kill();
            }
            let _ = self.child.wait();
        }
    }
}

#[cfg(target_os = "windows")]
pub fn run(rx: Receiver<OverlayCommand>) {
    use sidecar_client::SidecarProcess;
    use std::sync::mpsc::RecvTimeoutError;

    const SIDECAR_READY_TIMEOUT: Duration = Duration::from_millis(1000);

    let mut sidecar: Option<SidecarProcess> = None;

    loop {
        let command = match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };

        let wire_command = map_overlay_command(command);
        let is_shutdown = matches!(wire_command, DesktopLyricsSidecarCommand::Shutdown);

        if sidecar.is_none() {
            match SidecarProcess::spawn() {
                Ok(mut process) => {
                    if !process.wait_until_ready(SIDECAR_READY_TIMEOUT) {
                        safe_stderr_log(
                            "[desktop-lyrics] sidecar ready timeout, continue with best effort",
                        );
                    }
                    sidecar = Some(process);
                }
                Err(error) => {
                    safe_stderr_log(format!("[desktop-lyrics] failed to spawn sidecar: {error}"));
                    if is_shutdown {
                        break;
                    }
                    continue;
                }
            }
        }

        let send_result = sidecar
            .as_mut()
            .map(|process| process.send(&wire_command))
            .unwrap_or_else(|| Ok(()));

        if let Err(error) = send_result {
            safe_stderr_log(format!("[desktop-lyrics] sidecar send failed: {error}"));
            sidecar = None;

            if !is_shutdown {
                match SidecarProcess::spawn() {
                    Ok(mut process) => {
                        if !process.wait_until_ready(SIDECAR_READY_TIMEOUT) {
                            safe_stderr_log("[desktop-lyrics] sidecar ready timeout after restart");
                        }

                        if let Err(retry_error) = process.send(&wire_command) {
                            safe_stderr_log(format!(
                                "[desktop-lyrics] retry send after sidecar restart failed: {retry_error}"
                            ));
                        } else {
                            sidecar = Some(process);
                        }
                    }
                    Err(spawn_error) => {
                        safe_stderr_log(format!(
                            "[desktop-lyrics] sidecar restart failed after send error: {spawn_error}"
                        ));
                    }
                }
            }
        }

        if is_shutdown {
            break;
        }
    }

    if let Some(process) = sidecar {
        process.shutdown();
    }
}

#[cfg(not(target_os = "windows"))]
pub fn run(rx: Receiver<OverlayCommand>) {
    use std::sync::mpsc::RecvTimeoutError;

    loop {
        let command = match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(command) => command,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };

        if matches!(command, OverlayCommand::Shutdown) {
            break;
        }
    }
}
