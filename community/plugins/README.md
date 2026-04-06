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

## Packaging
- `pnpm plugin:pack:stream-demo`
- `pnpm plugin:pack:hello-magnet-demo`
- `pnpm plugin:pack:capability-registry-demo`
- `pnpm plugin:pack:command-surface-demo`
- `pnpm plugin:pack:settings-panel-demo`

