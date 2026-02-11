# Plugin Host API Contract (Audio Visual Extensions)

## Versioning
- Baseline API version remains `1.0.0`.
- This update is backward-compatible (additive only).

## Visualizer API

### Existing (unchanged)
- `visualizer.getSpectrum(): Uint8Array | null`
- `visualizer.onSpectrum(cb, { intervalMs? }): () => void`

### New (additive)
- `visualizer.getSpectrumFrame({ tap?: 'pre-dsp' | 'post-dsp' }): AudioSpectrumFrame | null`
- `visualizer.onSpectrumFrame(cb, { tap?: 'pre-dsp' | 'post-dsp', intervalMs? }): () => void`

## `AudioSpectrumFrame`
- `frameId: number`
- `timestampMs: number`
- `tap: 'pre-dsp' | 'post-dsp'`
- `sampleRate: number`
- `bins: Uint8Array` (normalized 0..255)

## Semantics
- `pre-dsp`: captured after decode/mix normalization but before DSP chain.
- `post-dsp`: captured after DSP/VST/fade path.
- Same cycle frames should share the same `frameId` for strict dual-path alignment.

## Permission Gate
- Both new methods require `api:audio-visual`.
- Denied calls return `null` or no-op unsubscribe, same as existing visualizer policy.

## Sandbox Parity
- Iframe sandbox and worker sandbox bridge expose the same new methods.
- Initial payload includes optional dual frame snapshots for immediate first render.

