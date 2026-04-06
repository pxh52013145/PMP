# Stream Protocol Demo

## What this plugin is
- A standalone `.pmpm` demo plugin for exercising the real PMPM runtime protocol.
- It is no longer bundled into the desktop app source or exposed through a host-side special install button.

## What it validates
- Real `.pmpm` install
- Real runtime resolve / launcher
- `host.openStream('host.pmp.audio-engine.analysis', 'openSpectrumFrameStream')`
- `host.openSession('host.pmp.audio-engine.input', 'openSession')`
- Runtime crash / dispose cleanup

## Notes / gotchas
- The demo calls `host.openSession('host.pmp.audio-engine.input','openSession',{ path, fallbackToBuiltin:true })`.
  - `path` is currently hardcoded in `index.js` as `AUDIO_INPUT_SOURCE_PATH`.
  - If the file does not exist or the host has no available audio input adapters, the session open will fail (the stream demo can still run; you just won't get the session metadata).
  - This is intentionally kept simple, but it also highlights a platform gap: we still need a sandbox-safe way to pick/authorize file resources instead of relying on absolute paths.

## Surfaces
- Magnet surface via `mount(container, api)`
- Visualizer contribution `stream-protocol-lab`

## Install
1. Build or use the packaged file `stream-protocol-demo-0.1.1.pmpm`.
2. Open Plugin Settings in PMP.
3. Install the `.pmpm` through the normal plugin import flow.
4. Add the magnet manually from the Magnet library if you want it in the matrix.
5. Open the visualizer from the Visualizers settings panel if you want the lab view.

## Rebuild package
Run:

```bash
pnpm plugin:pack:stream-demo
```

This regenerates the packaged `.pmpm` beside `manifest.json` and `index.js`.
