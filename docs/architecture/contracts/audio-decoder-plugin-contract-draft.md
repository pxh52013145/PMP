# Audio Decoder Plugin Contract (Draft)

Updated: 2026-02-21  
Status: Draft (not active in runtime yet)

Implementation snapshot:

- Phase A delivered: capability reservation + stub methods (`describe` / `health`).
- Phase B delivered: builtin input bridge (`listInputs` / `probe` / `openSession` / `closeSession`) with third-party adapters disabled by default.
- Phase C delivered (skeleton): third-party provider registration + governance + timeout/fallback wiring (`listProviders`, provider-first `probe/openSession`, builtin fallback).
- Phase C.1 delivered: sidecar handshake helper (`registerAudioInputAdapterSidecarProvider`) with command wiring for `describe/probe/openSession/closeSession/health`.
- Phase C.2 delivered: Tauri control-plane command skeleton (`native_audio_decoder_sidecar_*`) with protocol/version handshake and stub runtime toggled by `PMP_DECODER_SIDECAR_STUB_ENABLED`.
- Phase C.3 delivered: PMPM governance audit hooks for `audio-input-adapter-selected` / `audio-input-adapter-fallback` / `audio-input-adapter-session-closed`.
- Phase D.1 delivered: foundation hardening (`stats`, `clearProviderQuarantine`, provider quarantine policy, per-plugin session cap, quarantine audit events).

## 1. Goal

Define a safe and extensible decoder-plugin contract (foobar-style pluggable decode path) while preserving:

- real-time playback stability
- host process isolation
- backward-compatible capability negotiation

This draft targets future `foundation.audio-input-adapter` capability and native decoder sidecar runtime.

## 2. Scope and Non-goals

### In scope

- external decoder implementation registration
- decode session lifecycle
- control/data plane IPC contract
- permission and sandbox policy
- fallback and recovery behavior

### Out of scope (for this draft)

- DSP/effect plugin ABI
- renderer/visualizer plugin ABI
- on-device model inference integration

## 3. Permission Model (Deny by Default)

Proposed permission namespaces:

- `api:audio-input-adapter`  
  allow plugin to negotiate and serve decode capability.
- `fs:media-read`  
  allow reading user-approved media paths only.
- `fs:decoder-cache`  
  allow decoder plugin private cache path (bounded quota).
- `net:decoder-*` (optional, off by default)  
  allow network-assisted decode/license checks only if explicitly granted.

Rules:

- no permission => no decoder loading.
- permissions are checked both at install policy and runtime invocation.
- all denials are auditable through PMPM governance log.

## 4. Lifecycle Contract

Proposed runtime states:

1. `discovered` (manifest found)
2. `validated` (signature/version/permission checks pass)
3. `loaded` (decoder sidecar process prepared)
4. `bound` (capability handshake completed)
5. `active` (session open and producing PCM)
6. `draining` (shutdown requested, outstanding frames drained)
7. `stopped` (all resources released)
8. `faulted` (runtime error, waiting fallback/restart policy)

Lifecycle constraints:

- each decode session has a unique `sessionId`.
- session close must be idempotent.
- host can force-stop any session on timeout/health failure.

## 5. IPC Contract (Control Plane + Data Plane)

## 5.1 Control Plane (JSON RPC)

Transport candidates:

- local named pipe / domain socket (preferred)
- stdio (fallback for dev)

Base envelope:

```json
{
  "id": "req-123",
  "method": "decoder.openSession",
  "params": {},
  "ts": 1700000000000
}
```

Response envelope:

```json
{
  "id": "req-123",
  "ok": true,
  "result": {},
  "error": null
}
```

Core methods (draft):

- `decoder.describe`  
  returns formats/codecs/container support + limits.
- `decoder.probe`  
  fast capability check for a given media resource.
- `decoder.openSession`  
  create decode session and output format contract.
- `decoder.seek`  
  seek by timeline/sample index.
- `decoder.read`  
  request N frames (non-RT thread only).
- `decoder.closeSession`
- `decoder.health`

## 5.2 Data Plane (PCM Transfer)

Preferred:

- shared memory ring buffer + atomic cursors

Fallback:

- chunked framed transfer over control channel (lower performance)

PCM format contract:

- interleaved `f32` normalized samples
- explicit `sampleRate`, `channels`, `frameCount`
- end-of-stream and discontinuity markers

## 6. Real-time Constraints

Hard rules:

- audio callback thread must never block on plugin IPC.
- callback thread must never allocate unbounded memory.
- decode plugin execution must be offloaded to worker/sidecar threads.

Budget guidance:

- control plane call timeout: default 2000 ms (method-specific overrides allowed)
- decode read timeout: profile-based; must return quickly under RT pressure
- per-session memory budget and global decoder budget enforced by host

Behavior under pressure:

- emit underrun diagnostics
- reduce prebuffer target first
- fallback to builtin decoder chain before hard stop

## 7. Fallback Strategy

Selection order (proposed):

1. user-preferred decoder plugin
2. host-compatible decoder plugins by score
3. builtin inputs (`sacd` -> `symphonia` -> `rodio` as available)

Failure handling:

- on `probe`/`openSession` failure: try next candidate
- on repeated runtime failure: quarantine plugin for this process session
- on unrecoverable chain failure: surface actionable error to UI + audit log

Error code groups:

- `DECODER_UNSUPPORTED`
- `DECODER_TIMEOUT`
- `DECODER_PROTOCOL_MISMATCH`
- `DECODER_RESOURCE_EXHAUSTED`
- `DECODER_RUNTIME_CRASH`

## 8. Versioning and Negotiation

Capability id (planned):

- `foundation.audio-input-adapter`

Negotiation steps:

1. plugin checks `host.listCapabilities()`
2. plugin verifies capability id + version range
3. plugin performs `decoder.describe` handshake
4. host validates protocol version + feature flags

Compatibility policy:

- additive fields must be optional by default
- unknown flags must be ignored unless marked `required`
- protocol major mismatch => fail fast, fallback chain proceeds

## 9. Security and Governance

- sidecar process isolation required for third-party decoders.
- decoder binary/package must pass signature trust policy.
- media path access must be allowlisted (no unrestricted filesystem walk).
- decoder telemetry and policy events feed PMPM audit log.

Minimum auditable events:

- decoder selected
- decoder session opened/closed
- fallback triggered + reason
- decoder crash/quarantine

## 10. Suggested Rollout Phases

Phase A (contract + stubs)

- reserve capability id in host contracts
- add no-op adapter methods + capability listing

Phase B (builtin adapter bridge)

- wrap existing native inputs behind unified adapter interface
- keep third-party disabled

Phase C (sidecar plugin adapter)

- enable external decoder registration
- enforce permission + signature + timeout + fallback

Phase C.1 (host helper)

- sidecar helper registration (`registerAudioInputAdapterSidecarProvider`)
- protocol major-version compatibility check in handshake

Phase C.2 (tauri control-plane stub)

- ship Tauri command skeleton for `describe/probe/openSession/closeSession/health`
- keep runtime disabled by default; enable stub with `PMP_DECODER_SIDECAR_STUB_ENABLED=1`
- preserve fallback-first behavior when sidecar is unavailable/not-ready

Phase C.3 (governance observability)

- record adapter selection and fallback as auditable PMPM events
- record session close lifecycle event with adapter/session context
- keep audit path best-effort (never block playback control flow)

Phase D.1 (foundation hardening)

- provider quarantine policy (`quarantineThreshold`, `quarantineMs`)
- per-plugin open session cap (`maxOpenSessionsPerPlugin`)
- runtime stats (`stats`) + quarantine clear control (`clearProviderQuarantine`)
- governance audit events for quarantine/clear flow

Phase D.2 (production hardening)

- perf observability
- memory pressure governance
- fault injection and recovery tests

## 11. Acceptance Checklist (Draft)

- decode plugin failure never blocks audio callback thread
- fallback to builtin decoder happens within bounded time
- session close releases all sidecar/shm resources
- capability negotiation supports backward-compatible upgrades
- permission denial and runtime crash are both audited
