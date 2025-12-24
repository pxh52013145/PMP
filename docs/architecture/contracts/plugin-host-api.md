# 插件契约：.pmpm（Magnet Plugin v1）+ Host API

> 目标：把插件系统从“实现细节”升级为“可稳定演进的契约”。  
> 现状实现：`apps/desktop/src/magnet-system/plugins/pmpm.ts`、`apps/desktop/src/magnet-system/plugins/PluginMagnetHost.tsx`。  
> To-Be（更接近 foobar 的 SDK/贡献点）：见 `docs/refactor.md`（R2/R3/R5）与 `docs/architecture/interface-plan.md`。

## 1) `.pmpm` 包格式（As-Is）

- `.pmpm` 本质是 zip（改后缀）。
- 最少包含：
  - `manifest.json`
  - `entryPoint` 指向的 ESM 模块代码
- 安装方式（现状）：读取文件 → `fflate.unzip`（异步）→ 解析 manifest → 提取 entryPoint code → 写入“索引（localStorage）+ 代码（durable store）”（R3）。

## 2) Manifest（As-Is：当前代码支持的字段）

完整校验以代码为准：`apps/desktop/src/magnet-system/plugins/pmpm.ts`

- `formatVersion: "1.0"`
- `type: "magnet-plugin"`
- `metadata: { id, name, version, author?, description?, tags? }`
- `entryPoint: string`
- `magnet?: { defaultAnchor?, defaultStyle? }`（用于生成 Magnet 模板）
- `permissions?: string[]`（R5 partial：Host API 会按权限 gate，并记录 denied audit）
- `contributions?: { workbenches?: Array<{ id, title, description?, group?, order?, tags?, metadata? }>, pages?: Array<{ id, title, description?, group?, order?, tags?, metadata? }>, windows?: Array<{ id, title, description?, width?, height?, group?, order?, tags?, metadata? }>, commands?: Array<{ id, title, description?, group?, order?, tags?, metadata? }>, settingsPanels?: Array<{ id, title, description?, group?, order?, tags?, metadata? }>, visualizers?: Array<{ id, title, description?, inputs?, group?, order?, tags?, metadata? }> }`（R2/R4）
  - `workbenches`：Host 会生成并注册 workbench id：`pmpm:<pluginId>:workbench:<workbenchId>`（渲染时调用插件 `mountWorkbench(container, api, workbenchId)`）
  - `pages`：Host 会生成并注册页面 id：`pmpm:<pluginId>:page:<pageId>`（渲染时调用插件 `mountPage(container, api, pageId)`）
  - `windows`：Host 会生成并注册窗口贡献：`id=pmpm:<pluginId>:window:<windowId>`，`label=plugin-<pluginId>-<windowId>`，`route=/#/plugin-window/<pluginId>/<windowId>`

## 3) 插件入口导出（As-Is）

插件 entry 模块必须导出：

```ts
export function mount(container: HTMLElement, api: PluginMountApi): void | (() => void);
```

可选导出（现状代码已支持的 surface）：

```ts
export function unmount?(container: HTMLElement): void;
export default { mount, unmount? };
```

```ts
export function mountWorkbench?(
  container: HTMLElement,
  api: PluginMountApi,
  workbenchId: string
): void | (() => void);

export function unmountWorkbench?(container: HTMLElement, workbenchId: string): void;

export function mountSettings?(
  container: HTMLElement,
  api: PluginMountApi,
  panelId?: string
): void | (() => void);

export function mountPage?(
  container: HTMLElement,
  api: PluginMountApi,
  pageId: string
): void | (() => void);

export function mountVisualizer?(
  container: HTMLElement,
  api: PluginMountApi,
  visualizerId: string
): void | (() => void);

export function mountWindow?(
  container: HTMLElement,
  api: PluginMountApi,
  windowId: string
): void | (() => void);

export function runCommand?(
  api: PluginMountApi,
  commandId: string,
  args?: unknown
): void | Promise<void>;
```

> 卸载时：宿主会调用 cleanup（若 `mount()` 返回函数），并清空 container。

## 4) Host API（As-Is：当前注入能力）

注入实现：
- Host API（统一实现）：`apps/desktop/src/magnet-system/plugins/pluginHostApi.ts`（权限 gate + denied audit）
- Sandbox runtime（实验特性，R5）：`apps/desktop/src/magnet-system/plugins/PmpmSandboxHost.tsx`（iframe + RPC + heartbeat）

当前 API（最小集）：
- `audio`：状态与控制（`getState/onStateChange/onTimeUpdate/onEnded/play/pause/stop/seek/setVolume/toggleMute`）
- `visualizer`：频谱（`getSpectrum/onSpectrum`）
- `navigation`：页面跳转与返回（`navigateTo/goBack`，params 会走统一校验）
- `config`：插件本地配置（`get/set/patch/reset/onChange`，由宿主持久化）
- `window`：打开/关闭插件窗口（`open/close`，按 label/route 规范）

限制（现状）：
- `manifest.permissions` 已在 host 侧做最小 gate（`pluginHostApi.ts`），并已提供 denied audit + enable/disable UI；更细的策略与强隔离仍在 R5 演进。
- Host 可能基于用户配置进一步禁用部分权限（per-plugin denied permissions），插件必须处理 API 返回空值/拒绝的情况。
- `navigation.navigateTo(page, params)` 的 params 需要满足 Navigation 契约（统一校验入口见 `docs/architecture/contracts/navigation.md`）。
- API 未版本化（建议先在 contracts 中定义 To-Be 的 `apiVersion` 与兼容策略，见 `docs/architecture/contracts/versioning.md`）。

## 5) To-Be（规划：贡献点 + SDK + 治理）

- Host SDK 抽离为独立 package（例如 `packages/host-sdk`），统一 types/版本/运行时 helper。
- 扩展贡献点：`settingsPanels/pages/windows/visualizers/commands` 统一走 ContributionRegistry（R2）。
- 权限与审计：deny-by-default + 记录拒绝（best-effort）+ UI 可见（R3）。
- 强隔离（R5）：插件运行时通过 RPC 提供 Host API，支持 kill/超时/回收（现状已提供 iframe sandbox MVP，仍需完善 worker/资源回收策略）。

实现状态：见 `docs/architecture/status.md`。
