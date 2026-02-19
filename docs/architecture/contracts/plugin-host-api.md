# Plugin Host API Contract

## Versioning
- Current host API version: `1.2.0`.
- This revision is additive and backward-compatible with `1.1.x` plugins.

## Host API (`host.*`)

### Existing
- `host.getInfo(): PluginHostInfo | null`
- `host.listPermissions(): string[]`
- `host.hasPermission(capability: string): boolean`

### New in `1.2.0`
- `host.listCapabilities(): Promise<PluginHostCapabilityInfo[]>`
- `host.invokeCapability(capabilityId: string, method: string, payload?: unknown): Promise<unknown>`

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

## Permission Model
- Exact capability match is supported.
- Prefix wildcard permissions ending with `*` are supported (e.g. `api:*`, `net:*`).
- `net:all` and `net:*` remain compatible aliases for network namespace grants.

## Sandbox Parity
- Iframe sandbox and worker sandbox expose:
  - `host.listCapabilities()`
  - `host.invokeCapability(...)`
- Permission behavior and denial semantics remain aligned with non-sandbox host runtime.

