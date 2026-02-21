# Plugin Host API Contract

## Versioning
- Current host API version: `1.8.0`.
- This revision is additive and backward-compatible with `1.7.x` plugins.

## Host API (`host.*`)

### Existing
- `host.getInfo(): PluginHostInfo | null`
- `host.listPermissions(): string[]`
- `host.hasPermission(capability: string): boolean`

### Added in `1.2.0`
- `host.listCapabilities(): Promise<PluginHostCapabilityInfo[]>`
- `host.invokeCapability(capabilityId: string, method: string, payload?: unknown): Promise<unknown>`

### Refinement in `1.3.0`
- Builtin foundation capability IDs became invokable.
- Host capability guardrails were added:
  - payload must be JSON-serializable
  - payload size limit: 256 KiB
  - invocation timeout: 6s

### Refinement in `1.4.0`
- `foundation.ai-adapter` is upgraded from placeholder to provider-runtime bridge.

### Refinement in `1.5.0`
- `foundation.audio-input-adapter` is activated as a contract stub capability (`describe` / `health`) for decoder adapter negotiation.

### Refinement in `1.6.0`
- `foundation.audio-input-adapter` is upgraded to Phase B builtin bridge over native input registry.

### Refinement in `1.7.0`
- `foundation.audio-input-adapter` enters Phase C skeleton:
  - third-party provider registration API (host-side)
  - governance gates (deny-by-default)
  - provider timeout + builtin fallback on failure
  - C.1 sidecar helper (`registerAudioInputAdapterSidecarProvider`) for command wiring
  - C.2 Tauri control-plane command skeleton (`native_audio_decoder_sidecar_*`)
  - C.3 governance observability audit hooks for adapter selection/fallback/session-close

### Refinement in `1.8.0`
- `foundation.audio-input-adapter` enters Phase D foundation hardening:
  - provider quarantine policy (threshold + cooldown)
  - per-plugin open-session cap
  - runtime stats + quarantine clear methods
- `foundation.desktop-pet-runtime` and `foundation.voice-training-runtime` are upgraded from reserved placeholders to provider-runtime bridges (`describe/health/listProviders/invoke`).

### `PluginHostCapabilityInfo`
- `id: string`
- `version: string`
- `permission?: string`
- `description?: string`
- `experimental?: boolean`

### Capability Invocation Semantics
- Host capability invocation is deny-by-default.
- `host.invokeCapability` requires:
  - `api:host`
  - `api:host-capability`
  - plus capability-specific permission (if declared)
- Unknown capability or non-invokable capability returns host error.
- Method name must match: `^[a-z][a-z0-9_.-]{0,63}$`.

### Capability Result Envelope
- `PluginHostCapabilityResult<T>`
  - success: `{ ok: true, data: T }`
  - failure: `{ ok: false, error: { code, message, retryable?, details? } }`
- Builtin foundation capabilities return this envelope.

## `foundation.ai-adapter` Capability

- Capability ID: `foundation.ai-adapter`
- Capability version: `0.4.0`
- Permission: `api:ai-runtime`
- Purpose: host-side AI provider registry and invocation bridge.

### Methods
- `describe`
  - Returns runtime descriptor (`ready`, `providerCount`, `defaultProviderId`, `methods`).
- `health`
  - No payload: returns aggregate status (`idle` when no provider configured).
  - Payload `{ providerId }`: returns provider health (`ready` / `degraded` / `offline`).
- `listProviders`
  - Optional payload `{ capability }` for capability filtering.
  - Returns `{ providers, defaultProviderId, providerCount }`.
- `invoke`
  - Payload: `{ providerId?, task, input?, options? }`.
  - Routes request to resolved provider (explicit provider or default provider).
  - Returns `{ providerId, task, elapsedMs, output }` on success.
- `searchTracks`
  - Payload: `{ query, limit? }`.
  - Returns music library matches for AI planning/execution.
- `queueTracks`
  - Payload: `{ query, limit? }`.
  - Appends matched tracks to current playback queue.
- `playTrack`
  - Payload: `{ query, limit?, matchIndex?, queueMode?: 'replace' | 'append' }`.
  - Searches, queues, and starts playback at the selected match.

### Provider Registration (host-side)
- `registerAiAdapterProvider({ info, invoke, health? }, { setAsDefault? })`
- `setDefaultAiAdapterProvider(providerId)`
- `listAiAdapterProviders()`

These APIs are intended for host/runtime modules, not for plugin sandbox code.

## `foundation.audio-input-adapter` Capability

- Capability ID: `foundation.audio-input-adapter`
- Capability version: `0.4.0`
- Permission: `api:audio-input-adapter`
- Purpose: hybrid decoder bridge (builtin inputs + governed third-party provider runtime).

### Methods
- `describe`
  - Returns bridge descriptor (`capabilityId`, `domain`, `stage`, `ready`, `implementation`, `inputCount`, `methods`).
- `health`
  - Returns bridge health (`status`, `ready`, `reason`, `inputCount`, `pluginOpenSessionCount`).
- `listInputs`
  - Returns builtin audio input adapters and available provider-derived inputs.
- `listProviders`
  - Returns registered third-party providers with governance status (`enabled` / allowlist state).
- `stats`
  - Optional payload `{ providerId? }`.
  - Returns runtime provider stats (failure/success/quarantine/session counters) and governance settings.
- `clearProviderQuarantine`
  - Optional payload `{ providerId? }`.
  - Clears quarantine for one provider or all providers.
- `probe`
  - Payload: `{ path?|sourcePath?|sourceUri?, preferredInputId?, providerId? }`.
  - Provider is tried first when available; fallback to builtin selection strategy.
- `openSession`
  - Payload: `{ path?|sourcePath?|sourceUri?, preferredInputId?, providerId?, fallbackToBuiltin? }`.
  - Tries provider path with timeout, then falls back to builtin path unless explicitly disabled.
- `closeSession`
  - Payload: `{ sessionId }`.
  - Closes logical session; provider `closeSession` is invoked for provider-backed sessions.

### Provider Registration (host-side)
- `registerAudioInputAdapterProvider({ info, probe?, openSession, closeSession?, health? }, { setAsDefault? })`
- `listAudioInputAdapterProviders()`
- `setDefaultAudioInputAdapterProvider(providerId)`
- `configureAudioInputAdapterGovernance({ thirdPartyEnabled?, allowedProviderIds?, timeoutMs? })`
- `registerAudioInputAdapterSidecarProvider(options)`
  - helper for `describe/probe/openSession/closeSession/health` sidecar command wiring.

These APIs are for host/runtime modules only and are not directly exposed to plugin sandbox code.

### Notes
- Phase C skeleton keeps third-party path deny-by-default (`thirdPartyEnabled=false` by default).
- Phase C.2 adds Tauri command skeleton:
  - `native_audio_decoder_sidecar_describe_provider`
  - `native_audio_decoder_sidecar_probe`
  - `native_audio_decoder_sidecar_open_session`
  - `native_audio_decoder_sidecar_close_session`
  - `native_audio_decoder_sidecar_health`
  - The stub runtime is disabled by default and can be enabled with `PMP_DECODER_SIDECAR_STUB_ENABLED=1`.
- Phase C.3 adds PMPM audit events:
  - `audio-input-adapter-selected`
  - `audio-input-adapter-fallback`
  - `audio-input-adapter-session-closed`
- Phase D foundation adds:
  - provider quarantine governance (`quarantineThreshold`, `quarantineMs`)
  - per-plugin open session cap (`maxOpenSessionsPerPlugin`)
  - PMPM audit events: `audio-input-adapter-provider-quarantined` / `audio-input-adapter-provider-quarantine-cleared`
- Sidecar/data-plane `read/seek` PCM APIs remain deferred to the next production phase.
- Runtime contract draft remains in `audio-decoder-plugin-contract-draft.md`.

## `foundation.desktop-pet-runtime` Capability

- Capability ID: `foundation.desktop-pet-runtime`
- Capability version: `0.3.0`
- Permission: `api:desktop-pet`
- Purpose: desktop companion runtime provider registry and invocation bridge.

### Methods
- `describe`
  - Returns runtime descriptor (`ready`, `providerCount`, `defaultProviderId`, `methods`).
- `health`
  - No payload: aggregate status (`idle` when no provider configured).
  - Payload `{ providerId }`: provider health (`ready` / `degraded` / `offline`).
- `listProviders`
  - Optional payload `{ capability }` for capability filtering.
- `invoke`
  - Payload: `{ providerId?, task, input?, options? }`.

### Provider Registration (host-side)
- `registerDesktopPetRuntimeProvider({ info, invoke, health? }, { setAsDefault? })`
- `listDesktopPetRuntimeProviders()`
- `setDefaultDesktopPetRuntimeProvider(providerId)`

## `foundation.voice-training-runtime` Capability

- Capability ID: `foundation.voice-training-runtime`
- Capability version: `0.3.0`
- Permission: `api:voice-training`
- Purpose: voice training runtime provider registry and invocation bridge.

### Methods
- `describe`
  - Returns runtime descriptor (`ready`, `providerCount`, `defaultProviderId`, `methods`).
- `health`
  - No payload: aggregate status (`idle` when no provider configured).
  - Payload `{ providerId }`: provider health (`ready` / `degraded` / `offline`).
- `listProviders`
  - Optional payload `{ capability }` for capability filtering.
- `invoke`
  - Payload: `{ providerId?, task, input?, options? }`.

### Provider Registration (host-side)
- `registerVoiceTrainingRuntimeProvider({ info, invoke, health? }, { setAsDefault? })`
- `listVoiceTrainingRuntimeProviders()`
- `setDefaultVoiceTrainingRuntimeProvider(providerId)`

## Foundation Capabilities Overview

- `foundation.capability-registry`
  - `list`: visible capabilities for current permission context
  - `get` (`{ id }`): capability descriptor
  - `has` (`{ id }`): visibility check
- `foundation.desktop-pet-runtime` (provider runtime bridge)
  - `describe`, `health`, `listProviders`, `invoke`
- `foundation.voice-training-runtime` (provider runtime bridge)
  - `describe`, `health`, `listProviders`, `invoke`
- `foundation.audio-input-adapter` (Phase D foundation runtime)
  - `describe`, `health`, `listInputs`, `listProviders`, `stats`, `clearProviderQuarantine`, `probe`, `openSession`, `closeSession`
  - draft contract: `audio-decoder-plugin-contract-draft.md`

## Visualizer API

- `visualizer.getSpectrum(): Uint8Array | null`
- `visualizer.onSpectrum(cb, { intervalMs? }): () => void`
- `visualizer.getSpectrumFrame({ tap?: 'pre-dsp' | 'post-dsp' }): AudioSpectrumFrame | null`
- `visualizer.onSpectrumFrame(cb, { tap?: 'pre-dsp' | 'post-dsp', intervalMs? }): () => void`

### `AudioSpectrumFrame`
- `frameId: number`
- `timestampMs: number`
- `tap: 'pre-dsp' | 'post-dsp'`
- `sampleRate: number`
- `bins: Uint8Array` (normalized 0..255)

## Permission Model
- Exact capability match is supported.
- Prefix wildcard permissions ending with `*` are supported (e.g. `api:*`, `net:*`).
- `net:all` and `net:*` remain compatible aliases for network namespace grants.

## Sandbox Parity
- Iframe sandbox and worker sandbox expose:
  - `host.listCapabilities()`
  - `host.invokeCapability(...)`
- Permission behavior and denial semantics remain aligned with non-sandbox host runtime.
