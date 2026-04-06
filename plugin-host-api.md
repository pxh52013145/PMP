# PMPM Plugin Host API 合约（当前生效）

> 更新时间：2026-04-06  
> 适用范围：`apps/desktop/src/magnet-system/plugins` 下 PMPM 插件运行时（磁贴、页面、可视化、设置页、子窗口、命令）

本文档描述 **插件侧可调用接口**（`api` 对象）与 Host Capability 合约，并给出可维护的变更流程。

---

## 1. 单一事实源（Source of Truth）

维护接口时，以以下文件为准（按优先级）：

1. 类型契约：`apps/desktop/src/magnet-system/plugins/host-api/types.ts`
2. Host 实现：`apps/desktop/src/magnet-system/plugins/host-api/createPluginMountApi.ts`
3. 沙箱桥接（插件实际拿到的 API）：`apps/desktop/src/magnet-system/plugins/pmpmSandboxSrcDoc.ts`
4. 权限定义：`apps/desktop/src/magnet-system/plugins/host-api/permissions.ts`
5. Capability 注册与内置方法：`apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`
6. 版本号：`apps/desktop/src/constants/versions.ts`

> 备注：`HOST_API_VERSION` 当前为 `1.8.0`。
>
> Capability ID 命名说明（避免文档与实现漂移）：
>
> - **新主线**：`core.*` + `host.pmp.*`（建议新插件/新能力优先使用）
> - **兼容别名**：部分 `foundation.*` 仍保留，用于 compat 迁移/历史插件兼容（典型：`foundation.capability-registry` / `foundation.audio-input-adapter`）
> - **以运行时可见为准**：优先用 `api.host.listCapabilities()` 或 `core.capability-registry.describe` 发现能力，而不是硬编码能力列表

---

## 2. 插件入口与挂载面

插件入口函数（按 surface）由沙箱运行时约定：

- `mount(container, api, mountContext)`（magnet）
- `mountSettings(container, api, panelId?)`
- `mountPage(container, api, pageId)`
- `mountVisualizer(container, api, visualizerId)`
- `mountWindow(container, api, windowId)`
- `runCommand(api, commandId, args?)`

`api` 对象固定包含 6 个域：

- `api.host`
- `api.audio`
- `api.visualizer`
- `api.navigation`
- `api.config`
- `api.window`

---

## 3. 权限模型

### 3.1 权限常量

定义见 `host-api/permissions.ts`：

- `api:host`
- `api:host-capability`
- `api:audio-state`
- `api:audio-control`
- `api:audio-visual`
- `api:audio-cover`
- `api:ai-runtime`
- `api:audio-input-adapter`
- `api:desktop-pet`
- `api:voice-training`
- `api:navigation`
- `api:window`
- `storage:local`
- `net:all` / `net:*`（网络通配）

### 3.2 权限判定规则

- 精确命中：`permissions.has(capability)`。
- 网络通配：`net:*` 或 `net:all` 视为允许所有 `net:` 前缀能力。
- 前缀通配：`xxx:*` 可匹配同前缀能力（由 `hasPermission` 实现）。

---

## 4. 插件可调用 API（`api.*`）

> 类型定义总览：`PluginMountApi`（`host-api/types.ts`）。

### 4.1 `api.host`

| 方法 | 权限 | 返回 | 说明 |
| --- | --- | --- | --- |
| `getInfo()` | `api:host` | `PluginHostInfo \| null` | 包含 `pluginId/hostLabel/hostApiVersion/appVersion/runtime` |
| `listPermissions()` | `api:host` | `string[]` | 当前插件生效权限 |
| `hasPermission(capability)` | `api:host` | `boolean` | 按 Host 权限规则判断 |
| `listCapabilities()` | `api:host` | `Promise<PluginHostCapabilityInfo[]>` | 返回当前可见 capability |
| `invokeCapability(capabilityId, method, payload?)` | `api:host` + `api:host-capability` + capability 自身权限 | `Promise<unknown>` | 调用 Host Capability |

`host.invokeCapability` 额外约束：

- `method` 正则：`^[a-z][a-z0-9_.-]{0,63}$`
- `payload` 必须可 JSON 序列化
- `payload` 大小上限：`256KB`
- 超时：`6000ms`

### 4.2 `api.audio`

#### 状态类（`api:audio-state`）

- `getState()`
- `onStateChange(cb)`
- `onTimeUpdate(cb)`
- `onEnded(cb)`
- `onLoadProgress(cb)`
- `onError(cb)`
- `getPlayMode()`

#### 控制类（`api:audio-control`）

- `play()`
- `pause()`
- `stop()`
- `seek(time)`
- `setVolume(volume)`
- `toggleMute()`
- `playNext()`
- `playPrevious()`
- `playTrackAtIndex(index)`
- `setPlayMode(mode)`（`sequence | loop | single-loop | shuffle`）

#### 封面与取色（`api:audio-cover`）

- `getCover(): Promise<PluginCoverSnapshot | null>`
- `PluginCoverSnapshot = { url: string; colors: DynamicColors }`
- 内部流程：解析当前曲目封面 → `getDynamicColorsForImageUrl` 取色

### 4.3 `api.visualizer`（`api:audio-visual`）

- `getSpectrum(): Uint8Array | null`
- `getSpectrumFrame(options?: { tap?: 'pre-dsp' | 'post-dsp' }): AudioSpectrumFrame | null`
- `onSpectrum(cb, options?: { intervalMs?: number }): () => void`
- `onSpectrumFrame(cb, options?: { tap?: 'pre-dsp' | 'post-dsp'; intervalMs?: number }): () => void`

### 4.4 `api.navigation`（`api:navigation`）

- `navigateTo(page, params?)`
- `goBack()`
- `getSnapshot()`
- `onChange(cb)`
- `canGoBack()`

导航参数会做 host 侧校验（`track/album/artist/plugin-page/plugin-visualizer` 要求参数）。

### 4.5 `api.config`（`storage:local`）

- `get()`
- `set(next)`
- `patch(next)`
- `reset()`
- `onChange(cb)`

### 4.6 `api.window`（`api:window`）

- `open(windowId, options?)`
- `close(windowId)`

约束：`windowId` 必须匹配 `^[a-z0-9-]{1,48}$`。

---

## 5. Host Capability 合约

Capability 注册中心位于 `host-api/capabilities.ts`。

> 说明：下表是“常见/关键能力”的索引，不保证覆盖全部。以 `api.host.listCapabilities()` 的结果为准。

### 5.1 内置 Capability 列表

| Capability ID | 版本 | 权限 | 说明 |
| --- | --- | --- | --- |
| `core.host-api` | `HOST_API_VERSION` | 无 | Host API 元信息 |
| `core.capability-registry` | `1.1.0` | `api:host` | capability 发现与查询（推荐） |
| `foundation.capability-registry` | `1.1.0` | `api:host` | capability 发现与查询（legacy alias） |
| `host.pmp.storage.config` | `1.0.0` | `storage:local` | 插件配置存储桥（config） |
| `host.pmp.navigation` | `1.0.0` | `api:navigation` | PMP 导航桥 |
| `host.pmp.audio-engine.analysis` | `1.0.0` | `api:audio-visual` | PMP 音频分析/频谱桥 |
| `host.pmp.audio-engine.input` | `0.4.0` | `api:audio-input-adapter` | PMP 音频输入适配器桥（openSession/closeSession） |
| `foundation.ai-adapter` | `0.4.0` | `api:ai-runtime` | AI Provider 注册与调用桥 |
| `foundation.audio-input-adapter` | `0.4.0` | `api:audio-input-adapter` | 音频输入适配器桥（legacy alias；建议改用 `host.pmp.audio-engine.input`） |
| `foundation.desktop-pet-runtime` | `0.3.0` | `api:desktop-pet` | 桌宠运行时 provider 桥 |
| `foundation.voice-training-runtime` | `0.3.0` | `api:voice-training` | 声训运行时 provider 桥 |

### 5.2 各 Capability 支持方法

- `core.capability-registry` / `foundation.capability-registry`（同一合约）
  - `describe`
  - `list`
  - `get`
  - `has`

- `foundation.ai-adapter`
  - `describe`
  - `health`
  - `listProviders`
  - `invoke`
  - `searchTracks`
  - `queueTracks`
  - `playTrack`

- `foundation.audio-input-adapter`
  - `describe`
  - `health`
  - `listInputs`
  - `listProviders`
  - `stats`
  - `clearProviderQuarantine`
  - `probe`
  - `openSession`
  - `closeSession`

- `foundation.desktop-pet-runtime`
  - `describe`
  - `health`
  - `listProviders`
  - `invoke`

- `foundation.voice-training-runtime`
  - `describe`
  - `health`
  - `listProviders`
  - `invoke`

---

## 6. 错误与返回约定

### 6.1 Host Capability 结果结构

Capability handler 通常返回：

- 成功：`{ ok: true, data: ... }`
- 失败：`{ ok: false, error: { code, message, retryable?, details? } }`

### 6.2 权限不足时的行为

多数 API 采用“安全降级”：返回 `null` / 空数组 / no-op，不中断宿主。

`host.invokeCapability` 额外会对参数、权限、超时等抛出错误；插件侧应使用 `try/catch` 包裹。

---

## 7. 维护流程（强约束）

当你新增或修改插件可调用接口时，按以下顺序修改：

1. 更新类型：`host-api/types.ts`
2. 更新 Host 实现：`host-api/createPluginMountApi.ts`
3. 同步沙箱代理：`pmpmSandboxSrcDoc.ts`
4. 涉及权限则更新：`host-api/permissions.ts`
5. 涉及 capability 则更新：`host-api/capabilities.ts`
6. 校验导出边界：`host-api/index.ts` 与 `pluginHostApi.ts`
7. 若有对外破坏或新增能力，更新 `HOST_API_VERSION`

---

## 8. 回归检查（建议）

```bash
pnpm --dir apps/desktop type-check
pnpm --dir apps/desktop lint
pnpm --dir apps/desktop test -- src/magnet-system/plugins/__tests__/pmpmHostApiExtensions.spec.ts
pnpm --dir apps/desktop test -- src/magnet-system/plugins/__tests__/pmpmCoverApi.spec.ts
pnpm --dir apps/desktop test -- src/magnet-system/plugins/__tests__/audioInputAdapterSidecar.spec.ts
```

---

## 9. FAQ / 常见误解

### 9.1 `api.audio` 是音频可视化吗？

- `api.audio`：播放状态、播放控制、封面快照与取色（`getCover()`）。
- `api.visualizer`：频谱/FFT 数据（`getSpectrum()` / `getSpectrumFrame()` / `onSpectrum*`），用于音频可视化渲染。

### 9.2 “Magnet 底部/外层 div 透明度”属于 Host API 吗？

不属于。

它是宿主侧 Magnet 外壳（chrome/base layer）的样式属性：`Magnet.style.opacity`，由
`apps/desktop/src/components/magnet/Magnet.tsx` 在渲染时应用（插件侧 `api.*` 目前不提供修改接口）。

## 9. 最小示例：封面取色 + 频谱

```ts
export function mount(container: HTMLElement, api: any) {
  async function render() {
    const cover = await api.audio.getCover();
    const bins = api.visualizer.getSpectrum();

    container.innerHTML = `
      <div>cover: ${cover?.url ?? 'none'}</div>
      <div>palette: ${cover ? 'ok' : 'none'}</div>
      <div>spectrum bins: ${bins ? bins.length : 0}</div>
    `;
  }

  render();
  const off = api.audio.onStateChange(() => void render());
  return () => off();
}
```
