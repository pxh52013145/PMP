# 流媒体集成设计草案

## 愿景

构建一套稳定的流媒体集成层，把第三方音乐平台 API 接入播放器，同时不把平台特有逻辑扩散到音频引擎和通用播放服务中。

## 目标

- 用统一的 provider 抽象接入第三方流媒体平台。
- 在能力允许的前提下，统一搜索、浏览、歌单、曲目、播放准备等基础模型。
- 把播放准备、鉴权、缓存、失败恢复的复杂度限制在流媒体层，不继续泄漏到 `NativeAudioService`。

## 当前问题

当前 API 歌曲可以播放，但入口没有统一。

已确认的现状：

- 本地歌曲通常直接携带绝对路径，可以直接进入原生播放链。
- API 歌曲不会直接进入原生音频核心，而是要先做播放准备，再转成 `cachePath`。
- 原生音频核心当前本质是“路径驱动”，不是“直接流 URL 驱动”。
- `Bilibili` 与 `Netease` 当前并没有完全统一的播放准备入口。
- 平台页面、facade、`NativeAudioService` 之间存在一定的平台特判分散。

因此，这份文档的核心任务不是改写音频引擎，而是定义“API 歌曲如何统一进入现有播放主链”。

## 平台 Magnet 定位

`platform` magnet 应被视为 `stream-integration` 的当前宿主实现，而不是某个具体平台的页面集合。

它的职责应该明确为：

- 统一流媒体入口 UI
- 统一交互范式
- 统一 API 规范的宿主承载面
- 统一整合多个流媒体 provider 的展示与播放入口

它不应被继续演化为：

- `Bilibili` / `Netease` / `QQ Music` 这类平台专属逻辑容器
- 平台特判不断堆积的页面层集合
- 音频引擎的上层临时补丁区

后续如果 `platform` 相关能力逐步插件化，也应保持这个原则：

- `platform magnet` 负责统一 UI
- provider 负责提供能力
- stream integration 负责规范能力边界与调度

## 设计原则

### 1. 保持播放器本地优先

当前播放器本质上是面向本地播放的。

因此流媒体集成不应强行把底层音频引擎改造成完全不同的在线流播放器，而应优先复用当前已经成熟的本地路径播放主链。

### 2. 统一入口，不统一一切细节

不同 provider 的鉴权方式、曲目定位方式、码率策略、缓存策略可能不同。

目标不是抹平所有差异，而是统一：

- UI 调用入口
- 播放准备结果模型
- 与音频引擎的交接边界

同时不强制：

- 所有 provider 返回完全一致的扩展字段
- 所有 provider 拥有完全一致的内容结构
- 所有 provider 都实现同一组高级功能

### 3. provider 特有逻辑不进入音频引擎

平台差异应主要留在：

- provider adapter
- prepare playback backend API
- streaming integration orchestration

而不应继续堆到：

- `NativeAudioService`
- `IAudioService`
- 音频引擎核心状态机

### 4. 统一 UI 基于 capability，而不是基于平台名

`platform magnet` 后续不应继续按“这是 bilibili / 这是 netease”来写页面分支。

更合理的方式是：

- 基于 capability 决定页面可展示哪些模块
- 基于 capability 决定允许哪些交互
- 基于 capability 决定 provider 能否进入统一播放准备链

也就是说，UI 首先面向能力模型，其次才是 provider 身份。

## 核心方案

### 方案总览

统一定义一条 API 歌曲播放准备链：

1. UI / 页面层只发起统一的 `preparePlayback` 请求
2. streaming integration 层根据 `connectorId` 找到对应 provider adapter
3. provider adapter 调用后端 provider-specific prepare API
4. 后端完成鉴权、流地址解析、下载/缓存/预缓冲
5. 后端返回统一的 `PreparedPlayableTrack`
6. 前端将其转换为标准 `Track`
7. 之后统一进入现有 `audioService.addToQueue / playTrackAtIndex / loadAndPlayTrackInternal` 链路

也就是说：

- provider 差异止步于 `preparePlayback`
- 进入音频播放主链后，尽量不再区分平台来源

## 建议新增的统一模型

### 三层模型

后续建议明确使用三层模型，而不是直接把 provider 曲目塞进播放服务：

1. `SourceRef`
2. `PreparedPlayable`
3. `Track`

含义分别是：

- `SourceRef`：来源引用，表示“我知道这首内容来自哪里”
- `PreparedPlayable`：已完成播放准备，表示“现在已经可以交给播放器”
- `Track`：当前播放器内部消费的标准播放实体

这样可以避免 UI、provider、播放服务三方直接耦合。

### Provider 曲目引用

用于表示“还不能直接播放”的平台曲目。

建议统一成类似模型：

```ts
type SourceRef = {
  providerId: string;
  connectorId: string;
  sourceLocator: string;
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  coverUrl?: string;
};
```

这个模型只描述来源，不承诺当前已经可播放。

### 已准备可播放实体

用于表示“已经完成播放准备，可以交给本地播放主链”的结果。

建议统一成类似模型：

```ts
type PreparedPlayable = {
  providerId: string;
  connectorId: string;
  sourceLocator: string;
  cachePath: string;
  streamUrl?: string;
  mimeType?: string;
  durationSeconds?: number;
  coverUrl?: string;
  playbackMode: 'cached-file';
  metadata?: Record<string, unknown>;
};
```

重点是：

- `cachePath` 是当前阶段的硬边界
- `streamUrl` 可以保留，但不是交给音频引擎的主输入
- 当前阶段统一交接给音频引擎的仍是本地可读路径

### 播放服务输入实体

在当前播放器实现里，最终仍然建议转换成标准 `Track` 再进入音频服务。

也就是说，统一链路应是：

- `SourceRef -> PreparedPlayable -> Track`
- `Track -> audioService / native audio`

## 统一 API 入口建议

### 前端统一入口

建议在 streaming integration 层定义统一入口，而不是让页面直接调各个平台 facade。

建议接口形态：

```ts
preparePlayableTrack(input: SourceRef, options?: {
  qualityHint?: string;
  forceRefresh?: boolean;
}): Promise<PreparedPlayable>
```

页面层只知道：

- 我手里有一个 provider track ref
- 我想把它变成一个可播放 track

页面层不需要知道：

- 它是 Bilibili 还是 Netease
- 是否要先拿 song url
- 是否要做缓存预缓冲
- 是否要做下载等待

同时建议提供统一转换入口：

```ts
toPlaybackTrack(prepared: PreparedPlayable): Track
```

这样页面层不需要自己手工拼 `Track`。

### 后端统一语义

后端不一定要马上合并成一个单命令，但语义上应统一为：

- `prepare cached playback`

也就是说，不论底层具体命令名是否暂时不同，语义都应对齐为：

- 输入：`connectorId + sourceLocator + optional qualityHint`
- 输出：统一的 prepared playback payload

如果后续时机合适，可以再收敛成单个 Tauri 命令，例如：

```ts
music_platform_prepare_playback({ connectorId, sourceLocator, qualityHint });
```

但这不是第一步必须完成的事情。

## 与音频引擎的边界

### 当前建议边界

流媒体层只负责把“平台曲目”变成“本地可播放文件路径”。

音频引擎层只负责：

- 接收标准 `Track`
- 使用 `filePath/path`
- 做 load/play/seek/buffer/output

不要让音频引擎直接承担：

- provider 鉴权
- 平台 song url 解析
- 平台资源下载逻辑
- 平台曲目特判识别

同样，`platform magnet` 也不应直接承担音频引擎层职责，它只负责发起统一 prepare 请求与消费统一结果。

### 对 `NativeAudioService` 的要求

后续应逐步移除 `NativeAudioService` 中与单一 provider 强绑定的播放准备逻辑。

目标状态是：

- `NativeAudioService` 不认识 `Bilibili` / `Netease` 细节
- 它只接收已经准备好的标准 `Track`
- 如果确实需要兜底重准备，也应调用统一 `preparePlayableTrack` 入口，而不是直接写平台特判

## Capability 模型建议

不建议把流媒体集成定义成一个巨大的全能接口，而应拆成 capability 模块。

建议至少分成：

- `catalog`
  - 推荐、榜单、歌单、专辑、收藏夹、详情
- `search`
  - 搜索歌曲 / 资源 / 歌单 / 专辑
- `preparePlayback`
  - 把 `SourceRef` 转成 `PreparedPlayable`
- `auth`
  - 登录、状态、登出、刷新
- `metadata`
  - 歌词、封面、附加信息
- `librarySync`
  - 远程库镜像、增量同步、缓存索引

这样 provider 可以按能力增量实现，`platform magnet` 则按 capability 渲染 UI。

## 模块职责建议

### 页面 / Workspace Adapter

负责：

- 用户交互
- 展示搜索/歌单/曲目
- 调用统一播放准备入口
- 按 capability 组合统一 UI 模块

不负责：

- 直接写平台特定缓存逻辑
- 直接决定如何把平台流转成缓存文件
- 手工拼接 provider-specific `Track`

### Streaming Integration Facade

负责：

- 暴露统一 `preparePlayableTrack`
- 暴露 capability 查询与统一调用入口
- 根据 `connectorId` 分发到不同 provider adapter
- 做结果标准化
- 统一错误模型
- 统一进度与状态事件

### Provider Adapter

负责：

- provider 特有鉴权上下文
- sourceLocator 解释
- 调用 provider-specific backend prepare API
- provider 特定字段映射
- provider 特有 capability 暴露

### Backend Provider Prepare API

负责：

- token/cookie 使用
- 真实流地址获取
- 下载/缓存/预缓冲
- 返回可供播放的 `cachePath`

### Platform Magnet

负责：

- 作为统一流媒体入口 UI 壳
- 消费 capability 并组织统一页面结构
- 展示跨 provider 的聚合内容与统一播放入口

不负责：

- 直接持有 provider-specific prepare 逻辑
- 直接决定缓存策略或鉴权实现
- 承担音频引擎职责

### Audio Service / Audio Engine

负责：

- 播放标准 `Track`
- 管理队列、状态、seek、buffering、output

不负责：

- provider 差异处理
- 平台 UI 编排

## 队列与历史记录要求

后续如果平台来源进一步插件化或 provider 化，队列、历史记录、恢复播放都不能只保存 `cachePath`。

至少应保留：

- `providerId`
- `connectorId`
- `sourceLocator`
- `trackId`
- `qualityHint`
- `preparedAt`
- `cachePath`（作为临时播放产物）

原因是：

- 缓存文件可能失效
- provider 可能需要重新 prepare
- 应用重启后需要恢复逻辑来源，而不只是恢复临时文件路径

也就是说，播放队列需要区分：

- 逻辑来源身份
- 临时可播放产物

## 事件与状态模型建议

统一 UI 后，流媒体层还需要统一事件语义，而不只是同步返回结果。

建议逐步定义这些事件或状态：

- `authChanged`
- `providerHealthChanged`
- `prepareStarted`
- `prepareProgress`
- `prepareCompleted`
- `prepareFailed`
- `cacheInvalidated`
- `retrySuggested`

这样 `platform magnet` 才能做统一 loading、错误展示、重试与恢复交互。

## 插件化方向说明

当前仓库已经具备“host capability 暴露给插件调用”的基础，但还不是“provider 本身由插件提供”的完整模型。

后续如果要把平台能力逐步从 PMP 内建实现迁移到插件化实现，建议遵循下面原则：

- `platform magnet` 仍保留为统一 UI
- provider 可逐步改为插件贡献
- provider 插件通过 capability 注册自身能力
- 宿主管理权限、缓存、鉴权存储与治理

第一阶段无需马上把所有 provider 完全插件化，但接口设计应避免继续绑定内建平台实现。

## 建议迁移路径

### Phase 0 - 收口现状

- 识别当前所有直接调用 `prepareBilibiliCachedPlayback` / `prepareNeteaseCachedPlayback` 的页面入口
- 明确哪些逻辑属于页面层，哪些逻辑属于 facade 层
- 记录 `NativeAudioService` 中现有 provider 特判点
- 明确 `platform magnet` 的统一 UI 边界

### Phase 1 - 统一前端入口

- 引入 `preparePlayableTrack` 统一方法
- 页面层改为只调用统一入口
- 先保留底层 provider-specific backend 命令不动
- 引入 `toPlaybackTrack(prepared)` 统一转换

### Phase 2 - 统一 payload 与错误模型

- 收敛不同 provider 的 prepare result
- 收敛错误码与可恢复错误语义
- 统一缓存命中 / 预缓冲完成 / prepare 失败的前端处理
- 收敛 capability 与事件模型

### Phase 3 - 清理音频服务特判

- 移除 `NativeAudioService` 中单一 provider 特判
- 如需要兜底重准备，改为统一入口调用
- 让 `platform magnet` 完全基于 capability 渲染

### Phase 4 - 面向插件化演进

- 让 provider 能通过注册方式接入 stream integration
- 把内建平台实现逐步收敛为 provider 实现之一
- 保持 `platform magnet` 作为统一宿主 UI

## 当前推荐方案结论

当前最合适的方案不是让音频引擎直接吃流媒体 URL，而是：

- 保留“本地路径驱动”的原生播放核心
- 在流媒体层统一 `preparePlayback`
- 通过 `SourceRef -> PreparedPlayable -> Track` 进入播放链
- 由 `platform magnet` 统一承载 UI 与交互规范
- 由 capability 模型统一适配多种流媒体来源
- 之后统一进入现有播放主链

这样可以最小化对音频引擎的破坏，同时把真正的耦合点收口到流媒体集成层。

## 开放问题

- 第一阶段是否只统一播放准备入口，不立即统一所有 provider facade？
- 是否需要把 `PreparedPlayableTrack` 持久化到短期缓存索引中？
- 如果 `cachePath` 失效，是否允许统一入口做透明 re-prepare？
- 未来是否需要支持“非缓存落盘、直接流式播放”的第二条交接模式？
- 哪些 provider 差异必须暴露给 UI，哪些应完全封装在 adapter 内？
- `platform magnet` 是否只保留统一 UI，还是允许 provider 贡献局部扩展视图？
