# Native Audio Engine Policy Contract

Updated: 2026-02-16
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

Runtime host setting (persisted in streaming buffer settings):

- `interactiveProfile`: `fast` | `balanced` | `stable`

Runtime command integration:

- `native_audio_set_streaming_buffer_settings` accepts `interactiveProfile` as an optional field.
- `native_audio_get_streaming_buffer_settings` / payload now exposes `interactiveProfile`.

Implementation reference:

- `streaming_prebuffer_interactive_wait(...)` in `apps/desktop/src-tauri/src/audio/engine.rs`

This guardrail remains intentionally independent from steady-state robustness policy so interactive transport latency stays deterministic while allowing profile/env tuning per machine.

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

Contract guarantees:

- Masking is sample-rate aware (duration is normalized by ms instead of fixed frame count).
- Higher pressure profile and repeated underrun streak increase mask duration within safe bounds.
- Render-pop wait remains bounded and profile-aware to reduce false underrun declaration without unbounded callback blocking.

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
