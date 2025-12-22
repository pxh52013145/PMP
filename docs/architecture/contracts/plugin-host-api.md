# 插件契约：.pmpm（Magnet Plugin v1）+ Host API

> 目标：把插件系统从“实现细节”升级为“可稳定演进的契约”。  
> 现状实现：`apps/desktop/src/magnet-system/plugins/pmpm.ts`、`apps/desktop/src/magnet-system/plugins/PluginMagnetHost.tsx`。  
> To-Be（更接近 foobar 的 SDK/贡献点）：见 `docs/refactor.md`（R2/R3/R5）与 `docs/architecture/interface-plan.md`。

## 1) `.pmpm` 包格式（As-Is）

- `.pmpm` 本质是 zip（改后缀）。
- 最少包含：
  - `manifest.json`
  - `entryPoint` 指向的 ESM 模块代码
- 安装方式（现状）：读取文件 → unzipSync → 解析 manifest → 提取 entryPoint code → 写入 localStorage（`STORAGE_KEYS.PMPM_PLUGINS`）。

## 2) Manifest（As-Is：当前代码支持的字段）

完整校验以代码为准：`apps/desktop/src/magnet-system/plugins/pmpm.ts`

- `formatVersion: "1.0"`
- `type: "magnet-plugin"`
- `metadata: { id, name, version, author?, description?, tags? }`
- `entryPoint: string`
- `magnet?: { defaultAnchor?, defaultStyle? }`（用于生成 Magnet 模板）
- `permissions?: string[]`（现状**仅存储**，尚未裁剪/治理）

## 3) 插件入口导出（As-Is）

插件 entry 模块必须导出：

```ts
export function mount(container: HTMLElement, api: PluginMountApi): void | (() => void);
```

可选导出：

```ts
export function unmount?(container: HTMLElement): void;
export default { mount, unmount? };
```

> 卸载时：宿主会调用 cleanup（若 `mount()` 返回函数），并清空 container。

## 4) Host API（As-Is：当前注入能力）

注入实现：`apps/desktop/src/magnet-system/plugins/PluginMagnetHost.tsx`

当前 API（最小集）：
- `audio`：状态与控制（`getState/onStateChange/onTimeUpdate/onEnded/play/pause/stop/seek/setVolume/toggleMute`）
- `navigation`：页面跳转与返回（`navigateTo/goBack`）

限制（现状）：
- `manifest.permissions` 尚未真正裁剪注入（治理/审计在 R3/R5 补齐）。
- API 未版本化（建议先在 contracts 中定义 To-Be 的 `apiVersion` 与兼容策略，见 `docs/architecture/contracts/versioning.md`）。

## 5) To-Be（规划：贡献点 + SDK + 治理）

- Host SDK 抽离为独立 package（例如 `packages/host-sdk`），统一 types/版本/运行时 helper。
- 扩展贡献点：`settingsPanels/pages/windows/visualizers/commands` 统一走 ContributionRegistry（R2）。
- 权限与审计：deny-by-default + 记录拒绝（best-effort）+ UI 可见（R3）。
- 强隔离（R5）：插件运行时通过 RPC 提供 Host API，支持 kill/超时/回收。

实现状态：见 `docs/architecture/status.md`。
