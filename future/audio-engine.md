# 音频引擎设计草案

## 愿景

构建一套稳定、低延迟、可扩展的音频引擎，支持高质量播放、稳定设备切换，以及后续的 DSP、分析与可视化扩展。

## 目标

- 提升不同设备、不同格式下的播放稳定性。
- 降低启动、切歌、拖动进度条时的体感延迟。
- 为效果链、分析链、流媒体来源与云音乐库接入预留清晰扩展点。

## 当前讨论范围

- 核心播放链路架构。
- 解码器与输出后端边界。
- 缓冲、调度、时钟同步与恢复机制。
- 错误处理、容错、鲁棒性与策略层边界。

## 非目标

- 完整 DAW 级音频编辑。
- 与当前播放器无关的通用音频中间件平台化设计。

## 文件导航

### 前端入口

- `apps/desktop/src/contexts/AudioEngineContext.tsx`
  - React 上下文入口，向 UI 暴露当前音频服务。
- `apps/desktop/src/services/audio/audioModule.ts`
  - Kernel 模块装配入口，注册音频服务。
- `apps/desktop/src/services/audio/AudioEngineService.ts`
  - 引擎门面层，负责选择实际音频服务并向应用事件总线转发事件。
- `apps/desktop/src/services/audio/NativeAudioService.ts`
  - 当前前端音频主服务，承担播放控制、状态同步、策略、持久化、队列、鲁棒性聚合等大量职责。
- `apps/desktop/src/services/audio/types.ts`
  - 前端音频接口定义，当前同时承载播放、队列、播放列表、可视化等能力。

### 后端入口

- `apps/desktop/src-tauri/src/commands/audio.rs`
  - Tauri 命令层，负责把 WebView 请求转到原生音频实现。
- `apps/desktop/src-tauri/src/native_audio.rs`
  - 原生命令门面，负责 load/play/pause/seek、输出后端选择、输入选择、seek 执行器等桥接逻辑。
- `apps/desktop/src-tauri/src/audio/kernel.rs`
  - transport/kernel 层，负责 prepare load、prebuffer wait、crossfade/load 执行。
- `apps/desktop/src-tauri/src/audio/engine.rs`
  - 核心运行时与状态机，管理当前轨道、sink、streaming、buffering、恢复、policy 等状态。

### 输入 / 解码 / 输出

- `apps/desktop/src-tauri/src/audio/input/mod.rs`
  - 解码输入注册表，当前默认包含 `sacd`、`symphonia`、`rodio`。
- `apps/desktop/src-tauri/src/audio/input/symphonia.rs`
  - 主流式解码路径，包含 reservoir、render queue、全量解码预算等逻辑。
- `apps/desktop/src-tauri/src/audio/input/streaming.rs`
  - 流式 transfer worker、underrun 统计、render queue 自适应策略。
- `apps/desktop/src-tauri/src/audio/output/mod.rs`
  - 输出后端抽象层，当前支持 Windows 下的 `wasapi-exclusive`、`wasapi-shared-raw`、`wasapi`、`rodio-cpal`，并预留 ASIO。

### 监控 / 事件 / 策略辅助

- `apps/desktop/src-tauri/src/audio/emitter.rs`
  - 后端状态与频谱事件发射器，负责 tick、状态压缩、错误发射、频谱事件发射。
- `apps/desktop/src/services/audio/nativeAudioNativeListeners.ts`
  - 前端原生事件监听器，将后端 payload 合并到前端状态。
- `apps/desktop/src/services/audio/streamingBufferPolicy.ts`
  - 前端 streaming buffer 策略推导。
- `apps/desktop/src/services/audio/audioStabilityController.ts`
  - 前端动态 SRC 压力评分与退化逻辑。
- `apps/desktop/src/services/audio/audioTuningProfiles.ts`
  - 前端 tuning profile 与自动切换策略。
- `apps/desktop/src/services/audio/audioOutputFailoverController.ts`
  - 前端输出后端自动切换链逻辑。

## 当前架构判断

当前实现已经不是“简单播放器封装”，而是一套有明确原生播放内核雏形的音频运行时。

我的总体判断：

- 播放能力成熟度：中高
- 鲁棒性工程成熟度：较高
- 架构整洁度：中低
- 后续扩展性：有基础，但已经出现明显重构压力

它现在更接近下面这个形态：

- Rust 侧已经形成真实播放核心
- 前端存在一个过大的编排服务层
- 策略、调优、恢复逻辑分布在前后端两侧

## 分模块现状

### 1. 前端编排层

当前前端主轴是：

- `AudioEngineContext.tsx` -> `AudioEngineService.ts` -> `NativeAudioService.ts`

其中 `AudioEngineService.ts` 本身较薄，真正复杂度集中在 `NativeAudioService.ts`。

`NativeAudioService.ts` 当前承担的职责至少包括：

- 播放控制
- 队列维护
- 播放列表管理
- 状态缓存与 UI 同步
- 后端命令调用
- seek / volume 合并发送
- 输出后端切换
- 输入切换
- buffer policy 下发
- dynamic SRC 自动退化
- tuning auto
- robustness snapshot 汇总
- 频谱启停与可视化数据桥接
- 部分持久化恢复

这说明当前前端层并不是单纯 transport facade，而是已经混入了大量应用层和策略层逻辑。

### 2. Tauri 命令桥

`commands/audio.rs` 与 `native_audio.rs` 的职责总体清晰：

- Tauri command 暴露给前端
- 原生命令门面负责调用 engine/kernel
- seek 走单独执行器而非直接同步阻塞调用

这层的优点是边界明确，缺点是随着功能增多，门面逻辑已经开始承接越来越多运行时控制职责。

### 3. Rust transport / kernel

`audio/kernel.rs` 负责：

- 准备 sink
- 打开输入源
- 构建 mixer + DSP pipeline
- 控制 prebuffer wait
- 执行 load / load_and_play / crossfade / seek

这一层总体是健康的，说明后端内部已经具备比较清晰的 transport 执行边界。

### 4. 输入 / 解码层

当前后端并不是单一路径硬编码：

- `AudioInputRegistry` 支持多输入实现
- `symphonia` 是主力解码路径
- `sacd` 与 `rodio` 是补充输入路径
- 支持 `Streaming`、`FullTrack`、`StreamingFullTrack` 三类 decode mode

这一层是当前实现的明显优点，说明未来接入新的输入源、侧车解码器或更复杂格式时，有现成扩展点。

### 5. 输出后端层

当前输出后端抽象也比较扎实：

- 有统一 `AudioOutputBackend` trait
- 有默认后端选择逻辑
- 支持设备列表、当前设备、重建 sink、输出错误回收
- Windows 下已经考虑 exclusive / shared raw / shared / fallback 路线

这意味着当前项目在“播放器真正落地到系统设备”的这一层已经做了较强工程化处理。

### 6. 监控与事件层

当前状态与诊断能力较强：

- emitter 持续 tick 并压缩状态事件
- 可选扩展 payload
- 独立错误事件
- 频谱帧事件
- 前端 robustness snapshot 与指标聚合

这一层对后续调优、可视化和回归定位非常有价值，应保留。

## 主要问题

### 1. 引擎边界与应用边界混杂

当前 `IAudioService` 不是单纯音频引擎接口，而是同时包含：

- 播放控制
- 队列管理
- 播放列表管理
- 可视化数据访问
- 若干策略与鲁棒性接口

这会导致后续所有“音频引擎演进”都被应用层状态结构牵制，难以做干净的核心层抽象。

### 2. `NativeAudioService.ts` 过度膨胀

当前最大的结构性问题就是 `NativeAudioService.ts` 过大、职责过多。

它已经同时扮演：

- 前端 transport facade
- 应用层播放服务
- 策略协调器
- 状态聚合器
- 部分持久化恢复器
- 诊断与鲁棒性汇总器

短期内这让迭代更快，长期则会显著提高修改风险和认知负担。

### 3. 策略决策前后端分裂

当前 buffer policy、failover、dynamic SRC、tuning 等策略并没有完全沉到后端，而是前后端共同参与决策。

这会带来几个问题：

- 决策来源分散
- 状态漂移风险更高
- 调参时很难判断问题归属
- 新功能容易继续往错误位置堆逻辑

后续如果继续强化实时性和流媒体场景，这个问题会越来越明显。

### 4. 状态同步依赖事件回推与前端兜底时钟

前端当前会根据后端事件更新状态，同时在必要时启用 fallback ticker 推算当前时间。

这种方案对 UI 体验有帮助，但副作用是：

- 状态来源不再唯一
- seek、buffering、playing 之间的边界容易出现细微不一致
- 问题可能只在高频交互或极端设备条件下暴露

这不是立即要移除的能力，但后续必须明确“谁是真实时钟”。

### 5. 全局单例 + 粗粒度锁限制未来并发演进

当前 Rust 核心使用：

- 全局 `ENGINE`
- `Mutex<NativeAudioEngine>`

对于当前单播放会话桌面应用，这个模型是可工作的；但如果未来要引入：

- 更复杂的分析链
- 多会话音频任务
- 更强的插件参与度
- 更细粒度的实时控制

它会成为限制因素。

### 6. 参数与阈值较多，维护复杂度高

当前系统有大量阈值、窗口期、恢复时长、profile、backend-specific 条件。

这体现了较强的鲁棒性工程投入，但也意味着：

- 行为路径多
- 回归验证面大
- 新策略很容易和旧策略叠加出不可预期行为

后续需要把“参数存在的位置”和“参数的归属模块”进一步收敛。

### 7. API 歌曲播放准备入口未统一

当前本地歌曲与 API 歌曲最终都会汇入同一条原生播放主链，但 API 歌曲在进入主链前的“播放准备”入口并不统一。

当前已确认的现状是：

- 原生音频核心本质上仍是“绝对文件路径驱动”
- API 歌曲必须先经过播放准备、缓存落盘或路径转换，最后才能交给原生播放
- `Bilibili` 与 `Netease` 当前并没有走完全一致的前端编排路径
- `NativeAudioService.ts` 中还残留了面向单一平台来源的特殊处理

这意味着当前问题不在于“有没有统一的底层播放内核”，而在于“进入底层播放内核之前，API 来源缺少统一播放准备入口”。

这个问题应主要在流媒体集成层解决，而不是继续在音频引擎主服务中堆平台特判。

后续建议由 `stream-integration` 与 `platform magnet` 共同承担这部分职责：

- `stream-integration` 负责统一 prepare 入口与 provider 能力边界
- `platform magnet` 负责统一流媒体 UI 与交互规范
- 音频引擎与 `NativeAudioService` 仅消费标准 `Track`

## 现有优势

这些能力值得保留，不建议推倒重来：

- 前后端边界已经存在
- 解码输入抽象已经存在
- 输出后端抽象已经存在
- 流式播放与 prebuffer 机制已经存在
- sink rebuild / 设备恢复机制已经存在
- DSP graph / chain 接口已经存在
- 频谱 tap 与 emitter 已具备基础
- 诊断、状态 payload、robustness 指标较完整

也就是说，当前不是“没有引擎”，而是“已经有核心，但边界还不够干净”。

## 对下一阶段规划的含义

下一阶段不建议从零重写，而是应该：

- 保留 Rust 播放核心
- 收缩 `NativeAudioService` 的职责
- 重新定义前端 transport / policy / library 的边界
- 把未来流媒体来源与云音乐库接入放到 source/provider 层，而不是继续塞进 engine 主服务

## 建议的后续拆分方向

### Playback Core

- 只关注 load / play / pause / stop / seek / buffering / output / decode / DSP runtime

### Transport Session

- 负责前后端命令桥接、状态同步、事件协议、时钟协调

### Policy Layer

- 负责 buffer policy、dynamic SRC、tuning auto、failover、保护窗口等策略

### Library / Queue Layer

- 负责队列、播放列表、来源映射、播放上下文，而不是混在引擎核心接口里

### Analysis / Visualization Layer

- 负责 spectrum、tap、分析帧、后续可视化输入接口

### Source / Provider Layer

- 负责本地文件、流媒体 API、云音乐库、NAS 风格远程库的统一来源抽象

## 里程碑切片

### Phase 0 - 基线梳理

- 量化当前启动延迟、seek 延迟、rebuffer、设备恢复行为
- 明确 golden scenarios 与 failure cases
- 补齐引擎分层图与真实调用链图

### Phase 1 - 边界整理

- 从 `NativeAudioService` 中拆出 transport / policy / library 边界
- 缩减 `IAudioService` 的职责面
- 明确“哪些逻辑属于核心引擎，哪些属于应用层”

### Phase 2 - 能力增强

- 为流媒体来源 / 云音乐库预留 source/provider 接口
- 为可视化和分析链定义稳定输入协议
- 为后续更强 DSP / 插件化能力留出边界

## 开放问题

- 我们默认优化目标更偏极限低延迟，还是偏稳态高可靠？
- 第一阶段必须保证的格式、采样率、输出链路范围是什么？
- 哪些策略应沉到 Rust 后端，哪些保留在前端协调层？
- 队列、播放列表、来源管理是否应完全移出核心引擎接口？
- 面向未来流媒体与云音乐库时，source/provider 的统一模型应该如何定义？
