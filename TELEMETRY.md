# Telemetry

本文件是 PMP 桌面端 telemetry / debug logging 的权威说明。

适用范围：
- `apps/desktop`
- `apps/desktop/src-tauri`

本文件优先级高于 `documents/` 下的规划文档。旧文档可以继续保留作为设计背景，但后续开发、排障、AI 取数、Code Review 一律以本文件为准。

## 1. 目标

Telemetry 不是“把 `console.log` 换个地方写”。

它的目标只有四个：
- 给桌面端提供统一的结构化日志入口。
- 让前端 TS、Tauri invoke、Rust 持久化、Debug Center、AI 分析共用同一套契约。
- 让性能、内存、切歌、队列、封面、窗口链路可以按模块追踪。
- 避免日志本身变成新的内存和性能负担。

## 2. 当前实现

当前已落地的 telemetry 基座如下。

前端契约与服务：
- `apps/desktop/src/contracts/telemetry.ts`
- `apps/desktop/src/services/telemetry/TelemetryService.ts`
- `apps/desktop/src/services/telemetry/telemetryTypes.ts`
- `apps/desktop/src/services/telemetry/consoleBridge.ts`
- `apps/desktop/src/services/telemetry/tauriInvokeTelemetry.ts`
- `apps/desktop/src/services/telemetry/scenarioSnapshots.ts`
- `apps/desktop/src/services/telemetry/aiContextReport.ts`
- `apps/desktop/src/services/telemetry/scenarioReport.ts`

前端 debug bridge：
- `apps/desktop/src/modules/debug/telemetry.ts`

Debug UI：
- `apps/desktop/src/components/debug/DebugCenter.tsx`

Rust authoritative sink：
- `apps/desktop/src-tauri/src/telemetry.rs`
- `apps/desktop/src-tauri/src/telemetry_store.rs`
- `apps/desktop/src-tauri/src/telemetry_policy.rs`
- `apps/desktop/src-tauri/src/commands/debug.rs`

一句话概括当前架构：
- 前端负责产生日志、临时 UI tail、调用包装、场景快照。
- Rust 负责当前 session 持久化、清理、查询、聚合统计。
- Debug Center 是人类入口。
- `queryTelemetryCurrentSession(...)` + `buildTelemetryAiContextReport(...)` 是 AI 入口。

## 3. 现在怎么查看 Telemetry

### 3.1 Debug Center

主入口是应用内的 `Debug Center`。

当前与 telemetry 直接相关的能力包括：
- `Telemetry / Runtime`
- `Recent Tail`
- `Refresh Telemetry`
- `Flush`
- `Clear Session`
- `Export Session JSON`
- `Export Scenario Report`
- `Copy AI Context`
- `Export AI Context`

适合看的问题：
- 当前 session 是否正常写入。
- 当前文件路径、文件大小、flush 状态、丢弃条数。
- 最近的结构化 tail。
- 导出用于人工排查或 AI 分析的报告。

### 3.2 DevTools Console

DevTools Console 不是 telemetry 的权威入口，但仍然保留。

当前行为：
- 旧的 `console.log/info/warn/error/debug` 仍会显示在 DevTools。
- `consoleBridge` 会把这些 `console.*` 镜像到 telemetry，事件名为 `console.<method>`。
- 新的 telemetry API 不会自动回显到 DevTools Console。

这意味着：
- React warning、同步异常栈、浏览器层报错，先看 DevTools。
- 内存、队列、切歌、模块链路、invoke 时序，优先看 Debug Center 和 session 文件。

### 3.3 当前 Session 文件

当前 session 持久化文件：
- `appData/debug/telemetry/current-session.jsonl`

Windows 典型路径：
- `%APPDATA%\\com.pixelmatrix.player\\debug\\telemetry\\current-session.jsonl`

实际代码：
- `apps/desktop/src-tauri/src/telemetry_store.rs`

注意：
- 真实路径以运行时 `app_data_dir()` 为准。
- Debug Center 显示的 `currentFilePath` 是当前最可信路径。

## 4. 导出文件在哪里

Debug Center 的导出文件目前写到：
- `appData/logs/telemetry-session-<timestamp>-<sessionId>.json`
- `appData/logs/telemetry-scenario-<timestamp>-<sessionId>.md`
- `appData/logs/telemetry-ai-context-<timestamp>-<sessionId>.md`

对应实现：
- `apps/desktop/src/components/debug/DebugCenter.tsx`

这些文件是调试产物，不是底层权威存储。
权威原始 session 仍然是 `current-session.jsonl`。

## 5. 当前真实支持的命令

当前已经落地并可直接使用的 Tauri telemetry 命令只有这些：
- `debug_telemetry_ingest_batch`
- `debug_telemetry_get_status`
- `debug_telemetry_clear_session`
- `debug_telemetry_read_current_session`
- `debug_telemetry_query`

对应实现：
- `apps/desktop/src-tauri/src/commands/debug.rs`
- `apps/desktop/src/modules/debug/telemetry.ts`

不要把旧规划文档里未落地的导出/查询能力当成当前事实。

## 6. AI 如何使用 Telemetry

如果是 AI 或自动化诊断脚本，默认不要直接读取整份 JSONL 塞进 prompt。

首选流程：

1. 使用结构化查询读取当前活动 session。
2. 只取本次问题相关模块和时间窗口。
3. 如需性能上下文，再补一份进程快照。
4. 最后生成 AI context markdown。

推荐 API：
- `queryTelemetryCurrentSession(query)`
- `getDefaultTelemetryAiQuery()`
- `buildTelemetryAiContextReport(...)`
- `getProcessPerfTotalsSnapshot()`

推荐代码：

```ts
import { queryTelemetryCurrentSession } from './apps/desktop/src/modules/debug/telemetry';
import {
  buildTelemetryAiContextReport,
  getDefaultTelemetryAiQuery,
} from './apps/desktop/src/services/telemetry/aiContextReport';
import { getProcessPerfTotalsSnapshot } from './apps/desktop/src/modules/debug/processPerf';

const query = {
  ...getDefaultTelemetryAiQuery(),
  moduleIds: ['audio', 'playlists', 'music-library', 'memory-governance'],
  searchText: 'recent-play',
  limit: 180,
};

const result = await queryTelemetryCurrentSession(query);
const perfTotals = await getProcessPerfTotalsSnapshot().catch(() => null);

if (result) {
  const report = buildTelemetryAiContextReport({
    query,
    result,
    perfTotals,
  });
}
```

### 6.1 AI 默认查询策略

当前 `getDefaultTelemetryAiQuery()` 默认聚焦模块：
- `startup`
- `navigation`
- `audio`
- `music-library`
- `playlists`
- `memory-governance`
- `windowing`
- `settings`
- `visualizer`

默认级别：
- `info`
- `warn`
- `error`
- `fatal`

默认 limit：
- `180`

### 6.2 AI 必须知道的限制

`queryTelemetryCurrentSession(...)` 查询的是“当前活动 session 的持久化记录”，不是前端内存 tail。

这有两个重要后果：
- 它不会返回旧 session。
- 默认 `persistMinLevel = warn`，因此很多 `info/debug` 记录不会出现在 JSONL 里。

所以如果 AI 要查高频细节：
- 优先先看 `warn/error/fatal` 的结构化链路。
- 如果必须看 `info` 级过程日志，需要临时下调 `persistMinLevel`，或者让开发者直接从 Debug Center 的 `Recent Tail` 辅助确认。

### 6.3 AI 使用规范

AI 应该：
- 先缩小模块范围，再查。
- 先用查询结果和统计桶定位，再看最近记录。
- 需要汇报时输出 `AI Context` 或场景报告，而不是原始 JSONL 大段拷贝。
- 对“日志里没有”与“系统没发生”做区分，先考虑是否被 `persistMinLevel` 过滤。

AI 不应该：
- 默认把整份 session 文件塞进上下文。
- 直接依赖零散 `console.*` 文本作为唯一事实来源。
- 把一次问题扩展成全局历史检索。

## 7. 开发时必须使用的 API

### 7.1 普通模块日志

统一使用：
- `getTelemetryLogger(moduleId, component)`

示例：

```ts
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('music-library', 'MusicLibraryService');

telemetry.info('music-library.cover.resolve.completed', {
  message: 'cover resolved',
  fields: {
    trackId,
    cacheHit,
    decodeMs,
  },
});
```

### 7.2 Tauri 命令调用

统一使用：
- `invokeWithTelemetry(command, args, options)`

示例：

```ts
await invokeWithTelemetry('native_audio_select_output_backend', { backendId }, {
  moduleId: 'audio',
  component: 'NativeAudioService',
  event: 'audio.output-backend.select',
  successLevel: 'info',
});
```

规则：
- 新增前端 Tauri 调用时，默认必须走 `invokeWithTelemetry(...)`。
- 唯一例外是 `debug_telemetry_*` 自身命令，当前实现会主动 bypass，避免递归。

### 7.3 场景快照

用于关键时刻落点：
- `captureTelemetryScenarioSnapshot(...)`

适合的场景：
- 打开歌单
- 加入队列
- 切歌开始/完成
- 清空队列
- 导航切换
- 内存治理动作

示例：

```ts
captureTelemetryScenarioSnapshot({
  moduleId: 'playlists',
  component: 'Playlists',
  event: 'playlists.selection.changed.snapshot',
  fields: {
    playlistId,
    trackCount,
  },
  includeProcessPerf: true,
  minIntervalMs: 1000,
});
```

### 7.4 查询与导出

统一使用：
- `getTelemetryStatus()`
- `readCurrentTelemetrySession()`
- `queryTelemetryCurrentSession(query)`
- `buildTelemetryAiContextReport(...)`
- `buildTelemetryScenarioReport(...)`

## 8. 日志开发规范

### 8.1 事件命名

事件名必须稳定、可检索、可聚合。

推荐格式：
- `<domain>.<entity>.<action>`
- `<domain>.<entity>.<action>.<result>`

例子：
- `audio.queue.add`
- `audio.track.switch.start`
- `audio.track.switch.completed`
- `playlists.selection.changed`
- `music-library.cover.resolve.failed`
- `windowing.editor.open.completed`

禁止：
- `something happened`
- `debug1`
- `failed`
- 把歌曲名、路径、用户输入直接拼进 event name

动态数据放进 `fields`，不要放进 `event`。

### 8.2 moduleId 规范

`moduleId` 必须是稳定边界，不是临时名字。

优先使用：
- `startup`
- `navigation`
- `audio`
- `music-library`
- `playlists`
- `memory-governance`
- `windowing`
- `settings`
- `visualizer`
- `editor`
- `debug`
- `storage`
- `vst`

禁止：
- `misc`
- `temp`
- `page1`
- 运行时动态拼接值

### 8.3 component 规范

`component` 用来标识具体类、页面、组件、服务。

推荐：
- `MusicLibraryService`
- `NativeAudioService`
- `Playlists`
- `DebugCenter`

如果边界明确，就不要省略。

### 8.4 fields 规范

`fields` 必须结构化、轻量、可序列化。

推荐放入：
- id
- count
- bytes
- durationMs
- queueLength
- cacheHit
- reason
- status
- policyName
- mode
- sampleRate
- trackIndex

禁止放入：
- 全量 `tracks[]`
- 全量 `queue[]`
- 封面二进制 / blob / base64
- PCM / FFT 大数组
- 大段歌词、HTML、CSS、SQL
- 完整文件内容
- token、cookie、鉴权头、隐私数据

原则：
- 如果字段大到不适合做筛选和聚合，它就不应该进 telemetry。

### 8.5 message 规范

`message` 是给人看的简短补充，不是主结构。

要求：
- 可选
- 简短
- 不承载唯一关键信息

不要把结构化信息只写在 `message` 里。

### 8.6 level 使用规范

推荐语义：
- `trace`: 极细粒度，仅临时或受策略控制。
- `debug`: 调试细节，不应默认持久化太多。
- `info`: 正常状态变化、阶段完成、重要但非异常。
- `warn`: 可恢复异常、回退、降级、非预期状态。
- `error`: 失败、用户可感知异常、需要调查。
- `fatal`: 致命错误、系统无法继续。

当前默认策略：
- `frontendMinLevel = info`
- `backendMinLevel = info`
- `persistMinLevel = warn`

这意味着：
- 默认前端 `debug` 不会进持久化。
- 很多 `info` 也不会写入 session 文件。
- `Recent Tail` 可能比 `current-session.jsonl` 更丰富。

### 8.7 kind 使用规范

当前允许值：
- `log`
- `metric`
- `span-start`
- `span-end`
- `snapshot`
- `audit`

推荐：
- 普通离散事件用 `log`
- 数值观测用 `metric`
- 一次操作的开始/结束用 `span-start` / `span-end`
- 场景关键状态用 `snapshot`

### 8.8 Console 使用规范

当前 `console.*` 仍然可用，但只用于兼容和浏览器层辅助排查。

新代码规则：
- 不再新增业务 `console.*` 作为正式日志入口。
- 业务日志一律改用 telemetry。
- 只有浏览器调试、第三方库接入、极短期临时排查时，才允许保留少量 `console.*`。

原因：
- `console.*` 无稳定 schema。
- 不利于按模块过滤、导出、AI 消费、回放场景。

### 8.9 高频与实时线程规范

Telemetry 不能反向伤害性能。

要求：
- 高频路径优先采样、聚合、去重，不要逐条暴力打点。
- 音频实时线程、render callback、紧密循环里禁止做大对象序列化。
- 不要在热路径里 `JSON.stringify` 大对象。
- 不要为日志复制完整业务数组。
- 快照使用 `minIntervalMs` 或 dedupe key，避免刷屏。

## 9. 人类排障建议

查问题时优先顺序建议如下：

1. 先在 Debug Center 看当前 `Telemetry / Runtime` 状态。
2. 再看 `Recent Tail` 是否已有明显异常链路。
3. 需要结构化检索时，用 `queryTelemetryCurrentSession(...)`。
4. 需要交给 AI 时，用 `Copy AI Context` 或 `Export AI Context`。
5. 需要完整时序时，用 `Export Scenario Report`。
6. 浏览器层 warning 和同步异常，再回 DevTools Console 对照。

## 10. Code Review 清单

涉及日志、调试、内存治理、切歌、队列、封面、窗口链路的 PR，至少检查：

- 是否新增业务日志时使用了 `getTelemetryLogger(...)`。
- 是否新增 Tauri 调用时使用了 `invokeWithTelemetry(...)`。
- 是否关键场景变化有 `snapshot`，而不是只有零散文本。
- `moduleId`、`component`、`event` 是否稳定且可搜索。
- `fields` 是否小而结构化。
- 是否误把大数组、图片、二进制、敏感数据写进日志。
- 是否考虑了 `persistMinLevel`，避免“以为能查到但其实不会落盘”。
- 高频路径是否有采样/去重/限流。
- 是否真的需要 `console.*`，如果不需要就迁移到 telemetry。

## 11. 旧文档定位

以下文档仍可保留，但它们是历史方案或执行拆分，不再是权威说明：
- `documents/desktop-telemetry-spec.md`
- `documents/desktop-debug-telemetry-plan.md`
- `documents/desktop-debug-telemetry-execution-plan.md`

后续如果实现发生变化，应先更新本文件，再决定是否回写历史文档。
