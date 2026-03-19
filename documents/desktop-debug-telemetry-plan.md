# PMP Desktop Debug / Telemetry Architecture Plan

## 1. 背景

PMP 当前已经具备一批可用的 debug / perf 能力，但它们仍然是分散的：

- 前端存在 `DebugCenter`、`PerfMonitorPage`、`NativeDebugPage` 三个主要入口。
- TS 侧存在 `modules/debug/debugConfig.ts`、`modules/debug/processPerf.ts` 这样的 facade，但范围有限。
- Rust 侧存在 `debug_get_*`、`perf_monitor`、音频诊断快照、VST audit 等能力，但没有统一的 telemetry contract。
- 项目外还有一批通过 `package.json` 暴露的脚本，如 `perf:snapshot:*`、`audio:score:gate:*`，这些脚本很有价值，但目前更像“独立工具”，不是统一可扩展 debug 架构的一部分。

随着后续继续做内存、切歌、queue、cover、playlist、native audio 的排查，现状会越来越吃力：

- 入口不统一，很多信息只能在特定页面或特定脚本里看。
- 日志结构不统一，很多信息仍停留在 `console.warn/error/log`。
- TS 与 Rust 之间缺少统一 correlation id，跨边界链路难以串起来。
- 模块虽然已经是微内核 / 模块化架构，但日志、指标、快照、导出并没有复用这套模块边界。
- 缺少清晰的契约层，导致“功能能加上去”，但扩展性、可观测性和长期维护性不足。

这个文档的目标不是再加一个 logger，而是在当前 debug 系统基础上，把 PMP 的 debug / logging / performance monitoring 升级为一套统一、可扩展、可拔插、可控制开销的 telemetry 架构。

## 2. 现状审阅

### 2.1 已有能力

当前已有的基础并不差，很多关键底座已经存在：

- 前端 kernel 已有模块作用域：
  - `EventBus.withSource(module.id)` 已能天然附带模块来源。
  - `ModuleLoader` 已在模块激活时做 scoped services / events 注入。
- 前端 debug facade 已存在：
  - `apps/desktop/src/modules/debug/debugConfig.ts`
  - `apps/desktop/src/modules/debug/processPerf.ts`
- 前端 debug UI 已存在：
  - `apps/desktop/src/components/debug/DebugCenter.tsx`
  - `apps/desktop/src/components/pages/PerfMonitorPage.tsx`
  - `apps/desktop/src/components/pages/NativeDebugPage.tsx`
- Rust 侧已有 debug command 和性能采样：
  - `apps/desktop/src-tauri/src/commands/debug.rs`
  - `apps/desktop/src-tauri/src/perf_monitor.rs`
- Rust 侧已有局部 audit / diagnostics：
  - `audio/diagnostics.rs`
  - `audio/control_plane.rs`
  - `audio/retire_plane.rs`
  - `vst_audit.rs`
- 调试配置已有稳定入口：
  - `apps/desktop/src-tauri/src/debug_config.rs`

### 2.2 当前问题

现状最主要的问题不是“没有 debug”，而是“没有统一 telemetry plane”。

1. 页面入口分散

- `DebugCenter` 更偏总览和配置。
- `PerfMonitorPage` 更偏进程采样。
- `NativeDebugPage` 更偏音频引擎细节。
- 脚本又是另一条平行路径。

结果是：一个问题常常要同时切换多个页面和多个脚本，入口不统一。

2. 日志调用散落

- 项目里大量直接使用 `console.warn/error/log`。
- 这些日志没有统一 schema，也没有统一 retention、query、export。
- 既不利于排障，也不利于做模块级治理。

3. 缺少 TS / Rust 统一链路标识

- `MusicLibrary -> invoke -> native db -> cover resolve -> queue update -> audio switch` 这种链路没有统一 trace id。
- 出问题时只能靠时间猜，不能靠链路串起来。

4. debug config 范围过窄

- 当前 `DebugConfig` 主要围绕 VST bridge。
- 对日志等级、模块开关、采样率、持久化策略、导出策略几乎没有统一建模。

5. 脚本和运行时系统脱节

- `perf:snapshot:*`、`audio:score:gate:*` 目前是有价值的专项工具，但不应成为“某类日志/排障的唯一入口”。
- 更合理的定位应该是：脚本是 runtime telemetry 的消费者，而不是另一套平行系统。

6. 可扩展契约缺失

- 当前没有“模块如何注册自己的 telemetry enrichers / anomaly detectors / export sections / debug panels”的统一贡献点。
- 这使得可拔插扩展只能靠散改。

## 3. 目标

## 3.1 总目标

建立一套统一的 desktop telemetry architecture，使 PMP 的 debug、日志、性能监控、异常快照、导出能力能够围绕“模块边界”稳定演进。

## 3.2 具体目标

1. 统一入口

- 用户视角：一个主入口即可进入 telemetry / debug 系统。
- 开发视角：一个统一 contract 和一个统一 service 负责日志、指标、span、snapshot。

2. 模块化

- 每个 kernel module / backend module 都能天然拥有自己的 scoped telemetry。
- 新模块接入不需要复制粘贴一套 debug 方案。

3. 契约明确

- 定义统一的 record schema、query schema、policy schema、export schema。
- 明确日志、指标、span、snapshot 的职责边界。

4. 可拔插可扩展

- 新模块可以注册 enrichers、export contributor、anomaly rule、panel contribution。
- 前端插件和未来扩展功能都能接入统一 contract。

5. 低开销

- 默认态开销低。
- 高频路径尤其是音频实时线程不得因为日志系统产生额外抖动。

6. 可追踪

- 关键跨边界操作拥有统一 correlation id / trace id。
- 出现 bug、error、内存上涨、切歌异常时能回溯完整链路。

## 3.3 非目标

以下内容不是第一阶段目标：

- 不是要把所有现有 debug 页面删掉重写。
- 不是要把所有专项脚本移除。
- 不是要做云端日志上传。
- 不是要在实时音频线程里直接打详细文本日志。
- 不是要让 IndexedDB 承担长期日志存储。

## 4. 设计原则

1. Rust authoritative

- 持久化、轮转、导出、查询后端都由 Rust 负责。
- TS 只保留短期 UI tail 和上下文语义，不承担长期日志所有权。

2. Structured first

- 所有 runtime telemetry 都必须结构化。
- 自由文本 message 只是补充字段，不是主索引。

3. Module scoped

- 日志、指标、快照必须带 `moduleId`。
- 前端模块复用 kernel module id，Rust 模块复用 backend module descriptor id。

4. Logs / metrics / spans / snapshots 分层

- `log`：离散事件和错误
- `metric`：数值观测
- `span`：操作耗时与链路区间
- `snapshot`：异常发生时的状态快照

5. Realtime safe

- 音频 callback、render thread 只允许 lock-free counter、aggregated metric、轻量 ring telemetry。
- 严禁在实时线程做字符串格式化、JSON 编码、磁盘写入。

6. Scripts are clients

- `pnpm` 脚本和外部 perf 工具应建立在 telemetry query/export 之上。
- 它们是客户端，不是另一套事实来源。

## 5. 总体架构

建议将系统拆为 5 层。

### 5.1 Telemetry Contract Layer

定义统一契约：

- `TelemetryRecord`
- `TelemetryMetricRecord`
- `TelemetrySpanStart/End`
- `TelemetrySnapshotRecord`
- `TelemetryPolicy`
- `TelemetryQuery`
- `TelemetryExportBundle`

建议新增：

- `apps/desktop/src/contracts/telemetry.ts`
- `apps/desktop/src-tauri/src/telemetry_contract.rs`

这层只定义模型和语义，不放业务逻辑。

### 5.2 Frontend Telemetry Module

前端新增统一 telemetry service，纳入 kernel module：

- 负责 scoped logger
- 负责 console bridge
- 负责 invoke wrapper
- 负责前端内存 ring buffer
- 负责将 batch 发送到 Rust

建议新增：

- `apps/desktop/src/services/telemetry/TelemetryService.ts`
- `apps/desktop/src/services/telemetry/telemetryModule.ts`
- `apps/desktop/src/services/telemetry/consoleBridge.ts`
- `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`

### 5.3 Rust Telemetry Core

Rust 侧新增统一 telemetry core：

- 接收 TS 侧批量日志
- 接收 Rust 自身结构化日志
- 管理文件写入、轮转、保留、导出
- 提供 query / export / status / clear / policy 命令

建议新增：

- `apps/desktop/src-tauri/src/telemetry.rs`
- `apps/desktop/src-tauri/src/telemetry_store.rs`
- `apps/desktop/src-tauri/src/telemetry_export.rs`
- `apps/desktop/src-tauri/src/telemetry_policy.rs`

### 5.4 Observability UI Layer

当前 `DebugCenter` 保留，但需要升级为统一入口：

- `DebugCenter` 继续负责总览、配置、导出入口。
- 新增独立 `ObservabilityPage`，专门承载日志 tail、过滤、查询、timeline、export bundle。
- `PerfMonitorPage` 与 `NativeDebugPage` 保留为专项视图，但都应挂到统一 telemetry 体系。

建议新增：

- `apps/desktop/src/components/pages/ObservabilityPage.tsx`
- `apps/desktop/src/modules/debug/telemetry.ts`

### 5.5 Script / CLI Client Layer

现有脚本继续保留，但职责调整：

- `perf:snapshot:*` 读取统一 telemetry 数据并导出比较。
- `audio:score:gate:*` 依赖统一日志和指标，而不是额外拼接散点信息。
- 新增的排障脚本统一走 export/query 命令。

## 6. 统一入口方案

## 6.1 用户入口

入口统一为 `DebugCenter -> Observability`。

建议布局：

- `Overview`
- `Logs`
- `Performance`
- `Audio Diagnostics`
- `Memory`
- `Policies`
- `Export`

其中：

- `PerfMonitorPage` 变成 `Performance` 子页或子面板。
- `NativeDebugPage` 变成 `Audio Diagnostics` 子页或子面板。
- `DebugCenter` 不再只是“杂项控制台”，而是 telemetry 总入口。

## 6.2 开发入口

前端统一入口：

```ts
const telemetry = services.get(TELEMETRY_SERVICE);
const logger = telemetry.getLogger('music-library');
logger.info('query.page.loaded', { count, queryId });
```

或在 kernel module 激活时自动注入 scoped telemetry：

```ts
activate(ctx) {
  const log = ctx.telemetry.logger;
  log.info('module.started');
}
```

Rust 统一入口：

```rust
telemetry::info("audio-engine", "track.switch.started", fields);
telemetry::warn("library", "cover.probe_failed", fields);
telemetry::metric("performance", "webview2_private_bytes", value, tags);
```

专项脚本入口：

- 调用 `debug_telemetry_query`
- 调用 `debug_telemetry_export_bundle`
- 调用 `debug_telemetry_get_status`

而不是直接依赖 scattered console output。

## 7. 统一契约

## 7.1 核心记录模型

建议统一记录结构：

```json
{
  "ts": 1773812305123,
  "level": "warn",
  "kind": "log",
  "side": "frontend",
  "moduleId": "music-library",
  "component": "MusicLibraryService",
  "event": "cover.probe_failed",
  "message": "failed to probe format for cover",
  "sessionId": "boot-20260318-2201",
  "traceId": "trace-6b3f",
  "spanId": null,
  "windowId": "main",
  "fields": {
    "trackId": "t_123",
    "coverKey": "abc",
    "errorCode": "end_of_stream"
  }
}
```

## 7.2 字段约束

强制字段：

- `ts`
- `level`
- `kind`
- `moduleId`
- `event`
- `side`
- `sessionId`

推荐字段：

- `component`
- `traceId`
- `spanId`
- `windowId`
- `fields`

禁止字段：

- 原始 PCM / 大二进制 payload
- 完整文件内容
- 未脱敏的大文本用户数据

## 7.3 级别

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`

## 7.4 kind

- `log`
- `metric`
- `span-start`
- `span-end`
- `snapshot`
- `audit`

## 8. 模块边界与作用域

## 8.1 前端 moduleId

前端建议直接沿用 kernel module id：

- `lifecycle`
- `quality`
- `performance-control`
- `navigation`
- `audio`
- `memory-governance`
- `commands`
- `media-session`
- `keybindings`
- `magnets`
- `plugins`

页面 / service / component 通过 `component` 字段进一步细分。

## 8.2 Rust moduleId

Rust 直接沿用 backend module descriptor：

- `audio-engine`
- `dsp`
- `library`
- `performance`
- `windowing`
- `network`
- `vst`
- `editor`

## 8.3 可拔插扩展点

建议增加 4 类贡献点。

1. `TelemetryContextEnricherContribution`

- 给所有记录自动补充字段。
- 如 `windowId`、当前 page、当前 queue size、build info。

2. `TelemetryExportContributor`

- 在 bug bundle 导出时附加自己的 section。
- 如 `audio robustness snapshot`、`playlist residency snapshot`、`cover cache stats`。

3. `TelemetryAnomalyRuleContribution`

- 各模块注册自己的异常检测逻辑。
- 如 `retirePendingTasks sustained high`、`cover probe failed burst`。

4. `TelemetryPanelContribution`

- 各模块向 Observability UI 注册自己的专用 panel。

这样新模块可以按贡献点接入，而不是修改中心化巨石页面。

## 9. 配置模型

当前 `DebugConfig` 需要扩展为 `DebugConfig + TelemetryPolicy`，而不是继续只聚焦 VST。

建议结构：

```json
{
  "version": 2,
  "enabled": true,
  "openDebugCenterOnNextStart": false,
  "vstBridge": {},
  "telemetry": {
    "enabled": true,
    "uiTailEnabled": true,
    "frontendMinLevel": "info",
    "backendMinLevel": "info",
    "persistMinLevel": "warn",
    "perfSamplingMs": 1000,
    "batchFlushMs": 250,
    "batchMaxItems": 64,
    "retention": {
      "maxTotalBytes": 157286400,
      "errorDays": 14,
      "infoDays": 3,
      "debugCurrentSessionOnly": true
    },
    "modules": {
      "music-library": { "level": "debug", "persist": true, "perf": true },
      "audio-engine": { "level": "info", "persist": true, "perf": true, "realtimeVerbose": false }
    }
  }
}
```

## 10. 日志、指标、快照的分工

## 10.1 日志

适合记录：

- 错误
- 关键状态变化
- 生命周期事件
- fallback 决策
- 资源释放与失败

不适合记录：

- 高频 buffer tick
- 每帧渲染
- 每个 sample callback

## 10.2 指标

适合记录：

- `webview2PrivateBytes`
- `treePrivateBytes`
- `queueApproxJsonBytes`
- `retirePendingTasks`
- `coverBlobUrlCacheEntries`
- `coverDecodedEstimateTotalBytes`
- `bufferedAhead`

这类值更适合以 metric 或周期采样形式进入 telemetry。

## 10.3 span

必须补齐的关键链路：

- `library.query.page`
- `playlist.select`
- `playlist.hydrate`
- `cover.resolve`
- `tauri.invoke`
- `track.switch`
- `queue.clear`
- `memory-governance.run`

span 结束时自动附带耗时、结果、关键 counters。

## 10.4 snapshot

异常触发时自动打 snapshot：

- 切歌前后缓冲快照
- recent playlist residency 快照
- music-library runtime snapshot
- process perf totals snapshot
- audio robustness snapshot

## 11. 高性能与音频实时线程约束

这是该方案的硬约束。

1. 实时音频线程禁止直接结构化日志调用。
2. 实时线程只允许：
   - 原子计数器
   - lock-free ring telemetry
   - 预分配 snapshot buffer
3. 序列化、字符串拼接、写盘必须在非实时线程完成。
4. `underrun`、`render backlog`、`retire backlog` 采用聚合上报，不逐事件写盘。

否则日志系统会反向破坏音频性能。

## 12. 存储与导出

## 12.1 存储策略

第一阶段建议采用 append-only JSONL，由 Rust 统一写盘。

目录建议：

- `appData/debug/telemetry/current-session.jsonl`
- `appData/debug/telemetry/rotated/*.jsonl`
- `appData/debug/telemetry/exports/*.zip`

理由：

- 简单
- 易导出
- 易轮转
- 不会把日志系统本身做成复杂数据库项目

后续如果 query 复杂度明显上升，再考虑增加索引层，而不是一开始上 SQLite 热写。

## 12.2 导出 bundle

建议支持一键导出 `bug bundle`，包含：

- 最近日志
- 最近 spans
- perf totals snapshots
- memory snapshots
- music library runtime snapshot
- audio robustness snapshot
- debug config
- env snapshot
- registered backend modules
- registered commands
- 可选 VST audit / minidump

## 13. 脚本与专项工具的定位

现有脚本不应被废弃，但要重新定义角色。

### 13.1 保留的脚本

- `audio:score:gate:*`
- `perf:snapshot:*`
- Phase 0 memory suite 及后续专项脚本

### 13.2 新角色

这些脚本应该：

- 调用统一 debug / telemetry query 命令
- 导出统一 bug bundle 或专项报告
- 对统一 telemetry 数据做离线对比

而不是自己成为 runtime 事实来源。

### 13.3 结果

运行时入口统一，脚本变成自动化客户端，既保留能力，又不再割裂入口。

## 14. 推荐实施阶段

## Phase A：契约与核心骨架

目标：

- 建立统一 telemetry contract
- 建立 Rust telemetry sink
- 建立前端 TelemetryService
- 扩展 DebugConfig -> TelemetryPolicy

产物：

- `contracts/telemetry.ts`
- `src-tauri/src/telemetry*.rs`
- `services/telemetry/*`

## Phase B：统一入口与桥接

目标：

- DebugCenter 增加 Observability 主入口
- 增加统一 query / export / status command
- 建立 console bridge 和 invoke wrapper

产物：

- `ObservabilityPage`
- `debug_telemetry_*` commands
- `tauriInvokeTelemetry`

## Phase C：重点模块接入

优先接入模块：

- `music-library`
- `playlists`
- `audio`
- `memory-governance`
- `navigation`

目标：

- 把最影响当前排障的模块先纳入统一 telemetry

## Phase D：异常驱动与导出

目标：

- anomaly rule contribution
- snapshot trigger
- bug bundle export

## Phase E：脚本与专项工具迁移

目标：

- 让 perf / audio score / memory suite 都建立在统一 telemetry query/export 上

## 15. 验收标准

方案落地后，至少要满足：

1. 统一入口

- 运行时只需要进入 `DebugCenter -> Observability` 即可覆盖主要 debug 场景。

2. 统一调用

- 新增模块不得直接散写 `console.*` 作为主日志路径。
- 必须走统一 telemetry service。

3. 链路可追踪

- 一次 `track.switch` 能串起 TS -> invoke -> Rust -> queue/state/snapshot。

4. 模块可控

- 每个模块可以单独调节 level / persist / perf / anomaly rule。

5. 低开销

- 默认 telemetry 开启时，对正常播放和普通页面操作无显著可感知退化。

6. 导出闭环

- 发生 bug 后可在应用内一键导出 bundle，而不是依赖人工东拼西凑。

## 16. 结论

PMP 当前的问题不是缺少 debug，而是缺少一个统一、模块化、契约明确的 telemetry plane。

最合理的方向不是“再加几个页面或脚本”，而是：

- 前端继续负责语义、上下文、页面接入
- Rust 负责 authoritative sink、写盘、轮转、导出、查询
- kernel module 边界成为 telemetry 的一级边界
- debug config 升级为 telemetry policy
- scripts 从平行系统变成 telemetry client

这套方案一旦落地，后续不管是内存异常、cover 问题、queue 驻留、recent playlist 膨胀、切歌双驻留、native audio 退化，都会更容易被快速归因和稳定复现。

下一步建议不是直接全量实现，而是先从 `Phase A` 做起：把 contract、Rust sink、TS TelemetryService 和 DebugConfig 扩展打牢，再按模块逐步迁移。
