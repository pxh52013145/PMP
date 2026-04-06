# Command Surface Demo

## What this plugin validates
- `contributions.commands[]` registration
- `runCommand(api, commandId, args)` execution (inline + sandbox command runner)
- Plugin config persistence via `storage:local`

## Surfaces
- Magnet surface via `mount(container, api)`
- Command surface via `runCommand(api, commandId, args)`

## Install
1. Build the package: `pnpm plugin:pack:command-surface-demo`
2. Import the generated `.pmpm` in PMP Plugin Settings.
3. Add the magnet from the Magnet library if you want it in the matrix.

## How to use
- Open PMP command palette and run:
  - `Command Surface Demo: Increment Counter`
  - `Command Surface Demo: Reset Counter`
- The magnet view updates by reading `api.config` and subscribing to `api.config.onChange`.

