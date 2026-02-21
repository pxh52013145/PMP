# Contracts Versioning Policy

## Scope
- Plugin manifest contract (`manifest.json` / `.pmpm`)
- Host API contract (`host/audio/visualizer/navigation/config/window`)
- Host capability contract (`host.listCapabilities` + `host.invokeCapability`)
- Decoder adapter contract (draft): `foundation.audio-input-adapter`

## Semver Rules
- `MAJOR`: breaking change, requires plugin migration path and fallback/disable strategy.
- `MINOR`: additive, backward-compatible expansion.
- `PATCH`: bugfix without contract shape/semantics changes.

## Compatibility Matrix
- Plugin `manifest.apiVersion` should be interpreted as requested host API baseline.
- Host should keep additive compatibility for at least one major line.
- Capabilities should be feature-detected (`host.listCapabilities`) rather than inferred from app version.

## Runtime Negotiation
- Plugins should prefer capability negotiation over hard assumptions:
  1. `host.listCapabilities()`
  2. check capability `id + version`
  3. call `host.invokeCapability(...)` only when permission and capability are available
- Capability responses should use a stable envelope (`ok/data` or `ok:false/error`) to keep forward compatibility.

## Current Baseline
- Host API: `1.8.0`
- Capability baseline:
  - `foundation.capability-registry` (discovery + visibility checks)
  - `foundation.ai-adapter@0.4.0` (provider registry + invoke bridge + AI music controls)
  - `foundation.audio-input-adapter@0.4.0` (Phase D foundation runtime: `describe/health/listInputs/listProviders/stats/clearProviderQuarantine/probe/openSession/closeSession`)
  - `foundation.desktop-pet-runtime@0.3.0` (provider runtime bridge)
  - `foundation.voice-training-runtime@0.3.0` (provider runtime bridge)
- Invocation guardrails: JSON-serializable payload, 256 KiB payload ceiling, 6s timeout.
- Draft reference: `foundation.audio-input-adapter` lifecycle/IPC/RT contract in `audio-decoder-plugin-contract-draft.md` (Phase C adds governed provider skeleton + C.1 sidecar handshake helper + C.2 Tauri control-plane command skeleton + C.3 governance audit hooks + Phase D foundation governance/observability; full sidecar data plane is still pending).

## Security / Governance
- New capabilities must be deny-by-default.
- Every capability should declare a permission namespace and audit-friendly action path.
- Wildcard permissions (`namespace:*`) must be minimized and reviewed.
