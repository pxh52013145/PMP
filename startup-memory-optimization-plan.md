# Startup Memory Optimization Plan

Last updated: 2026-05-01

## Current Decision

Audio engine preload is kept as product baseline. Native audio is a core path, so startup memory work now targets measurement accuracy, lazy diagnostics, and optional visual layers instead of delaying audio initialization.

## Status

### P0 - Startup Memory Measurement

Status: done

- Added default-off startup memory trace gated by `pixel-matrix-startup-memory-trace-enabled`, URL flag, or `VITE_PMP_STARTUP_MEMORY_TRACE=1`.
- Captures startup checkpoints for frontend render, kernel activation, audio construction, Pixi creation, ornaments overlay, active magnet set, and idle 5s/15s.
- Captures process tree/WebView2 totals, JS heap when available, backend lazy-init state, active magnet counts, and visual-layer fields.
- Debug Center Runtime workspace now owns the trace toggle, latest trace summary, copy/clear actions, and visual memory delta analysis.
- Debug Center no longer refreshes memory/platform diagnostics while only viewing Runtime trace, avoiding trace pollution from diagnostic UI itself.

### P1 - Startup Sampling And Governance Deferral

Status: done

- First performance-control refresh is delayed until startup idle.
- First automatic memory-governance interval run is delayed until startup idle.
- Manual, hide, and pagehide governance paths remain immediate.

### P1 - Core Audio Preload

Status: keep

- `NativeAudioService` preload remains intentional because playback readiness is core product behavior.
- Startup trace keeps `audio.native.constructed` so audio cost stays visible, but it is not currently an optimization target.

### P2 - Visual Layer Startup Cost

Status: in progress

- Pixi matrix canvas now waits for startup idle before creating the WebGL/Pixi renderer. Static pixel positions still initialize early so magnet layout can render.
- Ornaments render overlay now opens only the required render planes:
  - above only when enabled ornaments exist on the above plane
  - behind only when enabled ornaments exist on the behind plane
  - neither plane when all ornaments are disabled
- Ornaments startup trace fields include enabled count, animated count, plane usage, placement area, and source pixel count.
- Debug Center visual deltas compare `pixel.renderer.created` and `ornaments.overlay.opened` against their previous checkpoints.

## Validation

Latest completed checks:

- `pnpm.cmd --dir apps/desktop type-check`
- `pnpm.cmd --dir apps/desktop lint`
- `pnpm.cmd --dir apps/desktop exec vitest run src/modules/startup/startupReady.test.ts src/modules/startup/startupMemoryTrace.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Locale JSON parse check for `en-US.json` and `zh-CN.json`

## Next Measurement Loop

1. Open Debug Center -> Runtime -> Startup memory trace.
2. Enable trace and restart the app.
3. Return to Debug Center -> Runtime and inspect:
   - `startup.idle.15s`
   - Visual memory deltas
   - `pixel.renderer.created`
   - `ornaments.overlay.opened`
   - backend lazy state
4. If visual deltas are still high:
   - For Pixi: consider lower default startup render scale or pausing WebGL until the matrix is visible/interactive.
   - For ornaments: consider image size policy, decode-size warnings, or preview-only/downsampled overlay assets.

## Notes

- `startup-memory-optimization-plan.md` is the active status file for this effort.
- Historical documents remain secondary to current source and this status file.
