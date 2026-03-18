# PMP Desktop Rust 底层重构方案

> 目标：把桌面版的数据主权、播放控制权和大对象生命周期从 WebView/TypeScript 下沉到 Rust，建立可证明、可观测、可回收的内存与性能策略。

## 1. 背景与问题定义

当前 PMP 桌面版已经具备较强的 Rust 音频后端和 SQLite 音乐库能力，但从内存和性能视角看，系统仍然是“Rust 引擎 + TS 镜像状态 + WebView 资源缓存”混合架构。

这会带来三个直接后果：

1. 数据会在 Rust、TypeScript、WebView 渲染缓存之间重复驻留。
2. 页面隐藏、队列清空、切歌完成后，释放动作无法由单一所有者统一裁决。
3. 即使单个模块已经做了优化，整体仍可能因为双主权状态和桥接对象分配而失控。

用户侧的典型体感已经说明了这个问题：

- 打开音乐库后，内存持续缓慢上升。
- 切歌时出现瞬时双驻留，且旧管线释放不稳定。
- 队列从数首变成数百首后，内存增量异常。
- 清空队列、退出页面后不能稳定回到接近基线。

这不是“单个常量没调好”的问题，而是底层所有权模型仍不够收敛。

## 2. 本次审阅的核心结论

### 2.1 结论摘要

桌面版下一阶段最值得做的，不是把 React 页面直接翻成 Rust，而是把以下三类底层主权模块彻底下沉到 Rust：

1. 音乐库 read model
2. 队列 / 播放列表 / 切歌控制平面
3. 封面缓存与句柄服务

不值得直接 Rust 化的部分：

1. React 视图层
2. 页面布局与交互动画
3. 虚拟滚动本身
4. 设置页、调试页、编辑器类 UI

原因很直接：真正造成内存和性能策略不可控的，不是 UI 用了 TS，而是“大对象在哪里被持有、谁负责释放、是否存在双状态源”。

## 3. 现状证据

### 3.1 音乐库查询能力已经部分在 Rust，但前端仍保留整套后备读模型

Rust 侧已经支持分页与 list projection：

- `apps/desktop/src-tauri/src/music_library_db.rs:5525`
- `apps/desktop/src-tauri/src/music_library_db.rs:5532`
- `apps/desktop/src-tauri/src/music_library_db.rs:5952`

前端服务也已经能够调用 native base query：

- `apps/desktop/src/services/audio/MusicLibraryService.ts:1151`

但问题在于，前端仍保留完整的 IndexedDB fallback 和全量数组物化路径：

- `apps/desktop/src/services/audio/MusicLibraryService.ts:1250`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:4169`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:5198`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:5263`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:5379`

这意味着：

- 桌面版并没有真正做到 Rust/SQLite 单一权威。
- 一旦 query 规则不完全兼容 native，就会回退到 TS + IndexedDB。
- fallback 路径会重新生成大量 `Track[]`，并进入 WebView 生命周期。

### 3.2 MusicLibrary 页面仍是超大前端 orchestrator

当前页面同时维护多类长寿命状态：

- `moduleCache`
- `tracks`
- `nativeBaseTracks`
- `stableEntries`
- `filteredTracks`
- `renderedTracks`
- `groupedRows`

关键位置：

- `apps/desktop/src/components/pages/MusicLibrary.tsx:352`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:1126`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:1962`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:2042`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:2065`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:2675`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:3447`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:5180`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:5316`
- `apps/desktop/src/components/pages/MusicLibrary.tsx:5320`

虽然当前已经加入隐藏页释放和 cover policy，但页面依然承担：

1. 查询编排
2. 分页状态
3. 搜索状态
4. 视图派生
5. 模块缓存
6. 封面可见性管理

这会导致页面天然倾向形成多份驻留。

### 3.3 队列与播放列表仍然是 TS / Rust 双状态源

TypeScript 侧仍持有完整 queue / playlist state：

- `apps/desktop/src/services/audio/NativeAudioService.ts:3872`
- `apps/desktop/src/services/audio/NativeAudioService.ts:3879`
- `apps/desktop/src/services/audio/NativeAudioService.ts:3928`
- `apps/desktop/src/services/audio/NativeAudioService.ts:4233`
- `apps/desktop/src/services/audio/NativeAudioService.ts:4285`
- `apps/desktop/src/services/audio/NativeAudioService.ts:4393`
- `apps/desktop/src/services/audio/NativeAudioService.ts:4404`

同时 Rust engine 也已经维护自己的 queue / current index / empty queue release：

- `apps/desktop/src-tauri/src/native_audio.rs:1401`
- `apps/desktop/src-tauri/src/native_audio.rs:1415`
- `apps/desktop/src-tauri/src/audio/engine.rs:1912`
- `apps/desktop/src-tauri/src/audio/engine.rs:2456`
- `apps/desktop/src-tauri/src/audio/engine.rs:2467`

这会导致：

1. 队列数据存在两套所有者。
2. TS 清空与 Rust 清空存在时间差。
3. 队列 UI、播放列表 UI、Rust backend 之间容易出现镜像驻留。
4. 页面即使已经释放，TS service 仍可能保留数组。

### 3.4 封面链路仍然有一半生命周期在 JS

JS 侧维护了多种 cover runtime cache：

- `coverUrlCache`
- `coverBlobUrlCache`
- `coverDecodedEstimateBytes`

关键位置：

- `apps/desktop/src/services/audio/MusicLibraryService.ts:333`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:334`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:336`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:2284`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:2569`
- `apps/desktop/src/services/audio/MusicLibraryService.ts:2646`

当前优点是已经有：

- cover runtime policy
- 隐藏页释放
- decoded estimate 统计

但根本问题没变：

- blob URL 生命周期仍由 JS 持有
- WebView 图片解码缓存不可由 Rust 统一裁决
- 页面可见性变化和 JS cache 生命周期仍然存在耦合

### 3.5 当前桥接层仍然允许大对象同步风格扩散

`windowCommunication` 当前机制适合配置同步，不适合高频或大 payload：

- `apps/desktop/src/utils/windowCommunication.ts:356`

其实现仍然是：

1. `writeJson(storageKey, data, { mode: 'sync' })`
2. 当前窗口事件
3. BroadcastChannel
4. Tauri event

这类机制适合：

- 轻量配置
- 开关状态
- 简单通知

不适合：

- 大列表
- 高频队列变化
- 多窗口长数组同步

虽然当前音频 state payload 已经开始主动压缩 queue：

- `apps/desktop/src-tauri/src/native_audio.rs:1333`

但系统层面仍缺少“禁止大对象进入通用同步总线”的硬规则。

## 4. 为什么要做 Rust 下沉

### 4.1 Rust 化真正能解决的问题

Rust 化并不天然等于更省内存，但在桌面版里，它可以解决三个 TS 很难从根上解决的问题：

1. 单一所有权
2. 明确释放点
3. 桥接最小化

只要队列、播放列表、音乐库查询结果、封面句柄都由 Rust 持有，WebView 只拿 view model 或句柄，那么：

- 清空队列时可以由 Rust 原子释放完整控制平面
- 切歌时可以由 Rust 统一决定旧管线 retire 和 playlist hydration 生命周期
- 页面隐藏时可以由 Rust + WebView 协议一起收缩资源，而不是依赖 TS 多点清理

### 4.2 Rust 化不能直接解决的问题

Rust 不会自动解决：

- DOM 渲染缓存
- 图片解码缓存
- WebGL context
- React 组件树层级复杂度

所以正确姿势不是“把页面改成 Rust”，而是：

- 数据下沉到 Rust
- 页面只消费最小投影和句柄
- JS 负责可见区渲染，不负责大对象长期持有

## 5. 重构目标

## 5.1 顶层目标

建立桌面版新的三层主权模型：

1. Rust 持有 domain state
2. TS 持有 UI state
3. WebView 只持有当前可见资源

## 5.2 强约束

桌面版重构后必须满足：

1. 本地音乐库桌面版只使用 Rust/SQLite 作为权威数据源
2. 队列、播放列表、当前播放索引只允许一个 authoritative owner
3. 前端页面不保存完整播放队列和 hydrated playlist 副本
4. 封面只允许句柄式访问，不允许页面长期持有 blob URL 缓存
5. 大对象不得经过 `localStorage + JSON.stringify` 风格的通用总线

## 6. 目标架构

```text
React UI
  -> Thin ViewModel Hooks
    -> Typed Desktop Bridge
      -> Rust Domain Services
         - Library Read Model
         - Playback Control Plane
         - Playlist Store
         - Cover Lease Service
         - Perf / Memory Telemetry
      -> SQLite / FS / Audio Engine / OS resources
```

### 6.1 Library Read Model

Rust 负责：

- query DSL 执行
- projection
- 分页
- 搜索
- album / artist / genre 聚合
- stats 聚合
- playlist item page query

TS 只负责：

- 当前查询条件
- 当前分页游标
- 当前渲染窗口

### 6.2 Playback Control Plane

Rust 负责：

- queue entries
- current index
- playlist runtime hydration
- track switch lifecycle
- old pipeline retire
- clear queue release

TS 只负责：

- 当前展示的 queue summary page
- 当前选中项
- 轻量命令发起

### 6.3 Cover Lease Service

Rust 负责：

- cover extract / resize / cache
- handle 生命周期
- 文件缓存与淘汰
- 统计信息

TS 只负责：

- 请求 `coverHandle`
- 在 `<img src="pmp://cover/...">` 中显示
- 可见性变化时报告 lease touch / release

## 7. 详细重构方案

## 7.1 方案 A：桌面版音乐库 read model 完全下沉到 Rust

### 目标

消灭桌面版 `MusicLibraryService` 中对 IndexedDB 的核心依赖，把其角色降为：

1. bridge facade
2. UI projection adapter
3. web build fallback provider

### 具体动作

1. 让桌面版 `getAllTracks/searchTracks/getTracksByAlbum/getAllAlbums/getLibraryStats` 默认只走 native。
2. 保留 IndexedDB 逻辑，但只在非 Tauri runtime 编译路径或 web build 下启用。
3. 继续扩展 Rust query DSL，消灭当前 `shouldUseNativeBaseQuery === false` 时的前端 fallback 过滤。
4. 把 group / sort / filter 能力补齐到 Rust 端，缩小 `applyMusicLibraryBaseQuery(tracks, ...)` 的使用面。
5. 对桌面版返回统一的 list projection，不允许无意返回 full track payload。

### 预期收益

- 大型曲库页不再在 TS 中保留全量 `Track[]`
- 搜索和过滤由 SQLite/Rust 完成，减少 JS heap 峰值
- 页面切换和隐藏时只需释放 view model，不需要释放大数组

### 预期内存收益

高置信收益：

- 大曲库页峰值内存显著下降
- 搜索结果页不再形成大批 `Track[]` 驻留

估计区间：

- 中大型曲库下可减少 50 MB 到 200 MB 的 WebView 侧对象驻留风险

## 7.2 方案 B：队列与播放列表控制平面下沉到 Rust

### 目标

把 queue / playlist 从“TS 镜像 + Rust engine”改成“Rust authoritative + TS summary view”。

### 具体动作

1. Rust 新增 queue store 与 playlist runtime store。
2. TS 不再长期保存 `queue: Track[]`，改为：
   - `queueCount`
   - `currentIndex`
   - `currentTrackSummary`
   - `queuePage(offset, limit)`
3. TS 不再长期保存 `playlist.tracks`，改为：
   - `playlistSummary[]`
   - `playlistTrackPage(playlistId, offset, limit)`
   - `playlistTrackCount`
4. `playPlaylist/addPlaylistToQueue` 改为 Rust 内部按 playlist item IDs 直接操作，不把整份 `Track[]` 先搬进 TS。
5. `clearQueue` 变成 Rust 原子命令，同时释放：
   - queue store
   - current playlist runtime
   - detached playback runtime
   - 相关 retire tasks

### 预期收益

- 队列和播放列表不再在 TS 与 Rust 双驻留
- 切歌释放可由单一控制平面统一处理
- 调试指标更可信，减少“究竟谁还持有数据”的不确定性

### 预期内存收益

中高置信收益：

- 队列 200 首引发的大幅 WebView 增长应显著收敛
- hydrated playlist 和 queue 重叠驻留会下降

估计区间：

- 普通队列/播放列表场景下减少 20 MB 到 80 MB 的 TS 驻留和桥接分配
- 对极端切歌与 playlist 打开场景，收益更大

## 7.3 方案 C：封面服务下沉为 Rust 句柄服务

### 目标

将当前 JS 管理的 cover blob/LRU 迁移为 Rust cover lease service。

### 具体动作

1. 统一封面访问协议：
   - `pmp://cover/<cover_key>?edge=96`
2. 前端不再创建 blob URL 作为主路径。
3. `MusicLibraryService` 不再长期维护：
   - `coverUrlCache`
   - `coverBlobUrlCache`
   - `albumCoverUrlCache`
4. Rust 负责：
   - resize
   - cache hit/miss
   - cache prune
   - variant 管理
   - TTL / lease
5. 设置页的“封面缩略图质量”直接映射到 Rust cover variant policy，成为后端 resize/caching 规则，而不是前端 hint。

### 预期收益

- JS blob URL 大幅减少
- 封面生命周期与页面生命周期解耦
- 可把不同质量档位做成稳定缓存策略

### 预期内存收益

高置信收益：

- 音乐库封面页峰值和隐藏页残留会下降
- WebView 私有提交的上涨速度会更可控

估计区间：

- 视封面数量和尺寸而定，典型可减少 20 MB 到 100 MB 的前端缓存压力

## 7.4 方案 D：桌面版禁用大对象通用同步总线

### 目标

把 `windowCommunication` 从“泛用数据同步机制”收缩成“轻量配置同步机制”。

### 具体动作

1. 规定 `broadcastDataUpdate` 只允许轻量配置 payload。
2. 队列、playlist、曲库结果禁止进入该通道。
3. 跨窗口大对象同步改为：
   - 事件通知
   - Rust 查询
   - handle + snapshot id
4. 增加 payload budget 守卫，例如超过 64 KB 直接拒绝进入通用同步通道。

### 预期收益

- 避免 `localStorage + JSON.stringify` 带来的同步卡顿
- 降低偶发的桥接峰值分配
- 让配置同步与数据同步彻底解耦

## 8. 不建议直接 Rust 化的内容

以下内容不建议作为本次底层重构重点：

1. `MusicLibrary.tsx` 的 UI 结构本身
2. React 组件拆分本身
3. CSS 和动画层
4. 调试面板 UI
5. 设置页 UI

原因：

- 这些改动复杂度高
- 对内存策略上限帮助有限
- 容易把架构问题误做成语言迁移问题

正确方式是先把数据与资源主权移走，再视需要对 UI 做二次瘦身。

## 9. 分阶段实施计划

## Phase 0：基线与约束固化

### 目标

建立统一的验收指标，避免“改完觉得更好但无法证明”。

### 工作项

1. 固化场景基线：
   - 启动 idle
   - 播放单曲
   - recent playlist 208 首
   - 打开音乐库卡片视图
   - 连续切歌 20 次
   - 清空队列 / 隐藏页面
2. Debug 指标固定采集：
   - WebView2 private bytes
   - tree private bytes
   - queue approxJsonBytes
   - playlist overlap diagnostics
   - cover runtime stats
   - retire pending tasks

### 交付

- 基线表
- 压测场景脚本
- 回归对照模板

## Phase 1：桌面版数据层分叉

### 目标

明确 desktop / web 的数据层边界。

### 工作项

1. 建立 `DesktopMusicLibraryGateway`
2. 建立 `WebMusicLibraryGateway`
3. `MusicLibraryService` 退化为 facade
4. 桌面版默认不走 IndexedDB 主路径

### 风险

- web/desktop 行为分叉增加维护成本

### 风险控制

- 统一接口定义
- desktop/web 各自集成测试

## Phase 2：Rust query DSL 补齐

### 目标

消灭前端 base query fallback。

### 工作项

1. Rust 扩充 filter / group / sort 覆盖率
2. TS 中 `applyMusicLibraryBaseQuery` 仅保留 web build
3. 桌面版分页与投影统一改走 native

### 风险

- SQL 复杂度提高
- 查询计划可能退化

### 风险控制

- query explain
- SQL index review
- 大曲库压力测试

## Phase 3：Rust queue / playlist control plane

### 目标

让播放状态只有一个 authoritative owner。

### 工作项

1. 新建 Rust queue store
2. 新建 Rust playlist runtime store
3. TS state 改为 summary + paged query
4. 切歌/清队列/切 playlist 的释放全部由 Rust 原子处理

### 风险

- 前端大量调用点需要迁移
- 旧插件接口可能依赖 `Track[]`

### 风险控制

- 保留兼容层一段时间
- 对外先提供 summary API

## Phase 4：Rust cover lease service

### 目标

从 JS blob URL 迁移到 Rust 句柄服务。

### 工作项

1. 新建 cover lease / touch / release API
2. 统一 `pmp://cover` 句柄协议
3. 设置页“封面缩略图质量”接入 Rust variant policy
4. JS 侧删掉 blob URL 主缓存路径

### 风险

- 图片加载失败时用户感知明显
- 协议层 bug 容易造成封面全失效

### 风险控制

- 双路径灰度
- 失败时回退到占位图
- debug 页面显示 cover lease 状态

## Phase 5：移除桌面端 IndexedDB 主读路径

### 目标

桌面版正式进入 Rust 单一权威数据模式。

### 工作项

1. 桌面端 `getAllTracks/searchTracks/getTracksByAlbum/getAllAlbums/getLibraryStats` 不再使用 IndexedDB fallback
2. 仅保留导入缓存或 web build fallback
3. 删除桌面路径上的 moduleCache 大数组策略，改为 query-page cache

### 风险

- 迁移不完整会导致局部页面空白

### 风险控制

- 每个页面先切换到 gateway
- 跑全链路 smoke test

## 10. 性能与内存优化分析

## 10.1 可量化收益

### A. WebView JS heap 下降

来源：

- 不再长期保存大 `Track[]`
- queue / playlist 不再双驻留
- 搜索结果和 album 查询不再全量物化到 TS

### B. WebView private bytes 峰值下降

来源：

- blob URL cache 迁出 JS
- 隐藏页后可更快收缩封面资源
- 视图只持有可见页数据

### C. 切歌时瞬时双驻留下降

来源：

- Rust control plane 单一所有者
- old pipeline retire 与 queue state 同处一个域
- TS 不再额外保存整份 queue/playlist 数据

### D. 释放可预测性提升

来源：

- clear queue 变成 Rust 原子释放
- playlist hydration 生命周期集中化
- 页面隐藏只清 view model，不再承担数据主释放责任

## 10.2 预计收益范围

以下为工程估计，不是承诺值：

| 场景 | 预计收益 |
|---|---|
| 大曲库音乐库页 | 50 MB - 200 MB WebView 侧峰值下降 |
| 200 首以上队列/playlist | 20 MB - 80 MB 状态与桥接分配下降 |
| 封面密集卡片页 | 20 MB - 100 MB 前端缓存压力下降 |
| 连续切歌 | 峰值更低，回落更快，残留更少 |

## 11. 关键风险

## 11.1 架构复杂度上升

Rust domain layer 变厚后，调试门槛会上升。

应对：

- 把 bridge contract 文档化
- 对每个 command 定义 payload 上限与语义
- 增加 snapshot/debug command

## 11.2 UI 调用点改动面大

Queue、playlist、music library 都会涉及页面与 hooks 调整。

应对：

- 先建立 facade，不一次性改完所有调用点
- 逐页迁移

## 11.3 插件与扩展能力兼容风险

如果插件 API 默认暴露完整 `Track[]`，Rust 化后需要提供兼容摘要接口。

应对：

- 插件 API 分层：summary API / detail API
- 旧接口保留过渡期

## 11.4 查询能力补齐难度

前端当前有些灵活规则可能未完全映射到 SQL。

应对：

- 先覆盖高频查询
- 保留仅 web build fallback
- 桌面版上禁止进入昂贵 fallback

## 11.5 封面协议重构风险

封面系统一旦重构失败，用户感知会非常明显。

应对：

- 灰度切换
- 保留 fallback icon
- 增加 cover diagnostics

## 12. 验收标准

重构完成后至少应满足以下指标：

### 12.1 内存目标

1. 启动 idle 稳定值接近当前基线，不因新架构显著上升
2. 打开音乐库后，页面隐藏或退出后能稳定回落到接近基线
3. 清空队列后，不应继续长期保留 queue/playlist 级对象驻留
4. recent playlist / 大队列场景的增量应显著低于现状

### 12.2 行为目标

1. 切歌不出现持续堆积
2. 清空队列时 Rust 和 TS 状态一致
3. 页面隐藏后相关资源及时释放
4. 设置页“封面缩略图质量”能真实改变后端封面变体与缓存策略

### 12.3 可观测性目标

Debug 面板必须能明确区分：

1. queue / playlist 逻辑体积
2. WebView2 private bytes
3. cover runtime stats
4. retire pending tasks
5. 当前 native queue / playlist summary

## 13. 推荐执行顺序

建议按以下顺序推进，而不是并行大改：

1. Phase 0：基线与指标固定
2. Phase 1：desktop/web 数据层分叉
3. Phase 2：Rust query DSL 补齐
4. Phase 3：Rust queue / playlist control plane
5. Phase 4：Rust cover lease service
6. Phase 5：移除桌面端 IndexedDB 主读路径

原因：

- 先把观测和边界确定，再改底层
- 先改 read model，再改 control plane，最后改资源服务
- 每一步都能单独验证收益和回归

## 14. 最终判断

本次重构值得做，而且从底层收益看，优先级很高。

但必须明确：

- 不是“把 TS 文件换成 Rust 文件”就会更好
- 真正应该 Rust 化的是 authoritative data/control/resource ownership
- 真正不该 Rust 化的是页面渲染与交互表现层

如果按照本方案推进，PMP 桌面版可以从“多层镜像状态、靠经验释放”升级到“Rust 单一权威、TS 轻视图模型、WebView 仅保留可见资源”的架构。这才是内存策略和性能策略真正可持续、可证明的方向。
