# PMP Desktop Debug / Telemetry Execution Plan

## 1. 文档目的

本文件是 [desktop-debug-telemetry-plan.md](/d:/pixel-matrix-player/documents/desktop-debug-telemetry-plan.md) 的执行拆分版。

目标不是重复讲理念，而是把后续实现拆成可以直接开工的阶段、任务、文件清单、测试清单和验收标准。

适用范围：

- `apps/desktop/src` 前端 kernel / services / debug UI
- `apps/desktop/src-tauri/src` Rust debug / telemetry / export / query
- `scripts/` 下基于 telemetry 的专项工具
- `documents/` 下方案、验收、回归文档

## 2. 现有入口盘点

当前已经存在的入口和能力，后续不应推翻重来，而应作为统一体系的基础：

### 前端入口

- `DebugCenter`
  - [DebugCenter.tsx](/d:/pixel-matrix-player/apps/desktop/src/components/debug/DebugCenter.tsx)
- `PerfMonitorPage`
  - [PerfMonitorPage.tsx](/d:/pixel-matrix-player/apps/desktop/src/components/pages/PerfMonitorPage.tsx)
- `NativeDebugPage`
  - [NativeDebugPage.tsx](/d:/pixel-matrix-player/apps/desktop/src/components/pages/NativeDebugPage.tsx)
- debug facade
  - [debugConfig.ts](/d:/pixel-matrix-player/apps/desktop/src/modules/debug/debugConfig.ts)
  - [processPerf.ts](/d:/pixel-matrix-player/apps/desktop/src/modules/debug/processPerf.ts)

### 前端架构底座

- kernel / service token / module loader
  - [createKernel.ts](/d:/pixel-matrix-player/apps/desktop/src/kernel/createKernel.ts)
  - [EventBus.ts](/d:/pixel-matrix-player/apps/desktop/src/kernel/EventBus.ts)
  - [Module.ts](/d:/pixel-matrix-player/apps/desktop/src/kernel/Module.ts)
  - [ModuleLoader.ts](/d:/pixel-matrix-player/apps/desktop/src/kernel/ModuleLoader.ts)
- runtime module activation
  - [KernelContext.tsx](/d:/pixel-matrix-player/apps/desktop/src/contexts/KernelContext.tsx)

### Rust 入口

- debug commands
  - [debug.rs](/d:/pixel-matrix-player/apps/desktop/src-tauri/src/commands/debug.rs)
- perf monitor
  - [perf_monitor.rs](/d:/pixel-matrix-player/apps/desktop/src-tauri/src/perf_monitor.rs)
- debug config
  - [debug_config.rs](/d:/pixel-matrix-player/apps/desktop/src-tauri/src/debug_config.rs)
- backend module catalog
  - [catalog.rs](/d:/pixel-matrix-player/apps/desktop/src-tauri/src/modules/catalog.rs)
  - [descriptor.rs](/d:/pixel-matrix-player/apps/desktop/src-tauri/src/modules/descriptor.rs)

### 脚本入口

- `audio:score:gate:*`
- `perf:snapshot:*`
- `perf:memory:phase0*`

当前问题不是“没有入口”，而是入口太分散、契约层太薄、扩展点不统一。

## 3. 拆分原则

执行时必须遵守以下原则：

1. 不推翻现有 debug 页面，而是统一在其上收敛。
2. 先做 contract 和 core，再做页面和专项接入。
3. Rust 负责 authoritative sink，TS 不承担长期日志存储。
4. 音频实时线程严禁直接接入普通日志写盘链路。
5. 专项脚本后续必须建立在统一 telemetry query/export 之上。

## 4. 工作流拆分

整体拆成 6 条并行度有限的工作流。

### Workstream A: Contract & Policy

定义 telemetry record、query、policy、export contract，并扩展 `DebugConfig`。

### Workstream B: Frontend Telemetry Core

新增 `TelemetryService`、scoped logger、console bridge、invoke wrapper、前端内存 ring buffer。

### Workstream C: Rust Telemetry Core

新增 telemetry sink、批量 ingest、query、export、retention、status 命令。

### Workstream D: Unified UI Entry

保留 DebugCenter，但增加统一 Observability 入口和 logs/timeline/export 页面。

### Workstream E: Module Onboarding

优先接入 `music-library / playlists / audio / memory-governance / navigation`。

### Workstream F: Scripts & Automation

让 perf / audio score / memory suite 逐步依赖统一 telemetry query/export。

## 5. 分阶段执行

## Phase A0: Inventory Freeze

### 目标

冻结现有 debug 能力的边界，避免边做边漂移。

### 任务

- 列出现有 debug commands catalog。
- 列出现有 DebugCenter / PerfMonitor / NativeDebug 已覆盖的指标。
- 列出现有专项脚本输入输出。
- 标记所有高价值但仍在 `console.*` 的日志热点模块。

### 产物

- 本文档
- 补充清单可直接附加到 `documents/desktop-debug-telemetry-plan.md`

### 验收

- 能明确回答“当前哪类问题看哪个入口”
- 能明确回答“哪些日志仍是散落 console”

## Phase A1: Contract Skeleton

### 目标

先把 telemetry contract 固定，避免后续各模块各写一套。

### 新增文件

- `apps/desktop/src/contracts/telemetry.ts`
- `apps/desktop/src-tauri/src/telemetry_contract.rs`

### 修改文件

- `apps/desktop/src/modules/debug/debugConfig.ts`
- `apps/desktop/src-tauri/src/debug_config.rs`
- `apps/desktop/src/modules/debug/index.ts`

### 任务

1. 定义前端 contract

- `TelemetryLevel`
- `TelemetryKind`
- `TelemetryRecord`
- `TelemetryQuery`
- `TelemetryPolicy`
- `TelemetryExportBundleMeta`

2. 定义 Rust 对应模型

- 保证字段命名与 TS 保持 `camelCase`
- 统一 `moduleId / event / sessionId / traceId / fields`

3. 扩展 DebugConfig

- 增加 `telemetry` 段
- 支持：
  - `enabled`
  - `frontendMinLevel`
  - `backendMinLevel`
  - `persistMinLevel`
  - `batchFlushMs`
  - `batchMaxItems`
  - `perfSamplingMs`
  - `modules[moduleId]`

### 测试

- TS：新增 `ensureTelemetryPolicy` 单测
- Rust：新增 `DebugConfig` 序列化/反序列化单测

### 验收

- TS / Rust 可以无歧义共享 telemetry record schema
- `debug_get_config` / `debug_set_config` 能安全兼容旧配置

## Phase A2: Rust Telemetry Core Minimum

### 目标

让 Rust 具备接收和持久化 telemetry 的最小能力。

### 新增文件

- `apps/desktop/src-tauri/src/telemetry.rs`
- `apps/desktop/src-tauri/src/telemetry_store.rs`
- `apps/desktop/src-tauri/src/telemetry_policy.rs`

### 修改文件

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/src/commands/debug.rs`
- `apps/desktop/src-tauri/src/commands/registry.rs`

### 任务

1. 新增 telemetry core state

- `TelemetryCore`
- `TelemetryStore`
- 当前 session metadata
- policy snapshot

2. 新增最小命令

- `debug_telemetry_ingest_batch`
- `debug_telemetry_get_status`
- `debug_telemetry_clear_session`

3. 实现最小 JSONL sink

- 当前 session 文件
- append-only
- 单文件写入锁
- 基本文件大小限制

4. 状态命令至少返回

- enabled
- currentSessionId
- queuedRecords
- flushedRecords
- droppedRecords
- currentFileBytes

### 测试

- Rust：
  - ingest batch 正常写入
  - disabled policy 时拒绝或忽略
  - status 正常返回
  - clear session 正常重置

### 验收

- 前端可以把结构化 batch 发给 Rust
- Rust 可以持久化到 app data/debug/telemetry

## Phase A3: Frontend Telemetry Service Minimum

### 目标

让前端模块有统一 logger，不再以 `console.*` 作为主路径。

### 新增文件

- `apps/desktop/src/services/telemetry/TelemetryService.ts`
- `apps/desktop/src/services/telemetry/telemetryModule.ts`
- `apps/desktop/src/services/telemetry/telemetryTypes.ts`
- `apps/desktop/src/services/telemetry/index.ts`

### 修改文件

- `apps/desktop/src/contexts/KernelContext.tsx`
- `apps/desktop/src/kernel/Module.ts`
- `apps/desktop/src/kernel/ModuleLoader.ts`

### 任务

1. 新增 service token

- `TELEMETRY_SERVICE_TOKEN`

2. 新增 `TelemetryService`

- `getLogger(moduleId)`
- `ingest(record)`
- `ingestMetric(...)`
- `startSpan(...)`
- `flushNow()`
- `getUiTailSnapshot()`

3. 前端内存 ring buffer

- 最近 `2000~5000` 条
- 仅供 UI tail
- 不持久驻留大对象

4. batch flush

- 定时 flush
- 条数阈值 flush
- 页面隐藏前 best-effort flush

5. module scoped 注入

推荐做法：

- 扩展 `ModuleContext`
- 增加 `telemetry` 或 `logger`

如果第一步不想改 `ModuleContext`，则允许模块通过 service token 获取，但最终目标仍应是 scoped 注入。

### 测试

- TS：
  - logger 记录 moduleId 正确
  - batch flush 条件正确
  - ui tail ring buffer 有界
  - disabled policy 时降级到 no-op

### 验收

- 新模块可以不写 `console.*`，只用 telemetry service
- 一个模块的日志天然带 `moduleId`

## Phase A4: Console Bridge + Invoke Wrapper

### 目标

在不一次性改完所有旧代码的前提下，快速把现有 debug 信息收进统一管道。

### 新增文件

- `apps/desktop/src/services/telemetry/consoleBridge.ts`
- `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`

### 修改文件

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/modules/debug/index.ts`
- 视情况新增 `utils/invoke.ts`

### 任务

1. console bridge

- patch `console.warn/error/info/debug`
- 保留原 console 输出
- 同时转发为 structured telemetry
- 标记 `component = console`

2. tauri invoke wrapper

- 统一包裹 `invoke`
- 记录 command、duration、result、error、payload size
- 失败时自动产生日志 + span end

3. 规定后续所有新代码优先使用 wrapper

### 测试

- TS：
  - console bridge 不破坏原 console 行为
  - invoke wrapper 能记录成功/失败/耗时

### 验收

- 不修改大批旧业务代码的前提下，已有日志开始进入统一 telemetry 流

## Phase B1: Observability UI

### 目标

把分散入口收敛成统一入口。

### 新增文件

- `apps/desktop/src/components/pages/ObservabilityPage.tsx`
- `apps/desktop/src/components/pages/ObservabilityPage.css`

### 修改文件

- `apps/desktop/src/components/debug/DebugCenter.tsx`
- `apps/desktop/src/builtin-modules/builtinContributionsModule.tsx`
- `apps/desktop/src/i18n/locales/en-US.json`
- `apps/desktop/src/i18n/locales/zh-CN.json`

### 任务

1. DebugCenter 增加总入口

- Logs
- Timeline
- Export
- Status
- Policies

2. 第一版 Logs 页面支持

- level 过滤
- moduleId 过滤
- text 搜索
- 最近 N 条 tail

3. 第一版 Status 页面支持

- telemetry enabled
- current session id
- queue size
- flushed/dropped count
- 当前文件大小

### 测试

- React 组件单测
- i18n key 完整性检查

### 验收

- 用户不需要切多个分散页才能开始排障

## Phase B2: Query / Export / Timeline

### 目标

让 telemetry 不只是 tail，而能做时间线和导出。

### 新增文件

- `apps/desktop/src-tauri/src/telemetry_export.rs`
- `apps/desktop/src-tauri/src/telemetry_query.rs`
- `apps/desktop/src/modules/debug/telemetry.ts`

### 修改文件

- `apps/desktop/src-tauri/src/commands/debug.rs`
- `apps/desktop/src-tauri/src/commands/registry.rs`
- `apps/desktop/src/components/pages/ObservabilityPage.tsx`

### 任务

1. 新增命令

- `debug_telemetry_query`
- `debug_telemetry_export_bundle`
- `debug_telemetry_get_recent`

2. Query 支持

- 时间范围
- level
- moduleId
- event
- sessionId

3. Export bundle 第一版支持

- recent logs
- perf totals
- env snapshot
- debug config
- registered backend modules
- registered commands

### 测试

- Rust query/export 单测
- TS facade 单测

### 验收

- DebugCenter 可直接导出 bundle

## Phase C1: Module Onboarding First Wave

### 目标

先解决当前最需要排障的模块，而不是平均用力。

### 第一批模块

- `music-library`
- `playlists`
- `audio`
- `memory-governance`
- `navigation`

### 关键接入点

#### music-library

- query page
- base query fallback / native path
- cover resolve
- cover probe failed
- page enter / leave
- runtime snapshot attribution

#### playlists

- selectedPlaylist change
- playlist hydrate / release
- currentPlaylist summary change
- overlay open / close

#### audio

- track switch start / end
- queue clear
- retire pending tasks
- pipeline release
- native invoke failure

#### memory-governance

- tier change
- actions planned / executed
- trim request
- cover release

#### navigation

- page enter / leave
- heavy page hidden
- resource detach trigger

### 测试

- 模块级单测优先
- 对关键 span/record 做 snapshot-style 断言

### 验收

- 你目前最常见的几类问题都能从统一 telemetry 中直接看到链路

## Phase C2: Realtime-safe Audio Telemetry

### 目标

把音频相关高频诊断纳入统一系统，但不破坏 realtime 性能。

### 新增文件

- `apps/desktop/src-tauri/src/audio/telemetry.rs`

### 修改文件

- `audio/diagnostics.rs`
- `audio/control_plane.rs`
- `audio/retire_plane.rs`
- `audio/engine/state_payload_impl.rs`

### 任务

- 把高频指标统一变成聚合 snapshot
- 与 telemetry core 对接时仅由非实时线程上报
- 不允许 callback 线程直接写文本日志

### 验收

- 不引入新增音频抖动
- `track.switch`、`underrun`、`retire backlog` 可统一观测

## Phase D1: Anomaly Rules

### 目标

让系统从“被动看日志”升级到“自动抬高粒度并抓快照”。

### 新增文件

- `apps/desktop/src/services/telemetry/anomalyRules.ts`
- `apps/desktop/src-tauri/src/telemetry_anomaly.rs`

### 第一批规则

- `webview2PrivateBytes` 超阈值
- `retirePendingTasks` 长时间不回落
- `cover.probe_failed` 短时 burst
- `track.switch` 结束后 `bufferedAhead` 恢复异常
- `clear queue / hide page` 后 residual 未回落

### 验收

- 异常触发后自动记录 snapshot 和更高粒度日志

## Phase D2: Extension / Contribution Model

### 目标

让新模块能可拔插接入 telemetry。

### 新增 contract

- `TelemetryContextEnricherContribution`
- `TelemetryExportContributor`
- `TelemetryAnomalyRuleContribution`
- `TelemetryPanelContribution`

### 修改文件

- `apps/desktop/src/kernel/ContributionRegistry.ts`
- telemetry 相关模块和 types

### 验收

- 新模块接入 telemetry 时不需要改中心巨石文件

## Phase E1: Script Migration

### 目标

让专项脚本成为 telemetry client。

### 优先迁移脚本

- `perf:snapshot:*`
- `perf:memory:phase0*`
- `audio:score:gate:*`

### 任务

- 优先通过 `debug_telemetry_query` 和 `debug_telemetry_export_bundle` 取数
- 减少脚本对 scattered state 的重复拼装

### 验收

- 脚本和运行时 telemetry 数据不再是两套平行事实来源

## 6. 文件级建议清单

## 前端新增

- `apps/desktop/src/contracts/telemetry.ts`
- `apps/desktop/src/services/telemetry/TelemetryService.ts`
- `apps/desktop/src/services/telemetry/telemetryModule.ts`
- `apps/desktop/src/services/telemetry/telemetryTypes.ts`
- `apps/desktop/src/services/telemetry/consoleBridge.ts`
- `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`
- `apps/desktop/src/components/pages/ObservabilityPage.tsx`
- `apps/desktop/src/components/pages/ObservabilityPage.css`
- `apps/desktop/src/modules/debug/telemetry.ts`

## 前端修改

- `apps/desktop/src/kernel/Module.ts`
- `apps/desktop/src/kernel/ModuleLoader.ts`
- `apps/desktop/src/contexts/KernelContext.tsx`
- `apps/desktop/src/modules/debug/debugConfig.ts`
- `apps/desktop/src/modules/debug/index.ts`
- `apps/desktop/src/components/debug/DebugCenter.tsx`
- `apps/desktop/src/builtin-modules/builtinContributionsModule.tsx`
- `apps/desktop/src/i18n/locales/en-US.json`
- `apps/desktop/src/i18n/locales/zh-CN.json`

## Rust 新增

- `apps/desktop/src-tauri/src/telemetry_contract.rs`
- `apps/desktop/src-tauri/src/telemetry.rs`
- `apps/desktop/src-tauri/src/telemetry_store.rs`
- `apps/desktop/src-tauri/src/telemetry_policy.rs`
- `apps/desktop/src-tauri/src/telemetry_query.rs`
- `apps/desktop/src-tauri/src/telemetry_export.rs`
- `apps/desktop/src-tauri/src/telemetry_anomaly.rs`
- `apps/desktop/src-tauri/src/audio/telemetry.rs`

## Rust 修改

- `apps/desktop/src-tauri/src/main.rs`
- `apps/desktop/src-tauri/src/debug_config.rs`
- `apps/desktop/src-tauri/src/commands/debug.rs`
- `apps/desktop/src-tauri/src/commands/registry.rs`
- `apps/desktop/src-tauri/src/audio/diagnostics.rs`
- `apps/desktop/src-tauri/src/audio/control_plane.rs`
- `apps/desktop/src-tauri/src/audio/retire_plane.rs`
- `apps/desktop/src-tauri/src/audio/engine/state_payload_impl.rs`

## 7. 测试拆分

## 前端测试

- `TelemetryService.spec.ts`
- `consoleBridge.spec.ts`
- `tauriInvokeTelemetry.spec.ts`
- `ObservabilityPage.spec.tsx`
- `debugConfig.telemetry.spec.ts`

## Rust 测试

- telemetry config serde
- ingest batch
- query filters
- export bundle
- retention / rotation
- anomaly trigger

## 集成验证

至少覆盖以下场景：

1. 启动 idle
2. 打开音乐库卡片页
3. recent playlist 208 首
4. 连续切歌 20 次
5. 清空队列 / 隐藏页面
6. 导出 bug bundle

## 8. 优先级排序

建议实际执行顺序：

1. `Phase A1`
2. `Phase A2`
3. `Phase A3`
4. `Phase A4`
5. `Phase B1`
6. `Phase C1`
7. `Phase B2`
8. `Phase C2`
9. `Phase D1`
10. `Phase D2`
11. `Phase E1`

原因：

- 先固定 contract 和 sink，再迁移调用点
- 先打通写入和状态，再做复杂 UI
- 先接最关键模块，再做扩展模型
- 脚本迁移放后面，避免前期重复返工

## 9. 第一轮建议直接开工的范围

如果要现在立即进入实现，建议第一轮只做以下最小闭环：

### Round 1

- `Phase A1`
- `Phase A2`
- `Phase A3`

### Round 1 验收结果

做到以下几点即可算闭环：

- TS / Rust 共用统一 telemetry contract
- 前端存在统一 `TelemetryService`
- Rust 存在统一 ingest/status/clear 命令
- DebugConfig 已能控制 telemetry 总开关和基础等级
- 新代码已可不依赖 `console.*`

这轮不要急着同时做：

- 完整 UI
- anomaly rules
- 所有模块迁移
- script migration

这些留给后续阶段，节奏更稳。

## 10. 结论

后续执行不应再以“补几个日志点”的方式推进，而应按以下节奏实施：

- 先收敛 contract
- 再建立统一 core
- 再统一入口
- 再接重点模块
- 最后让脚本和专项工具都建立在统一 telemetry 上

这样做，PMP 的 debug / logging / performance monitoring 才能真正成为一个可拔插、可扩展、可控开销的系统，而不是继续散落在页面、脚本和 console 之间。
