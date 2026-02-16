# Audio Engine Kernel Blueprint

Updated: 2026-02-16
Scope: `apps/desktop/src-tauri/src/audio/*`, `apps/desktop/src-tauri/src/native_audio.rs`, `apps/desktop/src/services/audio/*`

## 1. Background and problem statement

Current symptoms reported by users:

- On startup, click-to-play can stall for a long time on shared backends (especially WASAPI shared path).
- Track switch and crossfade can also block for too long.
- Runtime behavior gives the impression of old/new path coexistence because interactive operations and robustness policy have different timing goals.

Root cause in current delivery scope:

- Interactive transport operations (`load`, `crossfade`, seek-recovery rebuild) could inherit large prebuffer wait targets and timeout budgets from robustness-oriented buffering policy.
- Under stressed conditions this increases command-path wait time and directly hurts UX responsiveness.

## 2. Target architecture (single-path micro-kernel)

Layering and dependency direction:

1. `audio/kernel` (operation lifecycle + state machine + policy arbitration)
2. `audio/input/*` (decoder providers)
3. `audio/pipeline/*` and DSP graph runtime
4. `audio/output/*` (backend adapters)
5. `native_audio.rs` (Tauri command adapter only)

Hard rule:

- Transport decisions belong to kernel.
- Adapter layer only translates command/event contracts and must not duplicate transport logic.

## 3. Pluggable boundaries

Stable extension points (kept and reinforced):

- Decoder: `AudioInput` + `AudioInputRegistry`
- Output backend: `AudioOutputBackend`
- DSP: `DspRuntime` and node graph configs

No new extension is allowed to bypass these contracts.

## 4. Performance and stability policy set

### 4.1 Interactive wait cap (implemented)

Interactive command path enforces bounded caps regardless of robustness escalation.

Profiles (`PMP_AUDIO_STREAM_INTERACTIVE_PROFILE`):

- `fast`: start/seek `0.24s` + `180ms`, crossfade `0.36s` + `260ms`
- `balanced` (default): start/seek `0.30s` + `220ms`, crossfade `0.45s` + `320ms`
- `stable`: start/seek `0.42s` + `320ms`, crossfade `0.65s` + `450ms`

All values can be overridden by env knobs for device-specific tuning.

Host runtime can also switch profile at runtime via streaming buffer settings (`interactiveProfile`), without requiring process restart.

Implementation entry:

- `streaming_prebuffer_interactive_wait(...)` in `apps/desktop/src-tauri/src/audio/engine.rs`

### 4.2 Robustness policy (retained)

- Underrun-driven adaptive profile (`normal`, `guarded`, `critical`)
- Stress window extension from diagnostics timeline
- Shared backend render-ahead protection

Policy intent:

- Keep steady-state robustness logic for underrun resilience.
- Keep interactive path latency deterministic and bounded.

## 5. Delivery completed in this change set

### 5.1 Engine runtime implementation

- Added `streaming_prebuffer_interactive_wait(...)` helper in `apps/desktop/src-tauri/src/audio/engine.rs`.
- Applied interactive cap helper to all interactive wait points:
  - `load(...)`
  - `crossfade_to(...)`
  - sink rebuild/seek-recovery interactive wait path
  - native crossfade prepare path in `apps/desktop/src-tauri/src/native_audio.rs`
- Introduced dedicated transport orchestration module `apps/desktop/src-tauri/src/audio/kernel.rs` and moved load/crossfade/load-and-play/policy-rebuild operation sequencing out of `native_audio.rs`.
- Continued path unification by routing `play`, `pause`, `stop`, crossfade fallback load/play sequence, and seek command execution through kernel orchestration helpers.
- Added split streaming buffer telemetry in `native_audio_state` (`decodeBufferedAhead`, `outputBufferedAhead`) so UI and diagnostics can distinguish decode headroom vs output headroom.
- Upgraded underrun masking from fixed short ramps to adaptive equal-power ramps (profile + streak aware) in:
  - `apps/desktop/src-tauri/src/audio/input/streaming.rs`
  - `apps/desktop/src-tauri/src/audio/output/render_ahead.rs`
- Applied the same adaptive equal-power declick strategy to WASAPI exclusive/shared-raw render callback path in `apps/desktop/src-tauri/src/audio/output/wasapi_exclusive.rs`, with ms-based env tunables and underrun-streak awareness.
- Phase-2 hardening: underrun masking moved to sample-rate-aware millisecond policy with bounded env knobs, avoiding fixed 96-frame ultra-short ramps that can be perceived as clicks.
- Phase-2 hardening: shared render-ahead pop wait now uses bounded profile-aware waits (`normal/guarded/critical`) to reduce false underrun declaration during short scheduler jitter.
- Native debug robustness panel now shows split headroom (`decodeBufferedAheadSeconds` / `outputBufferedAheadSeconds`) alongside aggregate buffer metrics.

### 5.2 Contract documentation

- Added interactive wait cap contract section to `docs/architecture/contracts/native-audio-engine-policy.md`.

### 5.3 Regression tests

Added/updated unit coverage in `apps/desktop/src-tauri/src/audio/engine.rs`:

- `interactive_prebuffer_wait_caps_start_seek_to_sub_second_target`
- `interactive_prebuffer_wait_caps_crossfade_to_short_timeout`
- `load_operation_latest_token_wins_and_stale_prepare_is_aborted`

The third test verifies latest-wins behavior for rapid load supersession and ensures stale prepared resources are aborted safely.

## 6. Full kernelization roadmap (next phases)

### Phase A (completed)

- Interactive latency cap landed.
- Existing robustness behavior preserved.
- Core regression tests and smoke path validated.

### Phase B (next implementation)

- Introduce dedicated `audio/kernel` orchestrator module.
- Move operation arbitration logic out of `native_audio.rs`.
- Keep `native_audio.rs` as thin command adapter.

Status: **completed in this delivery** for core transport flows (`load`, `crossfade`, `load_and_play`, policy-triggered rebuild).

### Phase C

- Eliminate remaining path divergence by routing all transport operations through one lifecycle.
- Wrap legacy behavior behind adapters only (no parallel logic paths).

Status: **mostly completed in this delivery** for runtime transport commands (`load`, `load_and_play`, `crossfade + fallback`, `play`, `pause`, `stop`, `seek`, policy-triggered rebuild). Remaining work is focused on additional release-gate metrics and long-tail legacy adapters.

### Phase D

- Expand integration and release smoke matrix across backends and stress profiles.
- Add threshold gates for click-to-play/switch latency and underrun regressions.
