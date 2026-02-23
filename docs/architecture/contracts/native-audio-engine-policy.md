# Native Audio Engine Policy Contract

Updated: 2026-02-23
Scope: `apps/desktop/src-tauri/src/audio/*`, `apps/desktop/src/services/audio/*`

## 1. Purpose

This contract defines the host-side policy payload for the native audio engine.
It is designed for modular/puggable backends (WASAPI/ASIO/Rodio/Null) where engine policy is applied through a stable boundary instead of direct backend coupling.

## 2. Engine Policy Payload (Host API)

Rust type: `NativeAudioEnginePolicyPayload`

Fields:

- `transportMode`: `robust` | `transport-exact`
- `hqSrcEnabled`: `boolean`
- `hqSrcPhaseMode`: `linear` | `minimum` | `intermediate`
- `srcMode`: `source-native` | `match-output` | `target-rate`
- `srcBackend`: `rubato` | `linear-simd`
- `srcTargetSampleRate`: `number | null`
- `outputQuantizationMode`: `round` | `tpdf`  **(new)**
- `hqSrcStopbandDb`: `number`
- `transportExactInt32Container`: `boolean`

Patch type: `NativeAudioEnginePolicyPatch` supports partial updates for the same fields.

## 3. New Field: `outputQuantizationMode`

### 3.1 Definition

- `round`: legacy deterministic rounding path with minimal CPU cost.
- `tpdf`: triangular dither applied at quantization point for lower low-level quantization distortion in non-bit-perfect rendering.

### 3.2 Backend integration rule

Backends implement policy propagation through:

- `AudioOutputBackend::set_output_quantization_mode(mode)`

Default implementation is no-op to keep optional/pluggable backend compatibility.

### 3.3 TransportExact compatibility

For transport-exact path with 24-bit-in-32 container output, quantization keeps the transport-exact constrained behavior (legacy deterministic quantization route) to avoid breaking bit-level expectations.

## 4. UI Preset Mapping (Settings)

The advanced settings panel exposes policy combinations via presets:

- `reference`: transport-exact + source-native + round
- `hifi`: robust + target-rate(192k) + rubato + tpdf
- `balanced`: robust + match-output + rubato + tpdf
- `stable`: robust + match-output + linear-simd + round
- `low-power`: robust + target-rate(48k) + linear-simd + round

These presets are UI-layer combinations only; policy remains a stable host contract.

## 5. Compatibility & Versioning

- Existing clients that do not send `outputQuantizationMode` continue to work (engine defaults to `round`).
- New clients should treat unknown enum values defensively and fallback to `round`.
- Contract additions must keep backward-compatible defaults unless a major version migration is explicitly introduced.

## 6. Interactive Wait Cap Contract (Transport UX Guardrail)

To prevent slow click-to-play / track-switch behavior under stressed robustness policy, interactive transport operations obey bounded wait caps on command path.

Default profiles (selected by `PMP_AUDIO_STREAM_INTERACTIVE_PROFILE`):

- `fast`: start/seek `0.24s` + `180ms`, crossfade `0.36s` + `260ms`
- `balanced` (default): start/seek `0.30s` + `220ms`, crossfade `0.45s` + `320ms`
- `stable`: start/seek `0.42s` + `320ms`, crossfade `0.65s` + `450ms`

Optional env overrides:

- `PMP_AUDIO_STREAM_INTERACTIVE_START_CAP_SECONDS`
- `PMP_AUDIO_STREAM_INTERACTIVE_CROSSFADE_CAP_SECONDS`
- `PMP_AUDIO_STREAM_INTERACTIVE_START_TIMEOUT_MS`
- `PMP_AUDIO_STREAM_INTERACTIVE_CROSSFADE_TIMEOUT_MS`
- `PMP_AUDIO_STREAM_INTERACTIVE_SHARED_CAP_SCALE` (default `1.8`)
- `PMP_AUDIO_STREAM_INTERACTIVE_SHARED_TIMEOUT_SCALE` (default `1.6`)

Runtime host setting (persisted in streaming buffer settings):

- `interactiveProfile`: `fast` | `balanced` | `stable`

Runtime command integration:

- `native_audio_set_streaming_buffer_settings` accepts `interactiveProfile` as an optional field.
- `native_audio_get_streaming_buffer_settings` / payload now exposes `interactiveProfile`.

Implementation reference:

- `streaming_prebuffer_interactive_wait(...)` in `apps/desktop/src-tauri/src/audio/engine.rs`

This guardrail remains intentionally independent from steady-state robustness policy so interactive transport latency stays deterministic while allowing profile/env tuning per machine.

Shared backend note:

- Interactive prebuffer caps/timeouts are scaled up for shared backends by default to reduce post-seek/post-switch underrun risk under high contention.

### 6.1 Stream Open Initialization Latency Contract

To keep track-switch latency bounded, streaming open no longer relies solely on first decoded packet before exposing metadata.

- Decoder now emits metadata from codec params when available (channels/sample-rate/duration estimate), enabling early transfer startup.
- Stream init timeout is bounded and configurable via:
  - `PMP_AUDIO_STREAM_INIT_TIMEOUT_MS` (default `2200`, clamped `300..8000`)

### 6.2 StreamingFullTrack Initial Reservoir Contract

`StreamingFullTrack` mode now defaults to low-latency initial reservoir sizing instead of preallocating full budget upfront.

- Default initial sizing uses:
  - `PMP_AUDIO_STREAMING_FULLTRACK_INITIAL_SECONDS` (default `24.0s`, clamped `6..300`)
- Optional legacy behavior (full preallocation):
  - `PMP_AUDIO_STREAMING_FULLTRACK_PREALLOCATE_FULL=1`

Rationale:

- Prevent large ring-buffer preallocation stalls on rapid track switches.
- Keep predictable click-to-play latency while preserving a configurable full-preallocate path for benchmark scenarios.

### 6.3 Streaming Decode Reservoir Baseline

Streaming mode applies a larger decode-reservoir baseline to improve jitter tolerance on
high-rate shared backends.

- `PMP_AUDIO_STREAMING_RESERVOIR_SECONDS` (default `18.0`, clamped `8..180`)

Policy behavior:

- High output sample rates receive additional reservoir scaling (96k/192k paths allocate larger
  decode reservoirs by default).
- Capacity is still bounded by full-track budget guardrails.

### 6.4 Shared Resume Barrier Contract

For shared backends that use render-ahead wrapping (`wasapi`, `rodio-cpal`),
resume-after-seek/track-switch now uses a deterministic readiness barrier instead of
fixed-duration sleep.

Resume gate checks:

- Inner transfer/render queue reaches a bounded minimum resume target.
- Shared render-ahead wrapper reports `ready` for the current `seekEpoch` and has
  enough buffered samples (at least low watermark and guard target).

Env tunables:

- `PMP_AUDIO_SHARED_RESUME_GUARD_SECONDS` (default `0.24`, range `0.0..2.0`):
  maximum guard wait budget.
- `PMP_AUDIO_SHARED_RESUME_GUARD_MIN_SECONDS` (default `0.08`, range `0.0..0.8`):
  minimum buffered-ahead target used by resume gate.

Behavioral guarantee:

- If no active shared render-ahead wrapper exists, the guard path exits immediately.
- Guarding never forces backend switching; backend ownership remains user/host controlled.

Implementation references:

- `play_sink_with_shared_guard(...)` in `apps/desktop/src-tauri/src/audio/engine.rs`
- `wait_for_shared_render_ahead_ready(...)` in `apps/desktop/src-tauri/src/audio/output/render_ahead.rs`

## 7. Streaming Buffer Observability Contract (State Event)

`native_audio_state` now exposes split buffer-headroom signals to separate decode-side pressure from output-side pressure:

- `decodeBufferedAhead`: seconds currently buffered in decoder reservoir.
- `outputBufferedAhead`: seconds currently buffered in render/output queue.

Compatibility notes:

- Existing `bufferedTime` / `bufferedAhead` semantics remain unchanged for backward compatibility.
- New fields are additive and optional for clients; legacy clients can ignore them.

Policy rationale:

- UI can render dual indicators (`decode` vs `output`) to avoid false confidence from aggregate buffered progress.
- Runtime troubleshooting can quickly identify whether glitches stem from decoder throughput or output scheduling jitter.

Host-side robustness snapshot mapping (TypeScript):

- `AudioRobustnessSnapshot.decodeBufferedAheadSeconds`
- `AudioRobustnessSnapshot.outputBufferedAheadSeconds`

These values are derived from `native_audio_state` fields and exposed to debug/monitor panels.

## 8. Underrun Masking and Render-Pop Wait Tuning Contract

To reduce audible click/crackle under transient underruns, underrun masking and render-pop wait use bounded tunables.

Underrun masking env vars (milliseconds):

- `PMP_AUDIO_UNDERRUN_MASK_NORMAL_MS` (default `8`)
- `PMP_AUDIO_UNDERRUN_MASK_GUARDED_MS` (default `14`)
- `PMP_AUDIO_UNDERRUN_MASK_CRITICAL_MS` (default `24`)
- `PMP_AUDIO_UNDERRUN_MASK_STREAK_BOOST_MS` (default `3`)
- `PMP_AUDIO_UNDERRUN_MASK_MIN_MS` (default `4`)
- `PMP_AUDIO_UNDERRUN_MASK_MAX_MS` (default `64`)

Render queue pop wait env vars (milliseconds):

- `PMP_AUDIO_RENDER_POP_WAIT_NORMAL_MS` (default `1`)
- `PMP_AUDIO_RENDER_POP_WAIT_GUARDED_MS` (default `2`)
- `PMP_AUDIO_RENDER_POP_WAIT_CRITICAL_MS` (default `3`)

Render queue micro-retry env vars (attempts / spin loops):

- `PMP_AUDIO_RENDER_POP_RETRY_NORMAL` (default `2`)
- `PMP_AUDIO_RENDER_POP_RETRY_GUARDED` (default `3`)
- `PMP_AUDIO_RENDER_POP_RETRY_CRITICAL` (default `4`)
- `PMP_AUDIO_RENDER_POP_RETRY_STREAK_STEP` (default `2`)
- `PMP_AUDIO_RENDER_POP_RETRY_MAX` (default `7`)
- `PMP_AUDIO_RENDER_POP_RETRY_SPIN_NORMAL` (default `24`)
- `PMP_AUDIO_RENDER_POP_RETRY_SPIN_GUARDED` (default `48`)
- `PMP_AUDIO_RENDER_POP_RETRY_SPIN_CRITICAL` (default `96`)

Streaming source pop micro-retry env vars (attempts / spin loops):

- `PMP_AUDIO_STREAM_POP_RETRY_NORMAL` (default `2`)
- `PMP_AUDIO_STREAM_POP_RETRY_GUARDED` (default `3`)
- `PMP_AUDIO_STREAM_POP_RETRY_CRITICAL` (default `4`)
- `PMP_AUDIO_STREAM_POP_RETRY_STREAK_STEP` (default `2`)
- `PMP_AUDIO_STREAM_POP_RETRY_MAX` (default `7`)
- `PMP_AUDIO_STREAM_POP_RETRY_SPIN_NORMAL` (default `24`)
- `PMP_AUDIO_STREAM_POP_RETRY_SPIN_GUARDED` (default `48`)
- `PMP_AUDIO_STREAM_POP_RETRY_SPIN_CRITICAL` (default `96`)

Contract guarantees:

- Masking is sample-rate aware (duration is normalized by ms instead of fixed frame count).
- Higher pressure profile and repeated underrun streak increase mask duration within safe bounds.
- Render-pop wait remains bounded and profile-aware to reduce false underrun declaration without unbounded callback blocking.
- Shared render-ahead underrun masking uses predictive continuity + equal-power fade-out instead of direct tail-to-zero hold, reducing crackle texture when underruns cluster.
- Render queue pop path performs bounded micro-retries before declaring underrun, improving tolerance to short scheduling jitter.
- Streaming output source pop path also performs bounded micro-retries and predictive continuity masking before hard underrun concealment.

Exclusive/shared-raw output declick env vars (milliseconds):

- `PMP_AUDIO_EXCLUSIVE_DECLICK_NORMAL_MS` (default `8`)
- `PMP_AUDIO_EXCLUSIVE_DECLICK_GUARDED_MS` (default `14`)
- `PMP_AUDIO_EXCLUSIVE_DECLICK_CRITICAL_MS` (default `24`)
- `PMP_AUDIO_EXCLUSIVE_DECLICK_STREAK_BOOST_MS` (default `3`)
- `PMP_AUDIO_EXCLUSIVE_DECLICK_MIN_MS` (default `4`)
- `PMP_AUDIO_EXCLUSIVE_DECLICK_MAX_MS` (default `64`)

Exclusive/shared-raw declick guarantees:

- Uses adaptive equal-power fade-in/fade-out (instead of fixed linear 96-frame masking).
- Fade duration is sample-rate / pressure-profile / underrun-streak aware and clamped by safe bounds.
- Tail zeroing keeps underrun recovery transitions smooth and reduces audible crackle under jitter.

## 9. ReplayGain and Runtime Dynamic Gain Contract

ReplayGain (tag gain) and dynamic gain (runtime loudness processing) are decoupled.

Command payload semantics:

- `native_audio_set_replay_gain({ db: number | null })`:
  - Applies static replay gain (host clamped).
  - `null` is normalized to `0dB` for compatibility; dynamic gain state is unchanged.
- `native_audio_set_dynamic_gain_enabled({ enabled: boolean })`:
  - Enables/disables dynamic gain independently of ReplayGain tags.

Host settings split:

- ReplayGain settings (`NATIVE_AUDIO_REPLAYGAIN_SETTINGS`):
  - `enabled: boolean`
  - `mode: "track" | "album"`
  - `preampDb: number`
- Runtime control settings (`NATIVE_AUDIO_RUNTIME_CONTROL_SETTINGS`):
  - `dynamicGainEnabled: boolean` (default `false`)
    - Controls dynamic gain globally (not tied to ReplayGain tag presence).
    - Backward compatibility: `dynamicFallbackEnabled` is still accepted as a legacy alias.
  - `volumeDebounceEnabled: boolean` (default `true`)
    - `true`: UI volume slider commands are coalesced/debounced before dispatch.
    - `false`: volume commands dispatch immediately for every change.

Track-load path semantics:

- `native_audio_load_and_play({ replayGainDb: number | null })` applies static ReplayGain only.
- Dynamic gain state comes from `native_audio_set_dynamic_gain_enabled`, not from `replayGainDb`.

State event additions (`native_audio_state`):

- `dynamicGainEnabled: boolean`
- `dynamicGainDb: number`
- `memoryPoolF32GrowthEvents?: number`
- `memoryPoolF32GrowthBytes?: number`
- `memoryPoolF32PrewarmHits?: number`

Memory-pool metric semantics:

- Emitted on full/extended state payloads for allocation observability.
- Intentionally omitted in high-frequency compact tick payloads to keep WebView bridge pressure low.

## 10. Control Plane Queue Policy

Decoder/transfer control signaling now defaults to lock-free command queue transport.

- Default mode: lock-free queue (`PMP_AUDIO_CONTROL_QUEUE_MODE` unset).
- Legacy fallback: set `PMP_AUDIO_CONTROL_QUEUE_MODE=mpsc` (or `legacy`) to force `std::sync::mpsc`.
- Queue capacity: `PMP_AUDIO_CONTROL_QUEUE_CAPACITY` (default `256`, clamped `8..8192`).
- Overflow policy: when lock-free queue is full, oldest command is evicted and newest is kept.

State event additions (`native_audio_state`) for control-plane observability:

- `controlQueueLockFree?: boolean`
- `controlQueueCapacity?: number`
- `controlQueueOverwriteEvents?: number`

Adaptive transfer-buffer policy (P3):

- Transfer worker applies adaptive watermarks/chunking based on starvation and low/high oscillation streaks.
- Adaptation is bounded and decays after stable mid-band window to avoid sticky high-latency behavior.

State event additions (`native_audio_state`) for adaptive transfer observability:

- `transferAdaptationLevel?: number`
- `transferOscillationStreak?: number`

Backend policy pack (P4):

- Prebuffer defaults, min-start bounds, recovery bounds, and runtime rebuffer thresholds are selected by output backend id.
- Current tuned packs: `wasapi-exclusive`, `wasapi-shared-raw`, `wasapi`, `rodio-cpal`, and fallback default.
- Goal: keep exclusive path responsive while giving shared paths larger guard bands to reduce recurrent buffering oscillation.

Retire-plane lifecycle policy:

- Lifecycle-heavy cleanup (old sink/streaming objects) may be retired asynchronously by retire plane.
- Control-path still sends immediate stop/shutdown signals before retirement.

State event additions (`native_audio_state`) for retire-plane observability:

- `retirePendingTasks?: number`
- `retireEnqueuedTotal?: number`
- `retireExecutedTotal?: number`
- `retireInlineFallbackTotal?: number`
- `retirePanicTotal?: number`

This toggle is compatibility-only and intended for diagnostics/rollback during staged migration.

Compatibility notes:

- Additive state fields are backward compatible; legacy consumers can ignore them.
- Existing clients that always send numeric ReplayGain keep previous behavior unchanged.

## 11. Output Backend Selection and User Ownership

Backend selection ownership rule:

- Runtime recovery and pressure logic must not silently switch the user into `wasapi-exclusive`/`asio`.
- Output backend changes remain explicit host actions (`native_audio_select_output_backend`) or persisted user choice restore.

Default backend open policy (Windows):

- Startup backend probing keeps current baseline compatibility: `wasapi-exclusive` -> `wasapi-shared-raw` -> `wasapi` -> `rodio-cpal`.
- Persisted user choice is restored by host service on boot and remains authoritative for subsequent sessions.

Environment override (`PMP_AUDIO_DEFAULT_BACKEND`):

- Supported explicit ids/aliases: `wasapi-shared-raw` (`shared-raw`), `wasapi` (`shared`), `rodio-cpal` (`rodio`/`cpal`), `wasapi-exclusive` (`exclusive`).
- `auto`/`default` means no explicit override.

Rationale:

- Keeps non-exclusive behavior predictable for users who need other apps to keep audio output.
- Avoids hidden mode escalation that changes OS-level output semantics.

## 12. Pressure Priority Cap Policy

Pressure-driven thread priority boosts are bounded by a user/system cap:

- Env: `PMP_AUDIO_PRIORITY_PROFILE_CAP`
- Values: `normal` | `guarded` | `critical` (default `critical`)

Semantics:

- `normal`: disables pressure escalation (all pressure levels clamp to normal).
- `guarded`: allows normal/guarded, blocks critical/time-critical escalation.
- `critical`: full escalation path enabled.

This cap only affects scheduling priority; it does not force output backend changes.
