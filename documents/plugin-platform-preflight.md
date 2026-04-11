# Plugin Platform Preflight

更新时间：2026-04-09  
原则：**源码与类型定义优先**。本文件只负责正式扩面开发 plugin 系统前的前置完善工作，不替代架构文档与 phase 文档。

配套文档：

- `documents/plugin-platform.md`：架构设计、稳定边界、长期演进方向
- `documents/plugin-platform-phases.md`：阶段推进、退出信号与验收基线
- `TELEMETRY.md`：当前桌面端 telemetry / debug logging 权威说明

---

## 0) 文档定位

### 0.1 这份 preflight 文档只做什么

这份文档只承担这些职责：

- 说明为什么在继续扩面 plugin 系统前，必须先补一层日志与性能前置基座
- 收口“正式进入 plugin 主线开发前”的最小前置门槛
- 明确日志基座、性能基座、共享观测契约三条前置工作流
- 给出进入正式 plugin 主线前的退出信号、交付物与非目标

### 0.2 这份文档不做什么

这份文档**不**承担这些职责：

- 不重复 `documents/plugin-platform.md` 里的目标架构与长期研究路线
- 不替代 `documents/plugin-platform-phases.md` 的阶段排序与验收矩阵
- 不把当前任务扩展成完整 profiler / tracer / GPU / scene protocol 方案
- 不要求先把桌面端全部旧模块统一改造完再继续插件开发

### 0.3 为什么现在要有这份文档

当前仓库已经具备插件平台主线的骨架：

- `manifest-v2 + resolver + worker command + host-frame view` 已经成线
- `sidecar bridge` 已接线，但仍待上线级治理
- `activation/lifecycle`、`Minimal Tracer`、`shell surface` 还在继续收口

但如果继续直接往前推 plugin 主线，当前会立刻撞上三类问题：

1. **后端观测不统一**  
   前端 telemetry 已成型，但 Rust 侧还缺统一业务 helper，`eprintln!` 仍大量存在。
2. **性能基座偏展示化，不够治理化**  
   当前更像“设置 + 快照 + 页面显示”，还不是“共享采样 + 状态决策 + budget / telemetry / query”。
3. **plugin 调试链会越来越黑箱**  
   后续要做 `sidecar / shell surface / summon / revoke / unresponsive / cleanup`，如果没有统一观测面，联调与回归排查成本会急剧上升。

这份 preflight 文档的目的，是在**不暂停 plugin 主线方向**的前提下，先把“足够治理、足够观测、足够可规范开发”的前置基座补起来。

---

## 1) 当前判断

### 1.1 日志基座判断

当前结论：

- 前端 telemetry 主链已经可以作为统一运行时日志入口
- Tauri 边界已有 `invokeWithTelemetry(...)`
- Debug Center、session file、query/export 都已可用
- 最大缺口不是前端，而是 **Rust 侧统一 backend telemetry helper 缺失**

换句话说：

- **日志基座不是重做问题，而是最后 20% 的收口问题**

### 1.2 性能基座判断

当前结论：

- 已有 `Perf Monitor`、`Process Perf Snapshot`、`PerformanceControlService`、`QualityService`、`MemoryGovernanceService`
- 已有基础压力模型：`normal / watch / high`
- 已有背景渲染策略、质量自动档、内存治理动作

但最大问题是：

- process perf 还是 debug 命令式能力，不是共享 runtime service
- 质量决策和压力决策主要停留在内存 snapshot / event bus，不是统一 telemetry 主干
- telemetry contract 里已有 `metric / perf / realtimeVerbose / perfSamplingMs` 等字段，但尚未真正成为性能治理主链

换句话说：

- **性能基座不是空白，而是“粗糙且未连通”的问题**

### 1.3 现在的总策略

当前建议不是“先停下所有 plugin 工作，把日志和性能系统做完”，而是：

1. **先补日志基座的最后 20%**
2. **再补性能基座最关键的 40%**
3. **然后继续推进 plugin 主线**

尤其是下面这些 phase，会直接吃到前置基座的收益：

- `activation/lifecycle parity`
- `Minimal Tracer`
- `sidecar/native-process` failure path
- `overlay / desktop-widget` 的受管 shell surface

---

## 2) 正式进入 Plugin 主线前的门槛

正式继续扩面 plugin 系统前，至少要满足下表中的门槛：

| 主题 | 最小进入条件 |
| --- | --- |
| 日志基座 | Rust 侧存在统一 backend telemetry helper；plugin/runtime/governance 相关新代码默认不再扩散 `eprintln!` |
| 性能采样 | process perf 不再被多个模块各自重复拉取，至少有单一共享采样源或共享缓存源 |
| 性能观测 | `quality / performance-control / memory-governance` 至少能把状态变化写入统一 telemetry 主链 |
| 查询与排障 | Debug Center / telemetry query 至少能回答“为什么 degrade / 为什么 cleanup / 为什么超时 / 为什么被降级” |
| 规范开发 | 已明确事件命名、字段命名、级别策略、采样策略、热路径禁区 |

这里的关键不是“做大”，而是“做成平台前置门槛”。

---

## 3) 工作流 A：日志基座收口

### 3.1 目标

让日志基座从“前端强、后端弱”收口到“前后端同一 contract family 下可查询、可审计、可追踪”。

### 3.2 当前事实

- 前端统一入口：`getTelemetryLogger(...)`
- Tauri 边界统一入口：`invokeWithTelemetry(...)`
- Rust 权威存储：`TelemetryCore`
- 当前 repo 缺口：**没有小而统一的 Rust 侧业务日志 helper**

### 3.3 必做项

#### A1. Rust backend telemetry helper

需要新增统一 helper，目标形态例如：

- `backend_telemetry::debug(...)`
- `backend_telemetry::info(...)`
- `backend_telemetry::warn(...)`
- `backend_telemetry::error(...)`
- `backend_telemetry::metric(...)`

要求：

- 统一写入 `TelemetryCore::ingest_batch(...)`
- 默认 `side = backend`
- 自动补齐稳定字段
- 不让各模块手写零散 telemetry record

#### A2. 后端禁止继续扩散 `eprintln!`

策略：

- `eprintln!` 只保留在极早启动失败、崩溃路径、诊断工具或明确的 file-log / stderr fallback 场景
- plugin/runtime/sidecar/governance/perf 相关新代码，不再接受普通运行时 `eprintln!`

#### A3. 统一事件族

日志事件至少先收口这些族：

- `plugin.runtime.*`
- `plugin.surface.*`
- `plugin.capability.*`
- `plugin.governance.*`
- `plugin.sidecar.*`
- `performance.*`
- `debug.process-perf.*`

#### A4. 补齐 trace/span 传播最小规范

至少先统一这些字段：

- `traceId`
- `spanId`
- `runtimeInstanceId`
- `pluginId`
- `capabilityId`
- `surfaceId`
- `sessionId`
- `durationMs`
- `status`

目标不是先做完整 tracer，而是让之后的 tracer 有统一字段锚点。

### 3.4 退出信号

- Rust 侧统一 backend telemetry helper 已存在并有最小使用样板
- plugin/runtime/governance/perf 热路径新增代码默认不再用 `eprintln!`
- `plugin.*` 与 `performance.*` 事件族命名已经定型
- Debug Center / telemetry query 可以查到前后端同构记录

---

## 4) 工作流 B：性能基座补强

### 4.1 目标

让性能基座从“设置 + 快照 + 页面展示”升级到“共享采样 + 状态决策 + 统一观测 + 后续可接 budget/tracer”。

### 4.2 当前事实

当前已有：

- `Perf Monitor` 页面
- `debug_get_process_perf_snapshot / totals / trim_working_set`
- `PerformanceControlService`
- `QualityService`
- `MemoryGovernanceService`

当前缺口：

- process perf 仍偏 debug helper，不是共享 service
- `quality / pressure / governance` 状态变化没有稳定进入 telemetry 主链
- `TelemetryPolicy.modules[*].perf`
- `TelemetryPolicy.modules[*].realtimeVerbose`
- `TelemetryPolicy.perfSamplingMs`

这些策略字段还没有被真正接线为性能治理开关。

### 4.3 必做项

#### B1. 共享 ProcessPerfService

建议新增单一共享服务，统一负责：

- 拉取 process perf snapshot / totals
- 做最小缓存与去抖
- 维护采样节奏
- 对外提供 `getSnapshot()` 与 `subscribe(...)`

目标：

- `PerformanceControlService`
- `MemoryGovernanceService`
- Debug Center
- scenario snapshot
- future plugin runtime budget / tracer

都不再各自重复发起 process perf IPC。

#### B2. PerformanceObservabilityBridge

建议新增一层“状态变化 -> telemetry”的桥，而不是在热路径刷日志。

第一批只记录状态跃迁：

- `performance.pressure.changed`
- `performance.quality.decision`
- `performance.memory-governance.executed`
- `performance.process-snapshot.unavailable`
- `performance.process-snapshot.recovered`
- `performance.settings.updated`

要求：

- 只在状态变化时打点
- 不在 `requestAnimationFrame` 热循环里直接写 telemetry
- 不把每秒采样结果全量持久化

#### B3. 把策略字段真正接线

至少先让这些策略有实际行为：

- `TelemetryPolicy.perfSamplingMs`
  - 控制共享 perf 采样 cadence
- `TelemetryPolicy.modules['performance'].perf`
  - 控制性能观测事件是否开启
- `TelemetryPolicy.modules['performance'].realtimeVerbose`
  - 控制是否打开更细粒度、只进 UI tail 或 session-local 的性能细节

#### B4. 明确热路径禁区

禁止直接做的事：

- 在 RAF / visualizer 高频循环中直接写 telemetry
- 每次采样都生成持久化 record
- 让性能监控本身成为新的高频 IPC 压力源

允许做的事：

- 采样在内存里聚合
- 只在阈值跨越、决策变化、错误恢复、budget 触发时写 telemetry

#### B5. 非 Windows 降级规则

当前 process perf backend 仍偏 Windows。

preflight 阶段不要求立刻做完整跨平台 perf provider，但必须明确：

- 非 Windows 下哪些字段为空
- UI 如何降级
- telemetry 如何表达 `unsupported / unavailable`
- 后续 plugin runtime budget 判断哪些项可退化

### 4.4 退出信号

- 存在单一共享 `ProcessPerfService` 或等价共享采样层
- `quality / performance-control / memory-governance` 的状态变化已进入统一 telemetry 主链
- `perfSamplingMs / module.perf / realtimeVerbose` 至少有最小接线
- Debug Center 能把 telemetry 与 perf 状态合并查看
- 非 Windows 下的 unsupported / unavailable 降级口径明确

---

## 5) 工作流 C：共享观测契约

### 5.1 目标

在继续扩面 plugin 平台之前，先把日志和性能两条基座共用的字段与命名固定下来，避免之后 `Tracer / sidecar / shell surface / budgets` 再各起一套。

### 5.2 最小统一字段

建议最少固定这些字段：

- `traceId`
- `spanId`
- `moduleId`
- `component`
- `pluginId`
- `runtimeInstanceId`
- `surfaceId`
- `capabilityId`
- `sessionId`
- `status`
- `durationMs`
- `budgetClass`
- `pressure`
- `qualityLevel`
- `reason`

### 5.3 最小事件命名建议

建议先固定这些事件名：

- `plugin.runtime.resolve.start`
- `plugin.runtime.resolve.completed`
- `plugin.runtime.resolve.failed`
- `plugin.runtime.activate.start`
- `plugin.runtime.activate.completed`
- `plugin.runtime.activate.failed`
- `plugin.surface.mount.start`
- `plugin.surface.mount.completed`
- `plugin.surface.mount.failed`
- `plugin.governance.revoke.start`
- `plugin.governance.revoke.completed`
- `plugin.governance.revoke.timeout`
- `plugin.sidecar.bridge.opened`
- `plugin.sidecar.bridge.failed`
- `plugin.sidecar.process.unresponsive`
- `plugin.sidecar.process.forced-teardown`
- `performance.pressure.changed`
- `performance.quality.decision`
- `performance.memory-governance.executed`
- `performance.process-snapshot.unavailable`
- `performance.process-snapshot.recovered`

### 5.4 日志级别建议

- `debug`
  - 本地诊断、重试细节、采样细节、仅会话内高频信息
- `info`
  - 有意义的状态跃迁、一次能力调用完成、一次治理动作完成
- `warn`
  - 降级、best-effort fallback、可恢复失败、unsupported / unavailable
- `error`
  - 影响功能的失败、cleanup 失败、预算失控、治理动作失败
- `fatal`
  - 无法恢复的初始化失败、宿主关键路径崩坏

---

## 6) 建议执行顺序

### 6.1 P0：继续做 plugin 主线前必须完成

- Rust backend telemetry helper
- plugin / performance 事件族命名冻结
- 共享 `ProcessPerfService`
- `PerformanceObservabilityBridge`
- `quality / performance-control / memory-governance` 状态变化 telemetry

### 6.2 P1：强烈建议在 `sidecar / shell surface` 深挖前完成

- plugin/runtime/perf 相关新代码不再继续扩散 `eprintln!`
- Debug Center 增加按 `plugin.* / performance.*` 的查询与过滤口径
- 至少 1 组围绕状态变化 telemetry 的自动化测试

### 6.3 P2：可以与后续 plugin 主线并行推进

- 更广的 Rust 模块替换到 backend telemetry helper
- 更完整的 perf budget 断言
- 更细粒度的 `Minimal Tracer -> Full Tracer` 接线
- 非 Windows perf provider 的扩面

---

## 7) 交付物建议

### 7.1 代码入口

日志基座：

- `apps/desktop/src/contracts/telemetry.ts`
- `apps/desktop/src/services/telemetry/TelemetryService.ts`
- `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`
- `apps/desktop/src-tauri/src/telemetry.rs`
- `apps/desktop/src-tauri/src/telemetry_contract.rs`
- `apps/desktop/src-tauri/src/telemetry_policy.rs`
- `apps/desktop/src-tauri/src/commands/debug.rs`

性能基座：

- `apps/desktop/src/modules/debug/processPerf.ts`
- `apps/desktop/src/services/performance-control/PerformanceControlService.ts`
- `apps/desktop/src/services/quality/QualityService.ts`
- `apps/desktop/src/services/governance/MemoryGovernanceService.ts`
- `apps/desktop/src/components/pages/PerfMonitorPage.tsx`
- `apps/desktop/src-tauri/src/perf_monitor.rs`

### 7.2 建议新增文件

建议优先考虑这些文件位：

- `apps/desktop/src-tauri/src/backend_telemetry.rs`
- `apps/desktop/src/services/performance-control/ProcessPerfService.ts`
- `apps/desktop/src/services/performance-control/performanceObservability.ts`

文件名不是硬约束，职责边界才是重点。

### 7.3 自动化建议

至少补这些测试：

- backend telemetry helper 的最小 record emission 测试
- `ProcessPerfService` 的缓存 / 订阅 / unsupported 行为测试
- `PerformanceObservabilityBridge` 的“只在状态变化时打点”测试
- `quality / pressure / governance` 事件命名与字段快照测试

---

## 8) 正式继续 Plugin 主线前的最终退出信号

当且仅当下面这些问题都能被稳定回答时，才算 preflight 完成：

- 为什么某个 plugin runtime 没 activate？
- 为什么某次 revoke / disable / cleanup 超时？
- 为什么某个 overlay / widget 召唤时出现明显卡顿？
- 当前是压力升高导致降级，还是治理动作导致降级？
- 当前 sidecar / shell surface 的异常，是功能错误还是性能退化？

如果这些问题仍然只能靠：

- 看零散 `eprintln!`
- 手工拼接 Debug Center 页面
- 到处临时加 `console.log`

那就说明 preflight 还没有完成，不应该继续大规模扩面 plugin 平台。

---

## 9) 非目标

这份 preflight 的非目标非常明确：

- 不先做完整 `Full Protocol Tracer / Profiler`
- 不先做完整 budget governor
- 不先做 GPU / compositor / scene protocol
- 不先做完整 cross-platform perf backend
- 不先做“所有旧模块一次性 telemetry 化”

preflight 的目标不是做大，而是做成**足够规范、足够观测、足够可治理**的前置底座。
