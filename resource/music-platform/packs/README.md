# Platform Pack Resource Layout

`platform-pack` is a zip-based capability package. The host accepts `.pmpp` and `.zip`.

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
1. `runtime.js` must export at least one runtime entry:
   - `createConnectorAdapter` or `connectorAdapter`
   - `createRuntimeApi` or `runtimeApi`
   - `createAuthBindingProvider` or `authBindingProvider`
   - `createBindingProvider` or `bindingProvider`
2. Runtime coverage must match the API buckets declared by the contract
3. The host executes runtime artifacts, not source trees. TS/Rust source may be shipped as extra resources, but the host must not depend on compiling them dynamically
4. Standard pack runtime code should depend on the public runtime context and binding contract only. Host-private helper injections such as `createDefaultRuntimeApi` / `createDefaultAuthBindingProvider` / `createDefaultBindingProvider` are not part of the pack contract

Builtin source directories in this repo:
1. `resource/music-platform/packs/builtin/bilibili/`
2. `resource/music-platform/packs/builtin/netease/`

Published builtin pack outputs:
1. `resource/music-platform/packs/dist/builtin-bilibili.pmpp`
2. `resource/music-platform/packs/dist/builtin-netease.pmpp`
3. `apps/desktop/public/resource/music-platform/packs/dist/*.pmpp`

Current host model:
1. Builtin and external packs now enter the same parse/install/unpack/register pipeline
2. Installed artifacts are deployment/cache locations only, never runtime identity
3. Cookie/token/keyring state must stay bound to `instanceId`, not pack path

Pack authoring workflow:
1. Create a directory that follows the contract-only layout described above
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
