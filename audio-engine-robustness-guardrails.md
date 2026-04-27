# Audio Engine Robustness Guardrails

Last updated: 2026-04-27

This file is the repo-tracked guardrail for native audio work.
Use it together with `AGENTS.md` and the current source tree.

## Stable baseline

- Acceptable recovery baseline: `cf0e648` (`audio: stream remote sources from growing cache backing`)
- Stable anchor used for historical diff: `0e84336` (2026-04-20 tree snapshot)
- Later commits around `321cdbd` -> `6af45bb` introduced the controller/pressure feedback loop that destabilized production playback.
- Later remote range work around `66982d2` and `9994d33` introduced the cache-corruption direction that caused noise when sparse seek logic touched the canonical playback backing.

## Production hot path

Production playback must stay within this boundary:

`source identity -> transport materializer -> input adapter -> decode -> transfer -> render queue -> output backend`

Ownership rules:

- `source identity`
  - Carries stable track identity only.
  - Must not be rewritten into transport-specific sparse cache state.
- `transport materializer`
  - Owns remote download, cache validity, cancellation, and full materialization fallback.
  - Must keep the canonical playback cache contiguous-prefix only.
- `input adapter`
  - Chooses between growing-cache streaming and full-track materialization.
  - Incomplete remote seek must fall back to full-track materialization, not sparse cache mutation.
- `decode`
  - Reads only from a valid contiguous backing or a fully materialized file.
- `transfer`
  - Moves decoded samples using deterministic queue/watermark policy.
- `render queue`
  - Buffers for output only; it must not become a sink for controller-driven experimental retuning.
- `output backend`
  - Applies backend-specific but deterministic startup, preroll, underrun, and thread policy.

## Non-negotiable invariants

- The canonical remote playback cache is contiguous-prefix only.
- `.part` resume is prefix-only and versioned.
- `Content-Range` validation is only valid while preserving contiguous writes.
- Incomplete remote seek uses full-track materialization fallback.
- Single-flight ownership is required for remote downloads that share one cache key.
- Diagnostic signals must not directly retune production playback by default.

## What must stay out of production control

These systems are allowed for telemetry, debug UI, and offline review:

- `AudioStabilityController`
- external stability hints
- realtime memory pressure events
- page-lock skip/failure counters
- memory-pool growth counters
- derived runtime action profiles

They must not directly change production playback without explicit re-validation:

- scheduler floor
- live prebuffer sizing
- render queue capacity
- shared render-ahead ready thresholds
- shared render-ahead low/high watermarks
- producer or consumer chunk scaling
- steady-state thread priority escalation

## Required design rules for new audio changes

1. Diff against a known stable anchor before changing the hot path.
2. Decide whether the new behavior is production-safe or experimental.
3. If experimental, isolate it behind a separate path and keep the production path deterministic.
4. Prefer rolling back an immature design over layering more recovery patches on top of it.
5. Keep backend policy differences intentional and explicit; do not let secondary diagnostics silently amplify them.

## Required review scope

At minimum, review all touched changes across:

- `apps/desktop/src-tauri/src/audio/source.rs`
- `apps/desktop/src-tauri/src/audio/input/*`
- `apps/desktop/src-tauri/src/audio/engine.rs`
- `apps/desktop/src-tauri/src/audio/output/*`
- `apps/desktop/src-tauri/src/native_audio.rs`
- any code touching remote stream, range, cache, materializer, scheduler, render queue, WASAPI, rodio, or shared/raw output

## Validation requirements

Before merge, run as many of these as the environment allows:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --no-run`
- focused Rust compile gates for touched audio modules when useful
- `pnpm --dir apps/desktop lint`
- `pnpm --dir apps/desktop type-check`
- targeted frontend audio tests for changed resolver or policy flows

If Rust test binaries still fail to launch with `STATUS_ENTRYPOINT_NOT_FOUND`:

- record that exact environment issue
- keep `--no-run` compile results in the validation log
- do not pretend runtime Rust tests passed

## Manual smoke checklist

Run backend-by-backend when possible:

- cold start first play
- local file seek
- remote stream cold start
- remote stream seek before cache completion
- pause/resume
- stop/reload
- crossfade or queue transition
- shared backend and shared-raw backend comparison

## Regression triggers

Treat these as rollback-level warnings:

- noise/static that appears only after remote seek or resume
- first-play startup becoming slower after a stability change
- seek readiness depending on backend-specific hidden scaling
- scheduler decisions changing because of memory guard or diagnostic-only events
- one backend becoming stable only because its preroll or priority was silently inflated

## Documentation rule

If audio behavior changes materially:

- update this file
- update any current local deep-dive notes you used during the review
- do not mechanically edit ignored archival planning files unless they are still actively used
