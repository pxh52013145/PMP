# Plugin Host API Contract

## Versioning
- Current host API version: `1.3.0`.
- This revision is additive and backward-compatible with `1.2.x` plugins.

## Host API (`host.*`)

### Existing
- `host.getInfo(): PluginHostInfo | null`
- `host.listPermissions(): string[]`
- `host.hasPermission(capability: string): boolean`

### New in `1.2.0`
- `host.listCapabilities(): Promise<PluginHostCapabilityInfo[]>`
- `host.invokeCapability(capabilityId: string, method: string, payload?: unknown): Promise<unknown>`

### Refinement in `1.3.0`
- Builtin reserved capabilities become invokable with stable placeholder handlers:
  - `foundation.capability-registry`
  - `foundation.ai-adapter`
  - `foundation.desktop-pet-runtime`
  - `foundation.voice-training-runtime`
- Capability invocation now applies host-side guardrails:
  - payload must be JSON-serializable
  - payload size limit (256 KiB)
  - invocation timeout (6s)

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

### Capability Result Envelope (recommended)
- `PluginHostCapabilityResult<T>`
  - success: `{ ok: true, data: T }`
  - failure: `{ ok: false, error: { code, message, retryable?, details? } }`
- Builtin foundation capabilities return this envelope.

## Visualizer API

### Existing
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

## Reserved Foundation Capabilities

These are reserved contract IDs for large-scale extensibility:
- `foundation.ai-adapter` (permission: `api:ai-runtime`, experimental)
- `foundation.desktop-pet-runtime` (permission: `api:desktop-pet`, experimental)
- `foundation.voice-training-runtime` (permission: `api:voice-training`, experimental)

The reserved IDs are placeholders for future implementations and can be wired incrementally via host capability registration.

### Builtin Foundation Methods
- `foundation.capability-registry`
  - `list` → visible capabilities for current permission context
  - `get` (`{ id }`) → capability descriptor
  - `has` (`{ id }`) → visibility check
- `foundation.ai-adapter` / `foundation.desktop-pet-runtime` / `foundation.voice-training-runtime`
  - `describe` → reserved runtime descriptor
  - `health` → readiness/health snapshot

## Permission Model
- Exact capability match is supported.
- Prefix wildcard permissions ending with `*` are supported (e.g. `api:*`, `net:*`).
- `net:all` and `net:*` remain compatible aliases for network namespace grants.

## Sandbox Parity
- Iframe sandbox and worker sandbox expose:
  - `host.listCapabilities()`
  - `host.invokeCapability(...)`
- Permission behavior and denial semantics remain aligned with non-sandbox host runtime.

