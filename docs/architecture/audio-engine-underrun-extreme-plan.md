# Audio Engine Underrun Extreme Plan

Updated: 2026-02-23
Scope: `apps/desktop/src-tauri/src/audio/*`, `apps/desktop/src-tauri/src/native_audio.rs`, `apps/desktop/src/services/audio/*`

## 1. Goals

This plan targets a hard real-time baseline for PMP audio playback:

1. Eliminate routine underruns during track switch, seek, and backend switch.
2. Keep transport responsiveness predictable under stress.
3. Prepare a stable foundation for advanced modules (VST and AI) without regressions.

---

## 2. Current Module Analysis (As-Is)

### 2.1 Boundaries

- `audio/kernel.rs`: transport orchestration (`load/play/pause/seek/crossfade`).
- `audio/engine.rs`: state machine, buffering policy, recovery logic.
- `audio/input/*`: decode pipeline (`symphonia`, `sacd`).
- `audio/input/streaming.rs`: transfer worker (`decode_reservoir -> render_queue`).
- `audio/output/*`: backend adapters (`wasapi-exclusive`, `wasapi-shared-raw`, `rodio-cpal`).
- `audio/buffer.rs`: ring buffer infrastructure.

### 2.2 Dataflow

`decoder -> decode_reservoir -> transfer -> render_queue -> output callback`

### 2.3 Primary Risk Areas

- Multi-stage queue handoff amplifies jitter.
- Seek/switch races around queue clear + command arrival.
- Control path still contains `mpsc` hot spots under pressure.
- Lifecycle operations (`drop/join`) can interfere with real-time paths.

---

## 3. Completed Root Fixes (already landed)

1. Removed hidden blocking wait in `push_interleaved()` (non-blocking semantics).
   - `apps/desktop/src-tauri/src/audio/buffer.rs`

2. Added transfer loop interruptibility in both outer and inner push loops.
   - `apps/desktop/src-tauri/src/audio/input/streaming.rs`

3. Completed seek-path render queue flush in decoder branches.
   - `apps/desktop/src-tauri/src/audio/input/symphonia.rs`

4. Added regression test for shutdown liveness under render-queue backpressure.
   - `transfer_worker_shutdown_does_not_stall_when_render_queue_is_pressure_full`
   - `apps/desktop/src-tauri/src/audio/input/streaming.rs`

5. Reduced track-switch open-path stalls with early stream metadata handshake.
   - `apps/desktop/src-tauri/src/audio/input/symphonia.rs`
   - Added bounded stream-init timeout (`PMP_AUDIO_STREAM_INIT_TIMEOUT_MS`, default `2200ms`).

6. Added low-latency initial sizing for `StreamingFullTrack` decode reservoir.
   - `apps/desktop/src-tauri/src/audio/input/symphonia.rs`
   - Default `PMP_AUDIO_STREAMING_FULLTRACK_INITIAL_SECONDS=12.0` (full preallocate remains opt-in via `PMP_AUDIO_STREAMING_FULLTRACK_PREALLOCATE_FULL=1`).

7. Rebalanced memory-related defaults for playback and rendering layers.
   - `apps/desktop/src-tauri/src/audio/input/symphonia.rs`
   - `apps/desktop/src-tauri/src/audio/buffer_policy.rs`
   - `apps/desktop/src-tauri/src/audio/output/render_ahead.rs`
   - `apps/desktop/src/contracts/memoryGovernance.ts`
   - `apps/desktop/src/pixelEngine/PixelMatrixRenderer.ts`

8. Added transport/open timing diagnostics for load/crossfade path attribution.
   - `apps/desktop/src-tauri/src/audio/kernel.rs`
   - `apps/desktop/src-tauri/src/audio/input/symphonia.rs`

---

## 4. External References and Mapping

### 4.1 `nih_plug` (parameter/control handoff)

- Lock-free parameter queue + block-boundary consumption.
- RT thread reads atomics/queues only.

Mapping:

- Replace selected `mpsc` control links with lock-free SPSC queues.
- Model runtime policy updates as atomic snapshots + sequence IDs.

### 4.2 `Kira` (command queue and lifecycle)

- Non-RT command enqueue, RT-side batched consumption.
- Lifecycle work removed from audio callback.

Mapping:

- Introduce `CommandQueue` for load/seek/flush/reconfigure.
- Add retire queue for deferred disposal of heavy objects.

### 4.3 `rtrb` (SPSC lock-free ring)

- Predictable O(1) push/pop in SPSC usage.

Mapping:

- First use in control queue migration.
- Evaluate data-plane migration with compatibility wrappers.

### 4.4 `basedrop` (real-time safe destruction)

- RT path relinquishes ownership; non-RT thread performs destruction.

Mapping:

- Apply to crossfade/switch/seek-rebuild old resources.

---

## 5. Added Blind-Spot Requirements (must-have)

## 5.1 Preallocation and Memory Pooling (new hard requirement)

Problem:

- Deferred drop solves destruction stalls, but allocation stalls remain.
- New decoder/node creation can still trigger heap allocation spikes.

Requirement:

- Introduce preallocation at engine startup and operation-prepare time.
- RT paths must not call allocation-heavy APIs (`Box::new`, `Vec::reserve`, dynamic growth).

Implementation direction:

- Add `audio/memory_pool.rs`:
  - object pool for frequently recreated runtime objects,
  - scratch arenas for frame blocks and temporary DSP buffers,
  - fixed-capacity block lists for transfer/render local caches.
- Expand prepare-stage warmup:
  - prebuild decoder-side temporary buffers,
  - prebuild transfer/render chunk buffers using policy max bounds.

Acceptance:

- No RT-path allocation in profiler during 30-minute playback stress.
- Track-switch p95 unchanged when pool warmup is enabled.

## 5.2 IPC Storm Shaping and Backpressure (new hard requirement)

Problem:

- Internal queue backpressure is covered, but external command flood is not.
- High-frequency UI operations can flood control path and starve timely command handling.

Requirement:

- Introduce command shaping before lock-free queue enqueue.
- Render/control planes must consume bounded work per cycle.

Implementation direction:

- Add `audio/control_plane.rs`:
  - command coalescing (volume/seek/parameter updates),
  - debounce windows for high-frequency knobs,
  - bounded per-tick drain budget with priority classes.
- Command model upgrade:
  - `SetVolume(target, ramp_ms)` instead of raw high-rate deltas,
  - seek supersession by latest sequence,
  - drop-or-merge policy for stale non-critical updates.

Acceptance:

- 1000 UI volume events in 2s collapse into bounded control commands.
- No playback stall while command flood test runs.

---

## 6. To-Be Hard-RT Architecture

1. **Control Plane**: command shaping, sequence arbitration, policy snapshots.
2. **Decode Plane**: decode/SRC production only.
3. **Transfer Plane**: reservoir/render queue watermarks + copy scheduling.
4. **Render Plane**: callback deadline execution only.
5. **Retire Plane**: deferred destruction.
6. **Memory Plane**: preallocated pools/arenas and scratch reuse.

Hard constraints:

- Render Plane: no locks, no dynamic allocation, no heavy drop.
- Cross-plane communication: lock-free queue + atomics only.
- Lifecycle and memory reclamation: non-RT only.

---

## 7. Phased Execution Plan

## P0 (new): Memory Preallocation Baseline

- Build `memory_pool` and scratch arenas.
- Replace ad-hoc `Vec::reserve` growth in hot loops with prepared capacities.
- Add allocation counters in diagnostics.

## P1: Control Plane Lock-Free Migration

- Introduce lock-free SPSC control queue.
- Keep legacy `mpsc` as fallback behind feature/env guard.
- Migrate decoder/transfer command path first.

## P2: Lifecycle Decoupling

- Introduce retire queue/deferred drop pipeline.
- Route old sink/source/stream handles through retire plane.

## P3: Adaptive Buffer Strategy

- Promote watermarks/chunk/backoff from static constants to adaptive strategy functions.
- Add oscillation suppression and recovery-window heuristics.

## P4: Backend-Specific Hardening

- Separate policy packs for `wasapi-exclusive`, `wasapi-shared-raw`, `rodio-cpal`.
- Enforce per-backend prefill/recovery invariants.

## P5: Release Gate Automation

- Add switch/seek/flood stress suites and fail-fast thresholds.
- Publish gate metrics in CI artifacts.

---

## 8. Release Gates

Suggested baseline (`48k`, stereo):

- 100 consecutive track switches:
  - `p95` recovery to `Playing` < `350ms`
  - `p99` recovery to `Playing` < `700ms`
- 30-minute continuous playback:
  - underrun events <= `1` normal profile
  - underrun events <= `3` stressed UI profile
- Backend switch matrix (10 round-trips per pair):
  - no deadlock, no stuck buffering, no stale state
- Memory stability:
  - no linear growth trend after 100 switches
  - RT-path allocation count remains near zero after warmup
- IPC flood gate:
  - command coalescing ratio above threshold
  - no playback interruption during flood scenario

---

## 9. Risks and Rollback

- Risk: lock-free migration introduces ordering bugs.
- Mitigation:
  - keep legacy path feature flag,
  - run dual-path telemetry comparison,
  - add deterministic queue/property tests for supersession/coalescing.

## 10. User Backend Ownership Guardrail (new)

Hard rule:

- Underrun recovery must not silently escalate user output semantics (e.g. auto-switch to exclusive).
- Backend changes stay explicit user actions or explicit policy restores.

Windows startup default policy:

- Startup probing remains baseline-compatible (`wasapi-exclusive` -> `wasapi-shared-raw` -> `wasapi` -> `rodio-cpal`).
- Persisted user backend selection remains the primary behavior after host restore.

Scheduling policy:

- Pressure priority escalation is configurable via `PMP_AUDIO_PRIORITY_PROFILE_CAP` (`normal`/`guarded`/`critical`).
- Priority cap tunes scheduler aggressiveness without changing backend mode.


---

## 11. Documentation Sync

If contract or policy behavior changes, update:

- `docs/architecture/contracts/native-audio-engine-policy.md`
- `docs/qa/audio-buffer-stress-matrix.md`
- `docs/qa/audio-engine-kernel-validation.md`

Current phase status: `P0 complete, P1 complete, P2 complete, P3 complete, P4 complete`.

P0 progress snapshot (2026-02-23):

- Added `audio/memory_pool.rs` with growth/prewarm counters and throttled diagnostics.
- Replaced hot-path dynamic growth callsites in render/producer loops with unified
  `reserve_f32_capacity` entry.
- Added state observability fields for memory-pool growth/prewarm metrics in
  `native_audio_state` (non-tick payloads).

P1 progress snapshot (2026-02-23):

- Added `audio/control_plane.rs` lock-free command channel (default) for control-plane signaling.
- Migrated decoder/transfer command path from `std::sync::mpsc` to lock-free queue in
  `input/streaming.rs`, `input/symphonia.rs`, and `input/sacd.rs`.
- Added compatibility fallback env `PMP_AUDIO_CONTROL_QUEUE_MODE=mpsc|legacy` to force legacy channel.
- Added bounded queue overwrite policy and telemetry (`queue_overwrite`) to avoid unbounded command growth under UI burst.

P2 progress snapshot (2026-02-23):

- Added `audio/retire_plane.rs` deferred-destruction worker for lifecycle-heavy drops.
- Routed sink/streaming retirement from `engine` lifecycle transitions (load/switch/stop/rebuild) to retire plane.
- Added retire-plane telemetry in `native_audio_state` (pending/enqueued/executed/inline-fallback/panic).

P3 progress snapshot (2026-02-23):

- Added adaptive transfer strategy in `audio/buffer_policy.rs` with starvation/oscillation-aware watermark and chunk tuning.
- Integrated adaptive strategy into `input/streaming.rs` transfer loop, including oscillation suppression and stable-window decay.
- Added transfer adaptation telemetry (`transfer_adaptation_level`, `transfer_oscillation_streak`) to native state payload.

P4 progress snapshot (2026-02-23):

- Added backend policy packs for `wasapi-exclusive`, `wasapi-shared-raw`, `wasapi`, and `rodio-cpal` in `audio/buffer_policy.rs`.
- Routed start/seek prebuffer defaults, min-start/recovery bounds, and runtime rebuffer enter/resume thresholds through backend-specific policy selection.
- Added B3 automated regression case for transport-exact sample-mode roundtrip consistency.

Post-P4 stabilization snapshot (2026-02-23, underrun crackle mitigation):

- Added shared render-ahead bounded micro-retry pop strategy (`render_pop_retry_attempts`) before underrun declaration.
- Replaced shared render-ahead tail-to-zero masking with predictive continuity concealment + equal-power fade for clustered underrun transitions.
- Reduced producer hot-loop atomic polling overhead by switching seek-epoch checks from per-sample to stride-based polling in shared render-ahead producer.
- Elevated transfer/decode scheduling policy in critical pressure profile (`audio/threading.rs`) to reduce decode-reservoir starvation under CPU contention.
- Smoke benchmark trend (`rodio-cpal`, `120s`, `seek=8`, `stress-cpu-threads=8`):
  - before: `underrunEvents=2498`, `underrunFrames=2331312`
  - after: `underrunEvents=2185`, `underrunFrames=2030736`
  - delta: events `-12.5%`, frames `-12.9%`

Post-P4 stabilization snapshot (2026-02-23, iteration 2):

- Added streaming-source bounded micro-retry pop strategy before underrun declaration.
- Upgraded streaming-source underrun masking to predictive continuity + equal-power fade.
- Increased streaming decode-reservoir default baseline via `PMP_AUDIO_STREAMING_RESERVOIR_SECONDS` with high-rate scaling.
- Smoke benchmark trend (`rodio-cpal`, `120s`, `seek=8`, `stress-cpu-threads=8`):
  - previous iteration: `underrunEvents=2185`, `underrunFrames=2030736`
  - iteration 2: `underrunEvents=2151`, `underrunFrames=2060880`
  - interpretation: event count slightly improved, but frame-level improvement is saturated; dominant bottleneck remains sustained decode-side starvation under extreme CPU contention.

Post-P4 stabilization snapshot (2026-02-23, iteration 3 hardening):

- Increased shared-path queue pressure margins (render queue baseline, transfer watermarks, adaptive boost levels).
- Increased burst-fill aggressiveness (earlier entry, longer hold, larger chunk boost) to recover from decode starvation faster.
- Increased shared render-ahead startup preroll and linked initial preroll to low-watermark floor.
- Raised streaming decode-reservoir baseline default (`PMP_AUDIO_STREAMING_RESERVOIR_SECONDS=18.0`).
- Added shared interactive-prebuffer scaling for seek/crossfade path to reduce immediate post-seek starvation windows.

Post-P4 stabilization snapshot (2026-02-23, iteration 4 deterministic resume barrier):

- Replaced shared resume fixed sleep with state-driven barrier in `play_sink_with_shared_guard(...)`.
- Added shared render-ahead readiness snapshot + wait API (`shared_render_ahead_ready_snapshot`, `wait_for_shared_render_ahead_ready`).
- Introduced active-wrapper/seek-epoch readiness handoff to avoid resume on stale/underfilled outer queue after seek/switch.
- Added focused unit tests for shared render-ahead ready-wait semantics.
- Stress smoke (`20s`, `seek=8`, `stress-cpu-threads=8`, 3 runs):
  - `wasapi`: shared render underrun events `6/7/8` (median `7`, p95 `8`).
  - `wasapi-exclusive`: shared render underrun events `0/0/0`.
  - `rodio-cpal`: shared render underrun events `7/12/9` (median `9`, p95 `12`).
