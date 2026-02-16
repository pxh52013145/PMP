# Audio Engine Kernel Validation Matrix

Updated: 2026-02-16
Scope: interactive transport latency and stability regression

## 1. Unit tests (Rust)

Run in `apps/desktop/src-tauri`:

- `cargo test interactive_prebuffer_wait_caps_start_seek_to_sub_second_target`
- `cargo test interactive_prebuffer_wait_caps_crossfade_to_short_timeout`
- `cargo test load_operation_latest_token_wins_and_stale_prepare_is_aborted`
- `cargo test crossfade_returns_fallback_when_transport_is_not_playing`
- `cargo test seek_command_ignores_invalid_sequence_without_error`
- `cargo test seek_in_memory_path_does_not_recreate_sink`
- `cargo test buffering_finished_stream_resumes_instead_of_timeout`

Expected:

- Interactive wait caps remain bounded.
- Rapid operation supersession keeps latest request authoritative.
- New kernel orchestration fallback path remains deterministic.
- Seek command orchestration handles invalid/stale sequence safely.
- Existing seek/buffering regressions remain green.

## 2. Integration test (Rust)

Run in `apps/desktop/src-tauri`:

- `cargo test --test vst_bridge_sidecar_selftest`

Expected:

- Sidecar self-test remains green (no regression from engine changes).

## 3. Smoke test (runtime command pipeline)

Run in `apps/desktop/src-tauri`:

- `cargo run -- --audio-smoke --path <absolute_track_path> --play-ms 2500 --seek-count 1 --seek-seconds 8`
- `cargo run -- --audio-smoke --path <absolute_track_path> --backend-id wasapi --play-ms 2500 --seek-count 1 --seek-seconds 8`

Expected:

- Load/play/seek/stop command pipeline completes without deadlock.
- State emission and error channel remain valid.

## 4. Workspace quality gates

Run in repo root:

- `pnpm lint`
- `pnpm type-check`
- `pnpm test`

Expected:

- Workspace lint/type/test remain green after native engine changes.

## 5. Current result snapshot (this delivery)

Validated on 2026-02-16:

- Unit tests: passed
- Integration test: passed
- Smoke test: passed
- Workspace quality gates: passed
