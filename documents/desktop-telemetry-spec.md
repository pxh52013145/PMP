# Desktop Telemetry 规范

本文档定义 Pixel Matrix Player 桌面端当前已落地的 telemetry 使用规范、查看入口、持久化位置和开发约束。

目标只有两个：

1. 让后续开发对日志、调试、性能观测使用同一套入口和契约。
2. 避免重新回到 `console.*`、字符串拼接日志、各模块各写一套的状态。

## 1. 当前实现范围

当前已落地的 telemetry 基座由以下部分组成：

- 前端 contract:
  - `apps/desktop/src/contracts/telemetry.ts`
- 前端 runtime:
  - `apps/desktop/src/services/telemetry/TelemetryService.ts`
  - `apps/desktop/src/services/telemetry/consoleBridge.ts`
  - `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`
  - `apps/desktop/src/services/telemetry/scenarioSnapshots.ts`
- 前端 debug bridge:
  - `apps/desktop/src/modules/debug/telemetry.ts`
- Rust sink:
  - `apps/desktop/src-tauri/src/telemetry.rs`
  - `apps/desktop/src-tauri/src/telemetry_store.rs`
- 可视入口:
  - `apps/desktop/src/components/debug/DebugCenter.tsx`

## 2. 在哪里查看 Telemetry

当前有 3 个主要查看入口。

### 2.1 应用内 Debug Center

主入口是桌面应用内的 `Debug Center`。

当前 Telemetry 相关能力集中在：

- `Telemetry / 运行时` 卡片
- `Recent Tail`
- `Refresh Telemetry`
- `Flush`
- `Clear Session`
- `Export Session JSON`
- `Export Scenario Report`

这个入口适合看：

- 当前 session 是否开启 telemetry
- 当前 session id
- 前端本地缓冲、丢弃、tail 状态
- 后端已 flush 条数、文件大小、当前文件路径
- 最近 tail 的结构化记录

### 2.2 DevTools Console

DevTools 不是 telemetry 主入口，但仍然有辅助作用。

当前行为如下：

- 旧的 `console.log/info/warn/error/debug` 仍然会显示在 DevTools Console。
- `consoleBridge` 会把这些 `console.*` 同时镜像成 telemetry 记录。
- 纯 telemetry logger:
  - `getTelemetryLogger(...).info/warn/error(...)`
  - `invokeWithTelemetry(...)`
  - `captureTelemetryScenarioSnapshot(...)`
  默认不会自动回显到 DevTools Console。

因此：

- UI 异常、React warning、同步 stack trace，优先看 DevTools。
- 内存、队列、切歌、Tauri 调用链、跨模块时序，优先看 Debug Center 和 session 文件。

### 2.3 当前 Session 文件

Rust 侧 telemetry 持久化路径来自：

- `app_data_dir()/debug/telemetry/current-session.jsonl`

当前实现见：

- `apps/desktop/src-tauri/src/telemetry_store.rs`

在 Windows 上，当前应用 bundle identifier 为：

- `com.pixelmatrix.player`

因此典型路径通常是：

- `%APPDATA%\\com.pixelmatrix.player\\debug\\telemetry\\current-session.jsonl`

注意：

- 真实根路径以运行时 `app_data_dir()` 为准。
- Debug Center 会直接显示 `currentFilePath`，这是最可信的当前值。

## 3. 另外会保存到哪里

Telemetry session 导出和场景报告导出目前不是写回 telemetry 目录，而是写到：

- `appData/logs/telemetry-session-<timestamp>-<sessionId>.json`
- `appData/logs/telemetry-scenario-<timestamp>-<sessionId>.md`

当前实现见：

- `apps/desktop/src/components/debug/DebugCenter.tsx`

这两个导出文件是“调试产物”，不是 telemetry 原始存储。

## 4. 当前实际支持的命令

当前已落地、可直接使用的 debug telemetry 命令只有这些：

- `debug_telemetry_ingest_batch`
- `debug_telemetry_get_status`
- `debug_telemetry_clear_session`
- `debug_telemetry_read_current_session`
- `debug_telemetry_query`

当前前端 bridge 在：

- `apps/desktop/src/modules/debug/telemetry.ts`

不要把规划文档里的 `query/export bundle/get_recent` 当成已实现能力，除非代码里已经真正落地。

### 4.1 AI 入口

当前新增的 AI 日志入口不是“直接把整份 session JSONL 交给 AI”，而是一个受限、结构化、可导出的查询入口：

- Rust / Tauri 命令：
  - `debug_telemetry_query`
- 前端 bridge：
  - `queryTelemetryCurrentSession(query)`
- AI markdown builder：
  - `buildTelemetryAiContextReport(...)`
- Debug Center 入口：
  - `Copy AI Context`
  - `Export AI Context`

默认 AI 查询策略：

- 仅查询当前 active session
- 默认模块聚焦：
  - `startup`
  - `navigation`
  - `audio`
  - `music-library`
  - `playlists`
  - `memory-governance`
  - `windowing`
  - `settings`
  - `visualizer`
- 默认级别：
  - `info`
  - `warn`
  - `error`
  - `fatal`
- 默认 limit：
  - `180`

设计目的：

- 给 AI / 自动诊断脚本一个稳定入口，而不是读取整份原始日志文件
- 优先返回：
  - session 概览
  - top modules / levels / events
  - 最近匹配记录
  - 导出时进程快照
- 控制上下文体积，避免把大量无关历史、低价值 tail 或大 payload 一次性塞进 prompt

导出产物位置：

- `appData/logs/telemetry-ai-context-<timestamp>-<sessionId>.md`

## 5. Telemetry 数据模型

基础 contract 在：

- `apps/desktop/src/contracts/telemetry.ts`

当前统一字段如下：

- `ts`
- `level`
- `kind`
- `side`
- `moduleId`
- `event`
- `sessionId`
- `component`
- `message`
- `traceId`
- `spanId`
- `windowId`
- `fields`

### 5.1 Level

允许值：

- `trace`
- `debug`
- `info`
- `warn`
- `error`
- `fatal`

默认策略：

- `frontendMinLevel = info`
- `backendMinLevel = info`
- `persistMinLevel = warn`

### 5.2 Kind

允许值：

- `log`
- `metric`
- `span-start`
- `span-end`
- `snapshot`
- `audit`

### 5.3 Side

允许值：

- `frontend`
- `backend`

## 6. 事件命名规范

所有 telemetry 事件必须使用稳定、可过滤、可统计的英文 event name。

推荐格式：

- `<domain>.<entity>.<action>`
- `<domain>.<entity>.<action>.<result>`

示例：

- `audio.queue.add`
- `audio.track.switch.start`
- `audio.track.switch.completed`
- `playlists.cover.load.failed`
- `music-library.scan.backend.quick`
- `window.main.close.prompt-opened`

禁止：

- `something happened`
- `failed`
- `debug1`
- 动态拼接 track title 到 event name

动态信息必须放在 `fields` 里，不得放在 event name 里。

## 7. ModuleId 规范

`moduleId` 必须稳定，优先使用系统边界而不是页面标题。

推荐模块：

- `audio`
- `music-library`
- `playlists`
- `navigation`
- `windowing`
- `editor`
- `visualizer`
- `memory-governance`
- `debug`
- `startup`
- `storage`
- `vst`

禁止：

- `page1`
- `misc`
- `tmp`
- 运行时动态字符串

## 8. Component 规范

`component` 用来标识具体类、页面、组件或服务。

推荐：

- `MusicLibraryService`
- `NativeAudioService`
- `Playlists`
- `DebugCenter`

如果没有明确组件边界，可以为 `null`，但不要随意省略本来明确的组件名。

## 9. Fields 规范

`fields` 必须结构化、可序列化、可比较。

推荐放入：

- id
- 数量
- bytes
- durationMs
- queueLength
- path 是否存在
- 策略名
- reason
- 布尔状态
- 采样值

禁止放入：

- 全量 track 数组
- `ArrayBuffer`
- 封面二进制
- base64 大字符串
- 完整歌词正文
- 大量嵌套原始 payload

对于大对象，只记录：

- `count`
- `id`
- `keys`
- `approxBytes`
- `firstId`
- `lastId`

## 10. 何时使用什么 API

### 10.1 普通业务日志

使用：

- `getTelemetryLogger(moduleId, component)`

示例：

```ts
const telemetry = getTelemetryLogger('music-library', 'MusicLibraryService');

telemetry.info('music-library.scan.start', {
  fields: {
    sourceId,
    path,
  },
});
```

### 10.2 Tauri 命令

统一使用：

- `invokeWithTelemetry(...)`

不要在新代码里直接大面积使用裸 `invoke(...)`。

示例：

```ts
await invokeWithTelemetry('music_library_open_in_file_manager', { path }, {
  moduleId: 'music-library',
  component: 'MusicLibraryService',
  event: 'music-library.path.open-in-file-manager',
});
```

### 10.3 关键场景快照

使用：

- `captureTelemetryScenarioSnapshot(...)`

适合：

- 打开歌单
- 加入队列
- 切歌完成
- 清空队列
- 页面打开/关闭
- 内存治理前后

### 10.4 临时兼容旧日志

旧代码里的 `console.*` 当前会被 `consoleBridge` 镜像到 telemetry。

但这只是迁移兼容层，不是长期推荐写法。

新代码默认禁止继续加 runtime `console.*`。

## 11. 什么时候允许保留 console

允许保留的场景：

- 测试代码
- 一次性调试脚本
- 非关键 bootstrap 早期阶段
- 第三方库桥接层临时兼容

如果必须保留 runtime `console.*`，必须满足：

- 有明确迁移计划
- 带稳定前缀，如 `[MusicLibrary]`
- 不依赖它作为唯一事实来源

## 12. 性能和内存约束

Telemetry 不得反过来成为内存和性能问题来源。

必须遵守：

- 高频链路不打大对象日志
- 音频实时线程不直接打重量日志
- 渲染热路径只打聚合 metric 或抽样 snapshot
- 文件扫描、队列变更、页面切换等高频链路要带节流或批量 flush 意识
- 封面、歌词、音频内容不得写入 telemetry

当前默认策略：

- `batchFlushMs = 250`
- `batchMaxItems = 64`
- `perfSamplingMs = 1000`

## 13. 推荐排障路径

### 13.1 UI / React / DOM 问题

优先看：

- DevTools Console
- React warning
- Network / Elements / Performance

### 13.2 队列膨胀 / 切歌 / 内存 / 跨模块链路

优先看：

- Debug Center 的 Telemetry 运行时卡片
- Recent Tail
- 导出的 session JSON
- `current-session.jsonl`

### 13.3 场景复盘

优先使用：

- `Export Session JSON`
- `Export Scenario Report`

## 14. Code Review 检查项

每个涉及调试、日志、性能采样的新 PR，都要对照以下清单：

- 是否新增了 runtime `console.*`
- 是否应该改为 `getTelemetryLogger(...)`
- 是否所有 Tauri 命令都走了 `invokeWithTelemetry(...)`
- event name 是否稳定、英文、可过滤
- `moduleId` 是否稳定
- `fields` 是否结构化且轻量
- 是否把大 payload 直接塞进 telemetry
- 是否在关键场景点补了 snapshot
- 是否避免了热路径高频刷日志

## 15. 迁移原则

后续迁移顺序固定如下：

1. 服务层和跨模块链路先迁
2. 失败分支和异常日志先迁
3. 队列、扫描、封面、切歌、窗口通信等排障高价值链路优先
4. 页面内临时 `console.log` 最后清理

结论：

- DevTools 仍然重要，但不再是完整事实源。
- Telemetry 是 PMP 桌面端后续调试、性能观测、问题复盘的主入口。
- 新代码默认必须遵循本规范，除非有明确的兼容理由。
