# Hello Magnet Demo

## What this plugin is
- A minimal `.pmpm` demo plugin with **no permissions**.
- Used as a smoke test for install + mount + unmount in both inline and sandbox runtimes.

## Surfaces
- Magnet surface via `mount(container, api, context)`

## Install
1. Build the package: `pnpm plugin:pack:hello-magnet-demo`
2. Import the generated `.pmpm` in PMP Plugin Settings.
3. Add the magnet from the Magnet library if you want it in the matrix.

