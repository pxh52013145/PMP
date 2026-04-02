# PMP Host Capability Pack 规范

状态：draft

## 1. 文档目标

本文档定义 `host.pmp.*` 能力包的硬边界。

它要解决的不是“PMP 现在有什么 API”，而是 3 个更基础的问题：

- 哪些能力永远属于 PMP 宿主，不得误入 `core`
- PMP 现有模块如何提炼为稳定、可协商、可版本化的 host capability family
- 哪些当前散落在宿主里的 i18n / keybindings / telemetry / storage / auth 语义，必须升级为正式契约

本文档不负责：

- Manifest 设计
- Runtime bridge 生命周期
- Capability 协议 payload 细节

相关规范：

- [PXP 基座规范](./plugin-platform-foundation-spec.md)
- [PXP Manifest v2 规范](./plugin-platform-manifest-v2-spec.md)
- [PXP Capability / Session / Stream / Resource 协议](./plugin-platform-capability-protocol-spec.md)
- [PXP Runtime Bridge 规范](./plugin-platform-runtime-bridge-spec.md)

## 2. 当前代码事实

当前 PMP 并不是“完全没有 host capability”，而是已经存在多个碎片化原型：

- 当前插件挂载 API 仍然是 PMP 形状的对象注入：
  - `host`
  - `audio`
  - `visualizer`
  - `navigation`
  - `config`
  - `window`
  - 事实来源：`apps/desktop/src/magnet-system/plugins/host-api/createPluginMountApi.ts`
- 当前权限名已经存在：
  - `api:host`
  - `api:host-capability`
  - `api:audio-state`
  - `api:audio-control`
  - `api:audio-visual`
  - `api:audio-cover`
  - `api:navigation`
  - `api:window`
  - `storage:local`
  - 事实来源：`apps/desktop/src/magnet-system/plugins/host-api/permissions.ts`
- 当前 capability registry 已经存在 builtin capability id：
  - `foundation.capability-registry`
  - `foundation.ai-adapter`
  - `foundation.audio-input-adapter`
  - `foundation.desktop-pet-runtime`
  - `foundation.voice-training-runtime`
  - 事实来源：`apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`
- 当前音频输入 adapter 已经具备成熟治理语义：
  - `describe`
  - `health`
  - `listInputs`
  - `listProviders`
  - `stats`
  - `clearProviderQuarantine`
  - `probe`
  - `openSession`
  - `closeSession`
  - 并且已经有 timeout、ownership、session limit、quarantine
- 当前 sidecar-backed audio input adapter 已经存在：
  - `apps/desktop/src/magnet-system/plugins/host-api/audioInputAdapterSidecar.ts`
  - `apps/desktop/src-tauri/src/audio/decoder_sidecar.rs`
- 当前导航契约已经存在：
  - `apps/desktop/src/services/navigation/NavigationService.ts`
- 当前插件窗口壳与 Tauri 策略已经存在：
  - `apps/desktop/src/utils/pluginWindows.ts`
  - `apps/desktop/src-tauri/src/windows/plugin.rs`
  - 关闭窗口默认是 hide，而不是 destroy
- 当前连接器认证已经是独立领域边界：
  - `apps/desktop/src/modules/music-platform/connectorAuth.ts`
  - 包含 auth snapshot、QR login session、poll、logout、auth changed event
- 当前主题绑定与 surface 体系已经独立：
  - `apps/desktop/src/themes/types/theme.ts`
  - `apps/desktop/src/themes/bindings.ts`
  - `apps/desktop/src/themes/surfaces.ts`
  - `apps/desktop/src/themes/useMagnetSkin.ts`
- 当前库字段与 facet catalog 已正式建模：
  - `apps/desktop/src/services/audio/MusicLibraryService.ts`
  - `apps/desktop/src-tauri/src/music_library_db.rs`
  - `apps/desktop/src-tauri/src/commands/library.rs`
- 当前 storage 边界已经独立：
  - `apps/desktop/src/modules/storage/index.ts`
  - `apps/desktop/src/modules/storage/durableTextStore.ts`
  - `apps/desktop/src/utils/windowCommunication.ts`
- 当前 i18n / keybindings / telemetry 都已经有独立宿主原型：
  - `apps/desktop/src/i18n/*`
  - `apps/desktop/src/services/keybindings/*`
  - `apps/desktop/src/services/telemetry/*`
  - `apps/desktop/src-tauri/src/telemetry*.rs`

结论：

- PMP 缺的不是“能力”，而是“把现有能力提炼为 versioned host pack”
- 如果继续只保留 `createPluginMountApi()` 这种注入式对象，PMP 依然无法成为可移植宿主

## 3. 能力包模型

### 3.1 包级标识

```ts
interface PmpHostCapabilityPackDescriptor {
  hostId: 'pmp';
  packVersion: string;
  capabilityFamilies: string[];
  coreCompatibility: string;
}
```

规则：

- `packVersion` 独立于 PMP App Version
- `hostId` 固定为 `pmp`
- 具体 capability id 必须落在 `host.pmp.*` 命名空间

### 3.2 Family 命名

采用 family namespace，而不是把所有方法塞进一个 capability：

- `host.pmp.navigation`
- `host.pmp.shell.*`
- `host.pmp.magnets.*`
- `host.pmp.audio-engine.*`
- `host.pmp.music-platform.*`
- `host.pmp.connector-auth`
- `host.pmp.theme-bindings`
- `host.pmp.library-fields`
- `host.pmp.storage.*`

原因：

- PMP 宿主本身已经是多域系统
- 如果只定义一个 `host.pmp` 万能入口，平台会重新回到大对象注入

## 4. 硬约束

1. Host capability pack 不得泄露 PMP 内部 service 类型。
2. Host capability pack 不得泄露 `localStorage` key、Tauri command 名称、内部事件总线 topic。
3. 新的宿主能力必须先落 capability contract，再允许内建模块调用。
4. 内建模块与第三方插件必须同权同构；官方代码不得长期走私有 service。
5. Host capability 必须通过 capability protocol 暴露，而不是由 runtime bridge 内联对象注入。
6. `page / window / magnet / visualizer` 这类宿主概念可以存在，但只能存在于 `host.pmp.*`。
7. 高权限能力必须声明 trust floor 与 runtime floor；“无边界”不等于“默认无限权”。
8. `i18n / keybindings / telemetry` 不是实现细节，必须由 host adapter 明确承接。

## 5. Family 目录

### 5.1 `host.pmp.navigation`

职责：

- 把 core 的 `view / surface` 请求映射到 PMP 路由与页面导航
- 提供导航快照、历史、返回能力与变更事件

当前代码事实：

- `NavigationService` 已有 `getSnapshot / navigateTo / goBack`
- 事件总线已存在 `navigation/changed`

最小目标方法：

- `describe`
- `getSnapshot`
- `navigate`
- `goBack`
- `subscribe`

边界：

- `home / track / album / artist / plugin-page / plugin-visualizer` 这些页面类型仍然属于 PMP 宿主枚举
- 它们不能提升为 `core` 页面名词

### 5.2 `host.pmp.shell.*`

职责：

- 暴露 PMP 桌面壳能力，包括：
  - window
  - menu
  - context-menu
  - tray
  - status-item
  - toolbar-item

当前代码事实：

- 现有 `window.open / window.close` 已在插件 API 中暴露
- Tauri 侧插件窗口默认 close -> hide

推荐 family 划分：

- `host.pmp.shell.window`
- `host.pmp.shell.menu`
- `host.pmp.shell.context-menu`
- `host.pmp.shell.tray`
- `host.pmp.shell.status-item`

`host.pmp.shell.window` 最小目标方法：

- `describe`
- `openWindow`
- `closeWindow`
- `focusWindow`
- `subscribeWindowState`

边界：

- 窗口 label、hide policy、geometry persistence 属于 PMP 壳能力，不进入 core
- 关闭窗口时是否 destroy 由宿主策略决定，不由插件自行假设

### 5.3 `host.pmp.magnets.*`

职责：

- 定义 PMP 专有的 magnet 生态
- 处理 renderer、variant、anchor、layout、system slot、layout migration

当前代码事实：

- Magnet 已有完整宿主域模型：
  - `apps/desktop/src/modules/magnets/*`
  - `apps/desktop/src/constants/magnets.ts`
  - `apps/desktop/src/builtin-modules/builtinMagnetRenderersModule.tsx`

推荐 family 划分：

- `host.pmp.magnets.catalog`
- `host.pmp.magnets.layout`
- `host.pmp.magnets.renderer`

最小目标职责：

- 列出 magnet renderer / variant catalog
- 暴露 system layout slot 与 anchor 规则
- 对导入布局做 normalize / migrate
- 定义 magnet 主题绑定映射规则

边界：

- `magnet` 永远是 PMP 宿主概念，不进入 core
- `platform-magnet` 这类能力如果未来插件化，仍然只能依赖 `host.pmp.magnets.*`，不能把 magnet 反推回 core

### 5.4 `host.pmp.audio-engine.*`

这是 PMP 最复杂的 host family，必须拆分。

推荐最少拆成 3 个子 family：

- `host.pmp.audio-engine.playback`
- `host.pmp.audio-engine.analysis`
- `host.pmp.audio-engine.input`

#### `host.pmp.audio-engine.playback`

职责：

- 播放状态
- transport control
- seek / volume / mute / play mode
- 当前轨道与封面引用

当前代码事实：

- `createPluginMountApi.ts` 已经暴露 `audio.getState / play / pause / seek / setVolume / getCover`

#### `host.pmp.audio-engine.analysis`

职责：

- 频谱
- tap 数据
- analyzer frame
- pre-dsp / post-dsp 采样面

当前代码事实：

- 现有 `visualizer.getSpectrum / getSpectrumFrame / onSpectrum / onSpectrumFrame`

硬约束：

- 高频分析数据必须迁移到 `stream / resource handle`
- 当前 `setInterval` 轮询方案只能作为 compat fallback

#### `host.pmp.audio-engine.input`

职责：

- 输入设备
- provider registry
- provider health
- probe
- session open / close
- quarantine governance

当前代码事实：

- 当前 `foundation.audio-input-adapter` 已经具备成熟原型
- 它应迁移到 `host.pmp.audio-engine.input` family 下

最小目标方法：

- `describe`
- `health`
- `listInputs`
- `listProviders`
- `clearProviderQuarantine`
- `probe`
- `openSession`
- `closeSession`

边界：

- `providerSessionId` 属于 capability 私有实现细节，不能上升为平台公共 session id

### 5.5 `host.pmp.music-platform.*`

职责：

- 连接器目录
- 资源浏览
- 搜索
- 播放准备
- 平台特定资源解析

当前代码事实：

- 相关能力散落在 `MusicLibraryService.ts` 与 `commands/library.rs`
- 目前仍有较强 PMP 内部服务耦合

推荐 family 划分：

- `host.pmp.music-platform.catalog`
- `host.pmp.music-platform.search`
- `host.pmp.music-platform.prepare`

边界：

- 平台认证不属于该 family
- 认证必须独立拆给 `host.pmp.connector-auth`

### 5.6 `host.pmp.connector-auth`

职责：

- 平台连接器认证快照
- QR login session
- poll
- logout / revoke
- auth changed event

当前代码事实：

- `connectorAuth.ts` 已经有：
  - `PlatformConnectorAuthSnapshot`
  - `PlatformQrLoginSession`
  - `PlatformQrLoginPollResult`
  - auth change event

最小目标方法：

- `describe`
- `listConnectors`
- `getAuthSnapshot`
- `refreshAuthSnapshot`
- `beginQrLogin`
- `pollQrLogin`
- `logout`
- `subscribe`

边界：

- 插件不得直接拿到 cookie、token、原始 credential
- credential 只能以宿主托管引用或状态快照形式暴露

### 5.7 `host.pmp.theme-bindings`

职责：

- 把 core 的 theme token / surface 抽象映射为 PMP 的 binding / surface 体系
- 承接 `magnet.<id>` 这类宿主命名空间

当前代码事实：

- `resolveThemeBinding`
- `resolveThemeSurface`
- `useMagnetSkin`
- ThemeEditor 已经围绕 `surfaces / bindings` 工作

最小目标方法：

- `describe`
- `listBindingIds`
- `listSurfaceIds`
- `resolveBinding`
- `resolveSurface`
- `subscribeThemeChanges`

边界：

- `magnet.<rendererId>` 一类 binding id 仍然是 PMP 宿主命名
- core 只定义抽象 token / surface 语义，不定义 `magnet.*` 命名

### 5.8 `host.pmp.library-fields`

职责：

- 定义音乐库字段目录与 facet 目录
- 暴露 filter / sort / facet 元数据

当前代码事实：

- 后端已经暴露：
  - `filterable`
  - `sortable`
  - `facetable`
  - `native_filter_field`
  - `native_sort_field`
- 并且已有：
  - field catalog
  - facet catalog
  - text facet value list
  - facet entry list

最小目标方法：

- `describe`
- `listFieldCatalog`
- `listFacetCatalog`
- `listFacetEntries`
- `listTextFacetValues`

边界：

- 字段 id 与 native field 名称属于 PMP 宿主模型
- 这部分可以被 MusicTag 实现自己的 `host.musictag.library-fields`，但不能强行上升为 core

### 5.9 `host.pmp.storage.*`

职责：

- 为 `core.config` 与宿主持久化实现提供正式落点
- 承接 cross-window sync、durable text、scope 映射

当前代码事实：

- 当前宿主已有：
  - `readString / readJson / writeJson`
  - `durableTextStore`
  - `windowCommunication`
- 但插件配置仍然停留在“每插件一个 key + 任意 JSON”

推荐 family 划分：

- `host.pmp.storage.config`
- `host.pmp.storage.durable-text`
- `host.pmp.storage.sync`

最小目标方法：

- `describe`
- `readConfig`
- `writeConfig`
- `patchConfig`
- `removeConfig`
- `subscribeConfig`
- `readDurableText`
- `writeDurableText`
- `removeDurableText`

硬约束：

- 不能把宿主 storage key 命名直接暴露给插件
- 不能要求插件自行处理 `localStorage + storage event`

## 6. 跨切面宿主适配器

这些能力不一定都表现为独立 public capability id，但必须在 PMP host pack 中有明确契约位置。

### 6.1 i18n 宿主适配器

当前事实：

- `apps/desktop/src/i18n/core.ts`
- `apps/desktop/src/i18n/react.ts`
- `apps/desktop/src/i18n/I18nSync.tsx`
- `apps/desktop/src/i18n/persistedLocale.ts`

必须承接的语义：

- active locale
- fallback locale
- locale change subscription
- message bundle registration
- cross-window locale sync

边界：

- 宿主自己的 i18n key 空间不能直接泄露给插件
- 插件不能依赖 PMP 私有翻译 key 作为长期契约

### 6.2 keybinding context 宿主适配器

当前事实：

- `apps/desktop/src/services/keybindings/keybindingsModule.ts`
- `apps/desktop/src/builtin-modules/builtinKeybindingsModule.ts`
- `apps/desktop/src/App.tsx`

当前已有 host context key 原型：

- `app.windowType`
- `app.isMainWindow`
- `navigation.page`
- `navigation.canGoBack`
- `audio.playbackState`
- `audio.hasCurrentTrack`
- `audio.hasQueue`
- `ui.commandPaletteOpen`

必须承接的语义：

- context schema
- context snapshot
- context change stream
- host when-clause namespace

判定：

- 当前 keybinding engine 已经接近平台原型
- 真正缺的是把 PMP 上下文键从“实现事实”提升为“宿主契约”

### 6.3 telemetry 宿主 sink

当前事实：

- 前端：
  - `apps/desktop/src/services/telemetry/TelemetryService.ts`
  - `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`
- 后端：
  - `apps/desktop/src-tauri/src/telemetry.rs`
  - `apps/desktop/src-tauri/src/telemetry_store.rs`
  - `apps/desktop/src-tauri/src/telemetry_contract.rs`

必须承接的语义：

- plugin identity 与 runtime identity 注入
- sink policy
- redaction policy
- crash correlation
- flush / persistence boundary

边界：

- 插件 telemetry 不能绕过宿主 redaction 与 persistence policy
- 插件不能把 host telemetry file path 当作公共 API

## 7. 当前契约与目标契约对比

| 当前 PMP / PMPM 原型 | 未来目标归属 | 判定 |
| --- | --- | --- |
| `createPluginMountApi().host` | bridge bootstrap + core capability discovery | 当前是大对象注入，必须拆掉 |
| `createPluginMountApi().audio` | `host.pmp.audio-engine.playback` | 当前分散在对象方法里 |
| `createPluginMountApi().visualizer` | `host.pmp.audio-engine.analysis` | 当前是轮询 fallback |
| `createPluginMountApi().navigation` | `host.pmp.navigation` | 当前已有较清晰原型 |
| `createPluginMountApi().config` | `core.config` + `host.pmp.storage.*` | 当前仍是 key-value 降级 |
| `createPluginMountApi().window` | `host.pmp.shell.window` | 当前只覆盖窗口壳的一小部分 |
| `foundation.capability-registry` | `core` 或 foundation 级 registry 契约 | 不应长期挂在 PMP host API 名下 |
| `foundation.audio-input-adapter` | `host.pmp.audio-engine.input` | 当前原型成熟，可迁移 |
| `foundation.ai-adapter` | 独立 provider family，不属于 PMP host pack 核心 | 当前命名过于暧昧 |
| `foundation.desktop-pet-runtime` | 独立 domain runtime family，不属于 PMP host pack 核心 | 不应混入通用 host pack |
| `foundation.voice-training-runtime` | 独立 domain runtime family，不属于 PMP host pack 核心 | 同上 |

## 8. 审计结论

当前最大的风险不是“PMP 没能力”，而是“PMP 能力太多，但还没有被抽成 pack”。

失效边界主要有 4 个：

1. 如果继续保留 `createPluginMountApi()` 大对象注入，host pack 会重新退化成私有 API。
2. 如果官方模块继续直接调用私有 service，同权同构会失效。
3. 如果把 `magnet / page / window / visualizer` 重新抬回 core，宿主无关性会失效。
4. 如果 `i18n / keybindings / telemetry` 不写进正式契约，内建与插件会再次走双轨。

一句话总结：

> PMP Host Capability Pack 的职责不是把现有 PMP 功能罗列一遍，而是把所有“只属于 PMP、但又必须被插件稳定依赖”的能力压缩成可版本化、可协商、可替换的 host family；凡是做不到这一点的能力，都还不算真正的平台契约。
