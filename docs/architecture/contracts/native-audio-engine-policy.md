# Native Audio Engine Policy Contract

Updated: 2026-02-12
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

