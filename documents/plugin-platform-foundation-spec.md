# PXP 插件平台基座规范

状态：working draft

## 1. 文档定位

本文档是插件平台化的主规范。

它回答 4 个问题：

- 什么必须属于 `core`，什么必须留在 `host`
- 什么能力必须先契约化，再允许宿主或内建模块实现
- 当前 PMP 代码树里哪些部分已经提供了真实语义原型
- 方案已经闭合到什么程度，仍然缺哪些实现层闭环

已落盘子规范：

1. [PXP Manifest v2 规范](./plugin-platform-manifest-v2-spec.md)
2. [PXP Capability / Session / Stream / Resource 协议](./plugin-platform-capability-protocol-spec.md)
3. [PXP Runtime Bridge 规范](./plugin-platform-runtime-bridge-spec.md)
4. [PMP Host Capability Pack 规范](./plugin-platform-pmp-host-capability-pack-spec.md)

## 2. 当前结论

当前代码已经足以支撑以下判断：

- `PMPM` 只能视为兼容层，不是未来平台本体
- 当前 `packages/plugin-platform-contracts` 只是第一阶段共享词汇表，不是最终契约包
- 未来平台必须从一开始就支持 `extension-host / webview / sidecar`
- 只有 `request / result` 的 JSON RPC 无法承载复杂插件，必须原生支持 `session / stream / resource / cancel / dispose`
- `page / window / settings-panel / visualizer / magnet` 都是宿主映射概念，不是最终 core 概念
- `i18n / keybindings / telemetry` 不是实现细节，必须在平台契约里有明确位置

关键代码事实来源：

- 共享 contracts 仍然宿主化：
  - `packages/plugin-platform-contracts/src/contributions.ts`
  - `packages/plugin-platform-contracts/src/manifest.ts`
  - `packages/plugin-platform-contracts/src/capabilities.ts`
  - `packages/plugin-platform-contracts/src/runtime.ts`
- PMP 当前插件形态仍是宿主形状：
  - `apps/desktop/src/magnet-system/plugins/pmpm.ts`
  - `apps/desktop/src/magnet-system/plugins/pmpmRuntime.ts`
  - `apps/desktop/src/magnet-system/plugins/PmpmSandboxHost.tsx`
  - `apps/desktop/src/magnet-system/plugins/pmpmSandboxCommandRunner.ts`
- 复杂能力语义已经在代码中出现：
  - `apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`
  - `apps/desktop/src/magnet-system/plugins/host-api/audioInputAdapterSidecar.ts`
  - `apps/desktop/src-tauri/src/audio/decoder_sidecar.rs`
- 核心模块仍是单宿主实现：
  - `apps/desktop/src/kernel/EventBus.ts`
  - `apps/desktop/src/kernel/ModuleLoader.ts`
  - `apps/desktop/src/modules/storage/index.ts`
  - `apps/desktop/src/magnet-system/plugins/pluginConfig.ts`

## 3. 目标与非目标

### 3.1 目标

- 插件成为一等公民，而不是 PMP 内部脚本扩展
- 内建模块与第三方插件同权同构
- 插件按需声明、按需协商能力，而不是拿到整个宿主 API 对象
- 插件可以在 `PMP` 与未来的 `MusicTag` 之间移植
- 插件可以承载复杂场景，包括：
  - 音频分析器
  - 连接器
  - 长期会话
  - 多语言 sidecar
  - 二进制数据面
- 平台允许高能力插件，但能力必须经过 `runtime / trust / capability` 三层约束

### 3.2 非目标

- 不是把现有 `PMPM` 无限扩张成未来平台
- 不是默认给所有插件无限权限
- 不是把 PMP 专有 UI 名词永久固化进 `core`
- 不是继续容忍“官方模块走私有 service，插件走阉割 API”的双轨制度

## 4. 硬约束

以下条目不是建议，而是平台成立前提：

1. `core` 不得包含宿主专有 UI 名词。
2. 插件只能依赖 `core.*`、`runtime.*`、`host.<hostId>.*`，不得直接依赖宿主内部类型和存储 key。
3. 宿主能力必须通过 capability pack 暴露，不能把宿主内部 service 直接当插件 API。
4. 能力注入必须是协商式的，不能把巨大 API 对象整体塞给插件。
5. 协议必须原生支持 `invoke / stream / session / resource / cancel / dispose`。
6. 业务能力与 UI 投放能力必须解耦。
7. `extension-host / webview / sidecar` 的 lifecycle、health、crash、quarantine 语义必须统一。
8. 内建模块若希望未来可插件化，必须先定义契约，再落地宿主实现。
9. `config / storage / auth / locale / telemetry / shell` 都必须成为正式契约。
10. 生命周期不仅管理插件，还必须管理 `view / request / stream / session / resource handle / runtime` 及其清理顺序。

## 5. 统一分层

平台拆成 4 层：

### 5.1 `core`

宿主无关的最小共享层，只定义抽象契约。

必须包含：

- manifest
- lifecycle
- capabilities
- resources
- views
- commands
- keybindings
- config
- locale
- telemetry

不得包含：

- magnet
- PMP 页面名
- MusicTag 领域对象
- Tauri 事件名
- `localStorage` key
- tray / SMTC / taskbar 这类宿主壳能力

### 5.2 `runtime`

插件实际运行的桥接层与监督层。

必须包含：

- activation handshake
- capability injection
- capability revoke
- crash supervision
- health / heartbeat
- restart / quarantine
- cleanup / dispose

运行时子层：

- `runtime.extension-host`
- `runtime.webview`
- `runtime.sidecar`

### 5.3 `host`

把抽象能力映射为宿主具体能力。

PMP 侧至少需要：

- `host.pmp.navigation`
- `host.pmp.shell`
- `host.pmp.magnets`
- `host.pmp.audio-engine`
- `host.pmp.music-platform`
- `host.pmp.connector-auth`
- `host.pmp.theme-bindings`
- `host.pmp.library-fields`
- `host.pmp.storage`

跨切面宿主适配器还必须承接：

- host locale adapter
- `host.pmp.keybinding-context`
- host telemetry sink

未来 `MusicTag` 侧按同一原则建立 `host.musictag.*`。

### 5.4 `compat`

兼容旧系统的降级层。

当前至少需要：

- `compat.pmpm`

职责：

- 旧 manifest 映射
- 旧 runtime bridge 适配
- 旧 host API 降级代理

## 6. Core 契约族

### 6.1 `core.manifest`

Manifest v2 至少必须定义：

- `id`
- `publisher`
- `version`
- `kind`
- `runtimes[]`
- `activationEvents[]`
- `requiresCapabilities[]`
- `optionalCapabilities[]`
- `providesCapabilities[]`
- `hostTargets[]`
- `dependencies`
- `resourceBundles`
- `signature`
- `trustHints`

Manifest 不能退回为：

- 单 `entryPoint`
- 单宿主贡献列表
- 单 `permissions[]`

### 6.2 `core.capabilities`

协议必须支持 4 类原语：

- unary invoke
- stream
- session
- resource handle

核心标识至少必须存在：

- `capabilityId`
- `version`
- `requestId`
- `sessionId`
- `streamId`
- `handleId`
- `cancel`
- `dispose`
- `error code`

### 6.3 `core.resources`

资源契约必须覆盖：

- file handle
- blob handle
- shared memory reference
- pipe / local socket reference
- lease
- revoke / dispose
- cleanup order

durability scope 至少包含：

- `config`
- `data`
- `cache`
- `temp`

### 6.4 `core.views`

Core 只定义抽象视图图元：

- `view id`
- `view type`
- `surface slot`
- `mount`
- `update`
- `unmount`

Core 不得直接定义这些最终形态：

- `page`
- `window`
- `settings-panel`
- `visualizer`
- `magnet`

它们全部属于 host mapping。

### 6.5 `core.commands`

负责：

- command schema
- invocation semantics
- menu integration

### 6.6 `core.keybindings`

负责：

- rule schema
- chord model
- when-clause subset
- override semantics
- conflict semantics

说明：

- 当前 PMP 已经有完整的 chord、when 子集、用户覆盖、上下文状态机原型
- 但 `app.windowType`、`audio.hasQueue` 这类上下文键仍然是宿主上下文，不属于 `core`
- 因此最终需要 `core.keybindings` + `host.<hostId>.keybinding-context`

### 6.7 `core.config`

至少必须包含：

- config schema
- defaults
- migration
- persistence scope
- sync scope
- session-state 区分

不能继续把“每插件一个 `localStorage` key + 任意 JSON”当最终模型。

### 6.8 `core.locale`

至少必须包含：

- active locale query
- locale change subscription
- message bundle registration
- fallback locale
- contribution title / label 的本地化表达

说明：

- 当前 PMP 已经有 `getLocale / setLocale / subscribeLocale / translate` 原型
- 但 locale 资源仍然主要是宿主内置 JSON，插件尚未进入统一 locale 契约

### 6.9 `core.telemetry`

至少必须包含：

- logger identity
- runtime identity
- plugin identity
- host identity
- trust level
- span / event / metric 语义
- redaction / persistence policy 边界

说明：

- 当前前后端都已经存在成熟 telemetry 原型
- 但它仍然首先是 PMP 自身 debug / diagnostics 能力，不是插件平台标准契约

### 6.10 `core.lifecycle`

至少要覆盖：

- install
- resolve
- activate
- suspend
- disable
- crash
- quarantine
- terminate

并定义 ownership：

- runtime / process
- session
- resource handle
- view
- host shutdown cleanup

## 7. Runtime 契约族

### 7.1 `runtime.extension-host`

必须定义：

- activation handshake
- capability injection
- health reporting
- dispose

### 7.2 `runtime.webview`

必须定义：

- sandbox bridge
- message channel
- mount contract
- capability whitelist
- host chrome isolation

### 7.3 `runtime.sidecar`

必须定义：

- process model
- startup handshake
- protocol version negotiation
- health / heartbeat
- restart policy
- shutdown / cleanup
- stream / backpressure
- data plane

默认建议：

- 控制面：`stdio` framed RPC
- 数据面：`shared-memory`、`pipe`、`local-socket`

`WebSocket` 与 `gRPC` 可以作为 adapter，但不应成为唯一核心协议。

## 8. Host 契约族

### 8.1 `host.pmp.navigation`

负责把抽象 `view` 映射到 PMP 路由和页面导航。

### 8.2 `host.pmp.shell`

负责宿主壳能力：

- menu
- context menu
- tray
- status item
- toolbar item
- window visibility / placement

### 8.3 `host.pmp.magnets`

`magnet` 永远是 PMP 宿主专有概念，不进入 core。

### 8.4 `host.pmp.audio-engine`

负责音频引擎、设备、DSP、tap、分析数据输出等能力。

### 8.5 `host.pmp.music-platform`

负责平台连接器、资源浏览、搜索、播放准备等音乐平台能力。

### 8.6 `host.pmp.connector-auth`

必须从泛化的 `music-platform facade` 中独立出来，至少拆出：

- auth state
- QR login session
- refresh / revoke
- credential reference
- account binding

### 8.7 `host.pmp.theme-bindings`

负责把 core theme token / surface 抽象映射到 PMP 的 binding / surface 体系。

### 8.8 `host.pmp.library-fields`

负责音乐库字段、facet、sort / filter metadata 映射。

### 8.9 `host.pmp.storage`

负责宿主持久化实现、跨窗口同步实现与资源目录实现，但不得反向污染 core。

## 9. Contribution 模型

Contribution 分两层：

### 9.1 Core Contribution

- `command`
- `keybinding`
- `view`
- `menu`
- `provider`
- `task`
- `theme`
- `analyzer`
- `connector`
- `filesystem`
- `protocol-handler`
- `background-service`

### 9.2 Host Mapping Contribution

- `page`
- `panel`
- `sidebar-view`
- `status-item`
- `toolbar-item`
- `context-menu`
- `tray-item`
- `window`
- `webview`
- `visualizer`
- `magnet`

结论：

- `page / window / settings-panel / visualizer` 不能继续视为 core 最终抽象
- host 的职责是把 `view / menu / provider` 映射成自己的壳层落点

## 10. 信任与运行时分层

统一平台中，插件至少按信任与运行时分成 5 类：

- `sandboxed-webview`
- `trusted-extension`
- `native-sidecar`
- `official`
- `compat-pmpm`

“无边界”不等于“默认无限权限”。

正确理解是：

- 平台允许存在全能力层级
- 但能力必须经过 `trust / runtime / capability` 三层约束

## 11. 迁移铁律

1. 冻结 PMPM v1 边界。它只能做 compat 层。
2. 先契约，后实现。
3. 先抽 core，再做 runtime，再做 host adapter。
4. 内建与插件必须同权同构。
5. 高频数据与二进制路径必须走 data plane。
6. `config / auth / resource / shell / locale / telemetry` 必须显式契约化。

## 12. 当前契约与目标契约对比

### 12.1 共享 contracts 包

| 维度 | 当前契约 | 目标契约 | 判断 |
| --- | --- | --- | --- |
| `manifest` | 单 `entryPoint`、最小 metadata、`permissions[]` | 多 runtime、能力协商、host target、资源包、签名与信任提示 | 当前仅够 PMPM v1 |
| `contributions` | `page / window / settings-panel / visualizer` 直接进共享层 | `view / provider / menu / command / keybinding` 进 core，宿主落点下沉 host | 当前明显宿主泄露 |
| `capabilities` | 只有 unary `request / result` | `invoke / stream / session / resource / cancel / dispose` | 当前不足以支撑复杂插件 |
| `runtime` | 只有词汇，没有桥接与监督协议 | runtime bridge、health、crash、restart、cleanup | 当前只是占位 |

### 12.2 PMP 已有但尚未平台化的契约原型

| 维度 | 当前代码原型 | 未来归属 | 判断 |
| --- | --- | --- | --- |
| i18n | `apps/desktop/src/i18n/*` | `core.locale` + host locale adapter | 当前只服务宿主 UI |
| 快捷键 | `apps/desktop/src/services/keybindings/*` | `core.keybindings` + `host.pmp.keybinding-context` | 当前已接近平台原型 |
| telemetry | `apps/desktop/src/services/telemetry/*` 与 Rust telemetry | `core.telemetry` + host sink | 当前能力强，但还不是插件契约 |
| 插件配置 | `pluginConfig.ts` | `core.config` + `host.pmp.storage` | 当前仍是 key-value 降级方案 |
| sidecar | `audioInputAdapterSidecar.ts` + `decoder_sidecar.rs` | `runtime.sidecar` + capability protocol | 当前已有强语义原型 |

### 12.3 仍然缺失的落地闭环

- 四份子规范已经闭合，但 shared contracts 还没有拆成真正的 `core / runtime / host / compat` 包拓扑
- 现有 PMPM sandbox 协议仍然是宿主定制 RPC，只是可以映射到未来 runtime bridge，还没有完成协议替换
- 现有 host capability 原型仍然散落在 PMP 模块中，还没有被收敛成真正的 `host.pmp.*` contracts 包
- 内建模块对私有 service 的依赖仍未完全收口，因此“内建与插件同权同构”目前还只是规范成立，不是实现成立

## 13. 包拓扑建议

最终建议拆成：

- `packages/plugin-core-contracts`
- `packages/plugin-runtime-contracts`
- `packages/plugin-view-contracts`
- `packages/plugin-sidecar-protocol`
- `packages/plugin-platform-sdk`
- `packages/plugin-platform-runtime`
- `packages/plugin-platform-webview`
- `packages/plugin-host-pmp-contracts`
- `packages/plugin-host-musictag-contracts`
- `packages/plugin-compat-pmpm`

当前 `packages/plugin-platform-contracts` 只应视为第一阶段共享词汇表，不应被误认为最终契约包。

## 14. 当前审计结论

现阶段方案不是“不能做”，而是“规范闭环已经形成，但实现层还没有完成按层落地”。

严格评估如下：

- 方向已经正确，继续沿 `PMPM` 扩张是错误方向
- 基座分层已经足够清晰，`core / runtime / host / compat` 是合理骨架
- 方案最危险的失效边界，原本就在 `manifest`、`capability protocol`、`runtime bridge`、`host pack`
- 这四个边界现在都已经有正式子规范
- 下一阶段真正的风险不再是“有没有规范”，而是“实现时是否重新偷渡宿主私有耦合”

一句话总结：

> PMPM 只是兼容层；PXP 才是未来平台；而平台能否成立，取决于四份子规范能否在实现阶段继续守住边界，而不是重新滑回宿主私有总线。
