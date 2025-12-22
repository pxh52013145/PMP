# 插件契约：.pmpm Manifest + Host API（PMPM）

> 目标：把插件系统从“实现细节”升级为“可稳定演进的契约”。  
> 现状实现：`apps/desktop/src/magnet-system/plugins/*`；总体方案：`docs/plugin.md`、`docs/phase4-pmpm-ecosystem.md`。

## 1) `.pmpm` 包格式（As-Is）

- `.pmpm` 本质是 zip（改后缀）。
- 最少包含：
  - `manifest.json`
  - `entryPoint` 指向的 ESM 模块代码

安装/校验/签名/权限：`apps/desktop/src/magnet-system/plugins/pmpm.ts`

## 2) Manifest（核心字段）

（精简版，仅列出目前实现支持的字段；完整校验以代码为准）

- `formatVersion: "1.0"`
- `apiVersion: string`（与 Host API 版本兼容）
- `type: "magnet-plugin"`
- `metadata: { id, name, version, ... }`
- `entryPoint: string`
- `permissions?: string[]`（默认拒绝，按声明裁剪注入）
- `contributions?: { settingsPanels/pages/visualizers/windows/commands }`
- `magnet?: { defaultAnchor/defaultStyle }`（用于生成 Magnet 模板）

## 3) 插件入口导出（运行时契约）

插件 entry 模块需要导出以下函数之一（宿主按需调用）：

```ts
export function mount(container: HTMLElement, api: PluginMountApi): void | (() => void);

export function mountSettings(container: HTMLElement, api: PluginMountApi, panelId?: string): void | (() => void);
export function mountPage(container: HTMLElement, api: PluginMountApi, pageId: string): void | (() => void);
export function mountVisualizer(container: HTMLElement, api: PluginMountApi, visualizerId: string): void | (() => void);
export function mountWindow(container: HTMLElement, api: PluginMountApi, windowId: string): void | (() => void);
```

> 卸载时：宿主会调用 cleanup（若返回），并清空 container。

## 4) Host API（As-Is：当前注入能力）

注入实现：`apps/desktop/src/magnet-system/plugins/pluginHostApi.ts`

当前 API（按权限裁剪）：
- `audio`：状态与控制（`api:audio-state` / `api:audio-control`）
- `visualizer`：频谱读取与订阅（`api:audio-visual`）
- `navigation`：页面跳转与返回（`api:navigation`）
- `config`：插件私有配置读写（`storage:local`）
- `window`：打开/关闭插件窗口（`api:window`）

权限拒绝会记录审计（best-effort）：`apps/desktop/src/magnet-system/plugins/pmpm.ts`

## 5) To-Be（规划：让它更像 foobar 的 SDK）

- Host SDK 抽离为独立 package（例如 `packages/host-sdk`），统一 types/版本/运行时 helper。
- 引入 ServiceRegistry + EventBus 后，Host API 以“capability + event”形式暴露，减少直接耦合到内部 contexts。
- 插件强隔离（R5）：Host API 通过 RPC 提供，支持 kill/超时/回收。

实现状态：见 `docs/architecture/status.md`。

