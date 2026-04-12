# Community Plugins (Demos / Fixtures)

This folder contains demo plugins used to validate the plugin runtime, protocol transport, and surface mounting.

## Installable `.pmpm` demos
- `pmp-audio-analysis-lab`  
  - Visualizer-focused analysis tooling (legacy demo).
- `stream-protocol-demo`  
  - Protocol lifecycle demo: stream/session/cancel/dispose + crash cleanup.
- `hello-magnet-demo`  
  - Minimal magnet-only smoke test (no permissions).
- `capability-registry-demo`  
  - Direct capability discovery and invocation (`core.capability-registry`).
- `command-surface-demo`  
  - Command contribution + `runCommand` + config persistence (`storage:local`).
- `settings-panel-demo`  
  - Settings panel contribution + `mountSettings` + config editing (`storage:local`).
- `sidecar-echo-demo`  
  - Installable PMPM sidecar demo for native-process command launch + capability round-trip.

## Manifest-v2 fixtures
- `sidecar-capability-demo`
  - Manifest-v2 sidecar fixture for native-process handshake, capability invoke, and crash cleanup.
- `sidecar-echo-demo`
  - Shares the same sidecar script, but keeps `manifest.v2.json` as a resolver/runtime-bridge fixture.
- `plugin-starter`
  - Reusable manifest-v2 starter scaffold for new page/settings/magnet plugins.
- `utils`
  - SAO Utils-inspired hybrid fixture combining a host-managed magnet/page/overlay/widget shell with a sidecar probe lane.

## Packaging
- `pnpm plugin:pack:stream-demo`
- `pnpm plugin:pack:hello-magnet-demo`
- `pnpm plugin:pack:capability-registry-demo`
- `pnpm plugin:pack:command-surface-demo`
- `pnpm plugin:pack:settings-panel-demo`
- `pnpm plugin:pack:sidecar-echo-demo`
