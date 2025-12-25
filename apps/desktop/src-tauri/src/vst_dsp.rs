use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::vst_shm::ShmRing;
use crate::{vst_audit, vst_governance};

const MAX_BLOCK_FRAMES: usize = 512;
const MAX_DRAIN_FRAMES_PER_CALL: usize = 8192;
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_millis(250);
const HEARTBEAT_STALL_TIMEOUT: Duration = Duration::from_millis(1500);
const RESTART_BACKOFF_BASE_MS: u64 = 500;
const RESTART_BACKOFF_MAX_MS: u64 = 60_000;
const DISABLE_AFTER_FAILURES: u32 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FailureReason {
    Unknown,
    WriteBackpressure,
    PeerNotReady,
    HeartbeatStalled,
    TransportOpenFailed,
    RestartFailed,
}

impl FailureReason {
    fn as_str(&self) -> &'static str {
        match self {
            FailureReason::Unknown => "unknown",
            FailureReason::WriteBackpressure => "write-backpressure",
            FailureReason::PeerNotReady => "peer-not-ready",
            FailureReason::HeartbeatStalled => "heartbeat-stalled",
            FailureReason::TransportOpenFailed => "transport-open-failed",
            FailureReason::RestartFailed => "restart-failed",
        }
    }
}

struct ShmAudioTransport {
    in_ring: ShmRing,
    out_ring: ShmRing,
    channels: usize,
}

impl ShmAudioTransport {
    fn open(shm_in_name: &str, shm_out_name: &str) -> Option<Self> {
        let in_ring = ShmRing::open(shm_in_name).ok()?;
        let out_ring = ShmRing::open(shm_out_name).ok()?;
        let channels = in_ring.channels();
        if channels == 0 || out_ring.channels() != channels {
            return None;
        }
        Some(Self {
            in_ring,
            out_ring,
            channels,
        })
    }

    fn is_peer_ready(&self) -> bool {
        self.in_ring.header().is_peer_ready() && self.out_ring.header().is_peer_ready()
    }

    fn heartbeats(&self) -> (u32, u32) {
        (
            self.in_ring.header().heartbeat.load(Ordering::Relaxed),
            self.out_ring.header().heartbeat.load(Ordering::Relaxed),
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VstNodeKey {
    pub node_id: String,
    pub plugin_id: String,
    pub shm_in_name: String,
    pub shm_out_name: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub capacity_frames: u32,
    pub latency_frames: u32,
}

#[derive(Clone, Debug)]
pub struct VstNodeSpec {
    pub key: VstNodeKey,
}

pub struct VstDspNode {
    key: VstNodeKey,
    transport: Option<ShmAudioTransport>,
    latency_frames: usize,
    channels: usize,
    delay_ring: Vec<f32>,
    write_total_frames: u64,
    shm_base_frame: u64,
    shm_written_frames: u64,
    shm_read_frames: u64,
    scratch_in: Vec<f32>,
    scratch_out: Vec<f32>,
    last_drain_attempt: Instant,
    last_health_check: Instant,
    last_heartbeat_progress: Instant,
    last_heartbeat_in: u32,
    last_heartbeat_out: u32,
    consecutive_failures: u32,
    next_restart_at: Instant,
    last_failure_reason: FailureReason,
    restart_rx: Option<mpsc::Receiver<Result<crate::vst_runtime::VstAudioSessionInfo, String>>>,
}

impl VstDspNode {
    pub fn key(&self) -> &VstNodeKey {
        &self.key
    }

    pub fn new(spec: VstNodeSpec) -> Self {
        let key = spec.key;
        let transport = ShmAudioTransport::open(key.shm_in_name.as_str(), key.shm_out_name.as_str());

        let channels = key.channels.max(1) as usize;
        let mut latency_frames = key.latency_frames.max(1) as usize;

        if let Some(transport) = transport.as_ref() {
            let capacity = transport.in_ring.capacity_frames();
            if capacity > MAX_BLOCK_FRAMES {
                latency_frames = latency_frames.min(capacity.saturating_sub(MAX_BLOCK_FRAMES));
            } else {
                latency_frames = 1;
            }
        }

        let delay_ring = vec![0.0; latency_frames.saturating_mul(channels).max(1)];
        let now = Instant::now();
        let (last_heartbeat_in, last_heartbeat_out) = transport
            .as_ref()
            .map(|transport| transport.heartbeats())
            .unwrap_or((0, 0));

        Self {
            key,
            transport,
            latency_frames,
            channels,
            delay_ring,
            write_total_frames: 0,
            shm_base_frame: 0,
            shm_written_frames: 0,
            shm_read_frames: 0,
            scratch_in: Vec::new(),
            scratch_out: Vec::new(),
            last_drain_attempt: now,
            last_health_check: now,
            last_heartbeat_progress: now,
            last_heartbeat_in,
            last_heartbeat_out,
            consecutive_failures: 0,
            next_restart_at: now,
            last_failure_reason: FailureReason::Unknown,
            restart_rx: None,
        }
    }

    pub fn reset(&mut self) {
        self.delay_ring.fill(0.0);
        self.write_total_frames = 0;
        self.shm_base_frame = 0;
        self.shm_written_frames = 0;
        self.shm_read_frames = 0;
        self.consecutive_failures = 0;
        self.next_restart_at = Instant::now();
        self.last_failure_reason = FailureReason::Unknown;
        self.restart_rx = None;
    }

    pub fn process_interleaved_in_place(&mut self, samples: &mut [f32]) {
        if self.channels == 0 {
            return;
        }
        let frames = samples.len() / self.channels;
        if frames == 0 || self.latency_frames == 0 {
            return;
        }

        self.poll_restart_result();
        self.maybe_check_health();
        self.maybe_start_restart();

        self.drain_processed_frames(frames);

        let total_frames = frames;
        for start_frame in (0..total_frames).step_by(MAX_BLOCK_FRAMES) {
            let block_frames = (total_frames - start_frame).min(MAX_BLOCK_FRAMES);
            let start_sample = start_frame * self.channels;
            let end_sample = start_sample + block_frames * self.channels;
            self.process_block(&mut samples[start_sample..end_sample], block_frames);
        }
    }

    fn process_block(&mut self, samples: &mut [f32], frames: usize) {
        if frames == 0 {
            return;
        }

        self.scratch_in.resize(frames * self.channels, 0.0);

        for frame in 0..frames {
            let global_frame = self.write_total_frames + frame as u64;
            let ring_frame = (global_frame % self.latency_frames as u64) as usize;
            let ring_base = ring_frame * self.channels;
            let block_base = frame * self.channels;
            for ch in 0..self.channels {
                let idx = block_base + ch;
                let input = samples[idx];
                self.scratch_in[idx] = input;

                samples[idx] = self.delay_ring[ring_base + ch];
                self.delay_ring[ring_base + ch] = input;
            }
        }

        if let Some(transport) = self.transport.as_ref() {
            if transport.channels == self.channels {
                let ok = transport.in_ring.try_write_interleaved_all(&self.scratch_in);
                if ok {
                    self.shm_written_frames += frames as u64;
                } else {
                    self.mark_failure(FailureReason::WriteBackpressure);
                }
            }
        }

        self.write_total_frames += frames as u64;
    }

    fn drain_processed_frames(&mut self, expected_next_frames: usize) {
        let now = Instant::now();
        if now.duration_since(self.last_drain_attempt) < Duration::from_millis(1) {
            return;
        }
        self.last_drain_attempt = now;

        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        let shm_out = &transport.out_ring;
        if shm_out.channels() != self.channels {
            return;
        }
        if self.latency_frames == 0 {
            return;
        }

        let mut budget_frames = expected_next_frames
            .saturating_add(MAX_BLOCK_FRAMES)
            .min(MAX_DRAIN_FRAMES_PER_CALL);
        while budget_frames > 0 {
            let available = shm_out.available_to_read_frames();
            if available == 0 {
                break;
            }
            let frames = available.min(MAX_BLOCK_FRAMES).min(budget_frames);
            self.scratch_out.resize(frames * self.channels, 0.0);
            if !shm_out.try_read_interleaved_all(&mut self.scratch_out) {
                break;
            }

            for frame in 0..frames {
                let global_frame = self.shm_base_frame + self.shm_read_frames + frame as u64;
                if global_frame + self.latency_frames as u64 <= self.write_total_frames {
                    continue;
                }
                if global_frame >= self.write_total_frames {
                    break;
                }

                let ring_frame = (global_frame % self.latency_frames as u64) as usize;
                let ring_base = ring_frame * self.channels;
                let src_base = frame * self.channels;
                for ch in 0..self.channels {
                    self.delay_ring[ring_base + ch] = self.scratch_out[src_base + ch];
                }
            }

            self.shm_read_frames += frames as u64;
            budget_frames = budget_frames.saturating_sub(frames);
        }
    }

    fn mark_failure(&mut self, reason: FailureReason) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        self.transport = None;
        self.restart_rx = None;
        self.last_failure_reason = reason;

        let shift = self.consecutive_failures.saturating_sub(1).min(6);
        let backoff_ms = RESTART_BACKOFF_BASE_MS.saturating_mul(1u64 << shift);
        let backoff_ms = backoff_ms.min(RESTART_BACKOFF_MAX_MS);
        self.next_restart_at = Instant::now() + Duration::from_millis(backoff_ms);
    }

    fn poll_restart_result(&mut self) {
        let Some(rx) = self.restart_rx.as_ref() else {
            return;
        };

        match rx.try_recv() {
            Ok(Ok(info)) => {
                match ShmAudioTransport::open(info.shm_in_name.as_str(), info.shm_out_name.as_str()) {
                    Some(transport) => {
                        self.key.shm_in_name = info.shm_in_name;
                        self.key.shm_out_name = info.shm_out_name;
                        self.key.sample_rate = info.sample_rate;
                        self.key.channels = info.channels as u32;
                        self.key.capacity_frames = info.capacity_frames;

                        self.transport = Some(transport);
                        self.shm_base_frame = self.write_total_frames;
                        self.shm_written_frames = 0;
                        self.shm_read_frames = 0;
                        self.consecutive_failures = 0;
                        self.last_health_check = Instant::now();
                        self.last_heartbeat_progress = Instant::now();
                        if let Some(transport) = self.transport.as_ref() {
                            let (hb_in, hb_out) = transport.heartbeats();
                            self.last_heartbeat_in = hb_in;
                            self.last_heartbeat_out = hb_out;
                        }
                    }
                    _ => self.mark_failure(FailureReason::TransportOpenFailed),
                }
                self.restart_rx = None;
            }
            Ok(Err(_err)) => {
                self.restart_rx = None;
                self.mark_failure(FailureReason::RestartFailed);
            }
            Err(mpsc::TryRecvError::Empty) => {}
            Err(mpsc::TryRecvError::Disconnected) => {
                self.restart_rx = None;
                self.mark_failure(FailureReason::RestartFailed);
            }
        }
    }

    fn maybe_start_restart(&mut self) {
        if self.transport.is_some() {
            return;
        }
        if self.restart_rx.is_some() {
            return;
        }

        let now = Instant::now();
        if now < self.next_restart_at {
            return;
        }

        let node_id = self.key.node_id.clone();
        let plugin_id = self.key.plugin_id.clone();
        let sample_rate = self.key.sample_rate.max(1);
        let channels = self.key.channels.max(1) as usize;
        let capacity_frames = self.key.capacity_frames.max(1);
        let failures = self.consecutive_failures;
        let reason = self.last_failure_reason;

        if vst_governance::is_plugin_disabled(plugin_id.as_str()) {
            return;
        }

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            vst_audit::record_event(
                vst_audit::VstAuditEventKind::RestartAttempt,
                Some(node_id.clone()),
                Some(plugin_id.clone()),
                format!("reason={} failures={failures}", reason.as_str()),
            );

            if failures >= DISABLE_AFTER_FAILURES {
                let disable_reason = format!(
                    "Auto-disabled after {failures} consecutive failures (lastReason={})",
                    reason.as_str()
                );
                let _ = vst_governance::disable_plugin(
                    plugin_id.clone(),
                    Some(node_id.clone()),
                    disable_reason,
                    Some(failures),
                );
                let _ = tx.send(Err(format!("VST plugin disabled by governance: {plugin_id}")));
                return;
            }

            let _ = crate::vst_runtime::dispose_session(node_id.clone());
            let result = crate::vst_runtime::ensure_audio_session(
                node_id.as_str(),
                plugin_id.as_str(),
                sample_rate,
                channels,
                capacity_frames,
            );

            match &result {
                Ok(_) => vst_audit::record_event(
                    vst_audit::VstAuditEventKind::RestartSucceeded,
                    Some(node_id.clone()),
                    Some(plugin_id.clone()),
                    "restart ok".to_string(),
                ),
                Err(err) => vst_audit::record_event(
                    vst_audit::VstAuditEventKind::RestartFailed,
                    Some(node_id.clone()),
                    Some(plugin_id.clone()),
                    err.clone(),
                ),
            }

            let _ = tx.send(result);
        });

        self.restart_rx = Some(rx);
    }

    fn maybe_check_health(&mut self) {
        let now = Instant::now();
        if now.duration_since(self.last_health_check) < HEALTH_CHECK_INTERVAL {
            return;
        }
        self.last_health_check = now;

        let Some(transport) = self.transport.as_ref() else {
            return;
        };
        if !transport.is_peer_ready() {
            self.mark_failure(FailureReason::PeerNotReady);
            return;
        }

        let (hb_in, hb_out) = transport.heartbeats();
        if hb_in != self.last_heartbeat_in || hb_out != self.last_heartbeat_out {
            self.last_heartbeat_in = hb_in;
            self.last_heartbeat_out = hb_out;
            self.last_heartbeat_progress = now;
            return;
        }

        if now.duration_since(self.last_heartbeat_progress) > HEARTBEAT_STALL_TIMEOUT {
            self.mark_failure(FailureReason::HeartbeatStalled);
        }
    }
}
