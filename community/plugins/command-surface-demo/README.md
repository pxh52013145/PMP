# Command Surface Demo

## What this plugin validates
- `contributions.commands[]` registration
- `runCommand(api, commandId, args)` execution
- PMPM inline + sandbox command runner
- Native manifest-v2 `extension-host` worker command runner
- Plugin config persistence via `storage:local`

## Surfaces
- Magnet surface via `mount(container, api)`
- Command surface via `runCommand(api, commandId, args)`

## Install
1. Build the package: `pnpm plugin:pack:command-surface-demo`
2. Import the generated `.pmpm` in PMP Plugin Settings.
3. Add the magnet from the Magnet library if you want it in the matrix.

## Install As Manifest-v2
1. Open PMP Plugin Settings.
2. In the `Manifest-v2 Extensions` section, install `community/plugins/command-surface-demo/manifest.v2.json`.
3. Run the contributed commands from the command palette to validate the native worker path.

## How to use
- Open PMP command palette and run:
  - `Command Surface Demo: Increment Counter`
  - `Command Surface Demo: Reset Counter`
- The magnet view updates by reading `api.config` and subscribing to `api.config.onChange`.
