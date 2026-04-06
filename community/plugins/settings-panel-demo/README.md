# Settings Panel Demo

## What this plugin validates
- `contributions.settingsPanels[]` registration
- `mountSettings(container, api, panelId?)` rendering
- Config editing and cross-surface updates via `storage:local`

## Surfaces
- Magnet surface via `mount(container, api)`
- Settings panel surface via `mountSettings(container, api, panelId?)`

## Install
1. Build the package: `pnpm plugin:pack:settings-panel-demo`
2. Import the generated `.pmpm` in PMP Plugin Settings.
3. Open the settings panel from Settings → Plugins.

