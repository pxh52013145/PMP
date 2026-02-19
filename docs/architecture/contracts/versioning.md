# Contracts Versioning Policy

## Scope
- Plugin manifest contract (`manifest.json` / `.pmpm`)
- Host API contract (`host/audio/visualizer/navigation/config/window`)
- Host capability contract (`host.listCapabilities` + `host.invokeCapability`)

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

## Security / Governance
- New capabilities must be deny-by-default.
- Every capability should declare a permission namespace and audit-friendly action path.
- Wildcard permissions (`namespace:*`) must be minimized and reviewed.

