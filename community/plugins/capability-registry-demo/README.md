# Capability Registry Demo

## What this plugin validates
- `api.host.listCapabilities()`
- `api.host.invokeCapability('core.capability-registry', 'describe' | 'list')`
- Permission model for direct host capability invocation (`api:host` + `api:host-capability`)

## Surfaces
- Magnet surface via `mount(container, api)`

## Install
1. Build the package: `pnpm plugin:pack:capability-registry-demo`
2. Import the generated `.pmpm` in PMP Plugin Settings.
3. Add the magnet from the Magnet library if you want it in the matrix.

## Tips
- Try denying `api:host-capability` in the plugin permission UI to see direct invoke failures (listCapabilities should still work with `api:host`).

