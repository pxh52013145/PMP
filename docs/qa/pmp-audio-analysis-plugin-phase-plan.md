# PMPM Audio Analysis Plugin - Phase Plan

> Date: 2026-02-10
> Scope: `community/plugins/pmp-audio-analysis-lab/*` + host API extension proposals

## 1. Goal
- Build a professional analysis tool as a `.pmpm` plugin while staying inside plugin contract boundaries.
- Short-term: deliver practical realtime observability.
- Mid-term: deliver true dual-path synchronous spectral difference.

## 2. Current host capability baseline
- Already available:
  - `visualizer.getSpectrum()`
  - `visualizer.onSpectrum(cb, { intervalMs })`
  - `audio.getState()/onStateChange`
- Not yet available:
  - explicit **pre-DSP** and **post-DSP** independent taps exposed to plugins
  - shared frame timestamp across taps for hard-synchronous comparison

## 3. Phase breakdown

### Phase A (done in this iteration)
- Deliver plugin skeleton and usable analyzer UI.
- Features:
  - realtime spectrum
  - waterfall
  - reference capture + diff metrics
- Acceptance:
  - plugin loads via `.pmpm`
  - no runtime errors in host under normal playback

### Phase B (completed)
- Host API extension proposal:
  - `visualizer.getSpectrumFrame({ tap: 'pre-dsp' | 'post-dsp' })`
  - `visualizer.onSpectrumFrame(cb, { tap, intervalMs })`
  - frame payload includes `frameId`, `timestampMs`, `sampleRate`, `bins`
- Plugin update:
  - dual-path simultaneous draw
  - exact diff on matched `frameId`
 - Status:
   - host API + sandbox path wired for pre/post spectrum frames
   - plugin switched to dual-path diff by default with reference fallback mode

### Phase C (completed)
- Add advanced metrics:
  - band energy matrix
  - crest factor timeline
  - inter-frame jitter indicator
- Add session recorder (JSON/CSV export)
 - Status:
   - plugin exposes band-peak, crest-factor and frame-jitter live indicators
   - session recorder added with bounded memory ring and JSON/CSV export

### Phase D (completed)
- QA hardening:
  - performance budget under 60Hz UI repaint
  - memory ceiling under long-run spectrogram
  - cross-window/plugin unload leak checks
- Status:
  - render budget observability added (`Render P95`, `Render Overrun`) with rolling window.
  - recorder memory guard tightened with JSON-size based trim when idle.
  - lifecycle hardening completed (`mounted` guard + idempotent unmount/remount + aggressive dispose cleanup).

## 4. Acceptance matrix (core)
- Case 1: idle/no playback
  - spectrum panel stays stable, no exceptions
- Case 2: normal playback
  - spectrum/waterfall updates continuously, metrics finite
- Case 3: reference capture
  - captured baseline persists and diff updates
- Case 4: unmount/remount plugin
  - listeners/timers cleaned up, no duplicate subscriptions

## 5. Risks
- Without dual taps, diff is temporal A/B not strict same-frame A/B.
- Host-side spectrum bin characteristics (windowing/fft size/smoothing) may limit absolute measurement comparability.
