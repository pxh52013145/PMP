# Platform Pack Resource Layout

`platform-pack` is a zip-based capability package. The host accepts `.pmpp` and `.zip`.

Canonical architecture:
1. `documents/music-platform/music-platform-final-architecture.md`

Minimal required contents:
1. `manifest.json`
2. The contract file referenced by `manifest.entry.contract`
3. The runtime artifact referenced by `manifest.entry.runtime`, for example `runtime.js`
4. The icon asset referenced by `manifest.entry.icon`
5. If `manifest.entry.sidecar` is declared, that sidecar artifact must also be inside the pack

Identity rules:
1. Pack path, filename, and unpack directory are never platform identity
2. Platform identity comes from `manifest.connector.connectorId`
3. Platform capability metadata comes from `manifest + contract`
4. Account identity comes from `instanceId`

Runtime rules:
1. `runtime.js` must export at least one compatible integration entry:
   - `createConnectorAdapter` or `connectorAdapter`
   - `createRuntimeApi` or `runtimeApi`
   - `createAuthBindingProvider` or `authBindingProvider`
   - `createBindingProvider` or `bindingProvider`
2. The host can synthesize the standard runtime path when the pack only exports binding providers, but only for the current PMP-supported binding ids:
   - `host.pmp.connector-auth`
   - `host.pmp.platform-instance.library`
   - `host.pmp.platform-instance.recommendations`
   - `host.pmp.platform-instance.search`
   - `host.pmp.platform-instance.quality`
   - `host.pmp.platform-instance.pages`
3. Navigation/settings bindings are not part of the current synthesized host surface. Packs that reference other binding ids must bring their own runtime behavior and will show readiness diagnostics in host tooling
4. Runtime coverage must match the API buckets declared by the contract
5. The host executes runtime artifacts, not source trees. TS/Rust source may be shipped as extra resources, but the host must not depend on compiling them dynamically
6. Standard pack runtime code should depend on the public runtime context and binding contract only. Host-private helper injections such as `createDefaultRuntimeApi` / `createDefaultAuthBindingProvider` / `createDefaultBindingProvider` are not part of the pack contract

Workspace UI rules:
1. A pack-owned UI is declared from the contract `workspace` field, not by adding host React components
2. Full workspace UI should declare `workspace.ownership = "pack"` and a `workspace.root.viewId`
3. Slot-based UI can declare `workspace.shellSlots[]` for host shell reuse
4. The host mounts the workspace into the Platform instance surface through the runtime bridge
5. Pack UI must use host capabilities for audio, auth, storage, navigation, telemetry, and workspace/search/prepare access
6. Pack UI must not call Tauri APIs or read arbitrary AppData paths directly

Builtin source directories in this repo:
1. `resource/music-platform/packs/builtin/bilibili/`
2. `resource/music-platform/packs/builtin/netease/`

Published builtin pack outputs:
1. `resource/music-platform/packs/dist/builtin-bilibili.pmpp`
2. `resource/music-platform/packs/dist/builtin-netease.pmpp`
3. `apps/desktop/public/resource/music-platform/packs/dist/*.pmpp`
4. `resource/music-platform/packs/dist/builtin-pack-index.json`
5. `apps/desktop/public/resource/music-platform/packs/dist/builtin-pack-index.json`

Builtin preparation workflow:
1. Build or refresh builtin sidecars and `.pmpp` outputs:

```powershell
pnpm prepare:platform-packs
```

2. Validate that builtin sidecars, pack archives, and the pack index are already current without writing files:

```powershell
pnpm prepare:platform-packs:check
```

3. For debug/dev startup parity, the desktop package already runs the same script with `--profile debug` from:
   - `pnpm --dir apps/desktop dev:vite:tauri`
   - `pnpm --dir apps/desktop build:vite:tauri`

Preparation script observability:
1. `node scripts/prepare-music-platform-packs.mjs --profile release --check` exits with code `1` when sidecars, pack archives, or `builtin-pack-index.json` are stale
2. Add `--json` to get a machine-readable summary for CI or local diagnosis
3. `builtin-pack-index.json` now carries `schemaVersion`, `generatedBy`, `buildProfile`, `packCount`, and per-pack artifact metadata in addition to the `packs` array the host reads today

Current host model:
1. Builtin and external packs now enter the same parse/install/unpack/register pipeline
2. Installed artifacts are deployment/cache locations only, never runtime identity
3. External pack registration now prefers explicit runtime/adapters, then the standard binding-contract synthesis path, and only treats incompatible packs as explicit readiness failures
4. Cookie/token/keyring state must stay bound to `instanceId`, not pack path

Pack authoring workflow:
1. Create a directory that follows the contract-driven layout described above
2. Put runtime artifacts and optional sidecar binaries into that directory
3. Package it with:

```powershell
pnpm pack:platform -- --source resource/music-platform/packs/builtin/bilibili
```

You can also choose an explicit output path:

```powershell
pnpm pack:platform -- --source C:\work\qqmusic-pack --output C:\work\dist\qqmusic.pmpp
```

If you prefer a generic zip tool, make sure the archive root contains `manifest.json` directly and preserves the relative paths declared in `manifest.entry.*`.

After importing a `.pmpp`, the host will:
1. Parse `manifest / contract / runtime / icon / sidecar`
2. Install and unpack artifacts into durable storage
3. Register connector definition and runtime from `connectorId` and `platformId`
4. Keep account state on `instanceId`, not on the pack file itself
