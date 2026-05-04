# Utils

## What Utils Is

`utils` 不再只是一个 plugin-platform fixture，它会逐步演进成一个偏 `SAO Utils` 气质的系统工具插件：

- 视觉上是宿主里的系统磁贴 / HUD / 快捷控制台
- 架构上是当前 extv2/plugin-platform 的综合实例
- 作用上既服务真实使用场景，也持续承担跨语言、跨进程、系统接口边界验证

它的核心定位不是“把一堆系统 API 杂糅进插件”，而是做一个边界清晰的样板：

- 宿主继续拥有 UI surface、窗口生命周期、shell surface 管理权
- `webview.main` 负责 magnet/page/overlay/widget 的 UI 渲染
- `sidecar.main` 负责 native probe、系统媒体会话、性能采集、音频 loopback 等 OS 级能力
- 不直接把 QML / native UI 当成 magnet carrier
- 真正的 Qt/QML/Rust 适配层将来挂在 sidecar 后面，而不是绕开宿主

---

## Product Direction

`utils` 的目标是成为一个“系统感知型 magnet hub”，提供以下几类能力：

1. 系统输出可视化
2. 全局媒体控制
3. 系统性能与资源状态
4. 宿主窗口 / shell surface 快捷入口
5. sidecar 健康状态与 runtime 诊断

它应该像一个常驻在桌面矩阵里的系统面板，而不是单纯的 demo 页面。

---

## Surface Map

当前和后续建议维持这 4 个宿主 surface：

- magnet: `utils`
  - 主系统磁贴，承担“概览 + 快操作”
- page: `utils-page`
  - 详细信息页，承担完整状态、历史、调试、分组设置
- overlay: `utils-overlay`
  - 召唤式快速面板，承担一屏内高频操作
- desktop-widget: `utils-widget`
  - 常驻桌面 HUD，承担低密度持续显示

建议的职责分工：

- magnet
  - 一屏可读，适合放在矩阵内
  - 只展示最关键的几组系统状态
- page
  - 详细列表、图表、调试信息、能力状态
- overlay
  - 快速唤起，偏向控制和临时查看
- desktop-widget
  - 常驻显示，如当前媒体、峰值、电量、CPU/GPU 摘要

---

## Planned Magnet Variants

当前 manifest 已有 `hub` / `compact` 两个 variant。后续建议把它收敛成更产品化的变体集：

- `hub`
  - 默认主面板
  - 聚合媒体、性能、visualizer、runtime 健康
- `visualizer`
  - 聚焦系统输出可视化
  - 强调频谱、波形、峰值和输入源状态
- `media`
  - 聚焦全局媒体控制
  - 强调封面、进度、播放状态、切歌和来源应用
- `system`
  - 聚焦系统性能
  - 强调 CPU、内存、GPU、温度、电池、网络
- `compact`
  - 仍保留，但只作为低占用 HUD 变体

也就是说，`utils` 更像一个“单插件、多变体磁贴产品”，而不是多个彼此孤立的小 demo。

---

## Planned Tiles

### 1. System Output Visualizer Tile

目标：

- 捕获默认系统输出，而不局限于 PMP 自身音频
- 用于视频播放器、浏览器、音乐播放器等任意正在发声的应用
- 在 magnet / overlay / widget 中显示实时频谱、峰值、能量条、简单波形

建议形态：

- magnet 中显示紧凑型柱状频谱
- overlay 中显示较完整的波形 + 峰值统计
- page 中显示输入源切换、采样参数、历史峰值

边界划分：

- sidecar
  - 负责系统 loopback / monitor capture
  - 负责做基础 FFT 或原始 frame 采集
- webview
  - 负责渲染频谱、波形、主题化表现
- host
  - 负责窗口 / magnet 生命周期与 surface mount

平台实现方向：

- Windows
  - WASAPI loopback
- macOS
  - CoreAudio / ScreenCaptureKit 相关音频 tap 能力
- Linux
  - PipeWire / PulseAudio monitor source

这块是 `utils` 很适合作为边界验证实例的原因之一：

- 它天然覆盖 native capture
- 会用到 sidecar 长连接与持续推流
- 会逼出 stream/session 生命周期、性能控制和清理逻辑

### 2. Global Media Control Tile

目标：

- 读取并控制系统当前媒体会话，而不只绑定 PMP 内部播放
- 覆盖视频、音乐播放器、浏览器标签页等
- 展示来源应用、标题、艺术家、封面、播放进度、播放状态

建议交互：

- play / pause
- previous / next
- seek
- source app badge
- “切回来源应用” 或 “聚焦当前播放器”

平台实现方向：

- Windows
  - Global System Media Transport Controls Session
- macOS
  - Now Playing / MediaRemote 相关桥接
- Linux
  - MPRIS

边界划分：

- sidecar
  - 负责 OS 媒体会话查询与控制
- webview
  - 负责媒体卡片 UI
- host capability
  - 如果后续平台要正式化，建议沉淀成中性的宿主 capability，而不是一直停留在 sidecar 私有 RPC

这块会成为 `utils` 最接近“真实产品功能”的一组磁贴。

### 3. System Performance Tile

目标：

- 显示系统性能，而不是只显示 PMP 自己的 runtime 状态
- 成为一个低打扰、可常驻的系统资源 HUD

建议显示项：

- CPU usage
- memory usage
- GPU load
- temperature
- battery
- disk throughput
- network up/down

建议形态：

- magnet
  - 3 到 5 个关键指标
- widget
  - 小型常驻状态条或小卡片
- page
  - 完整细分图表、采样周期和阈值设置

边界划分：

- sidecar
  - 采样系统指标
  - 管理采样频率、降采样、阈值告警
- webview
  - 图形表达、布局和主题

这块是“系统接口 + 长时采样 + 资源治理”的天然试验场。

### 4. Host Shell Quick Actions Tile

目标：

- 把 `utils-overlay` / `utils-widget` 的 summon / focus 行为做成真实操作入口
- 给出“系统工具中心”的产品感，而不是纯展示

建议动作：

- open overlay
- focus widget
- dismiss overlay
- hide widget
- 打开 `utils-page`

注意：

- 这些动作仍应走宿主命令和 shell surface manager
- 不应该让 sidecar 直接控制宿主 UI 生命周期

### 5. Runtime / Diagnostics Tile

目标：

- 保留当前 fixture 的诊断价值
- 但把它从“主内容”降级为“工程诊断卡片”

建议显示：

- current runtime kind
- sidecar pid / session id
- last probe time
- last crash reason
- last hang drill result
- visible capability count

它应该保留，但不应该继续占据 `utils` 的产品中心。

---

## Runtime Architecture

建议把 `utils` 当成一个“宿主 UI + native adapter”的标准样板：

- `webview.main`
  - 负责所有 surface UI
  - 根据当前 surface variant 决定显示哪组 tile
  - 只渲染和交互，不直接碰系统 API
- `sidecar.main`
  - 负责系统媒体、性能、音频 loopback、native probe
  - 负责 crash / hang / teardown drill
  - 后续承接真正的 QML / Qt / Rust adapter

推荐的数据流：

1. sidecar 采集原始系统状态
2. sidecar 输出结构化 snapshot / event
3. host runtime bridge 负责生命周期与协议治理
4. webview surface 负责展示与交互
5. 用户操作再通过宿主桥回流到 sidecar 或 host capability

---

## Capability Boundary

`utils` 需要继续坚持当前的边界纪律：

- 磁贴 UI 不是 native UI 直挂
- shell surface 不是 sidecar 自己创建
- 插件配置依旧走宿主 `storage.config`
- 与宿主窗口、导航、磁贴布局的交互继续走 `host.pmp.*`

当前已经可以直接利用的能力：

- `core.capability-registry`
- `host.pmp.navigation`
- `host.pmp.storage.config`
- `host.pmp.shell.window`
- `host.pmp.magnets.catalog`
- `host.pmp.magnets.layout`
- `host.pmp.magnets.renderer`

为真正产品化的 `utils`，后续建议逐步正式化这些能力方向：

- system media session
- system loopback audio stream
- system performance snapshot / stream
- richer desktop shell integration

也就是说，`utils` 既是插件，也会反向推动 platform capability 的演进。

---

## Suggested Milestones

### Milestone 1

把当前 fixture 升级成“真实系统工具壳”：

- 保留现有 page / overlay / widget / magnet
- 重做 UI 信息架构
- 把当前 diagnostics UI 收成一张卡片
- 明确 `hub` / `compact` 两个变体的视觉定位

### Milestone 2

补系统性能卡：

- CPU / memory / network 基础采样
- sidecar -> webview 状态同步
- magnet / widget / page 三层展示

### Milestone 3

补全局媒体会话卡：

- 当前播放媒体
- play / pause / next / previous
- 来源应用标识

### Milestone 4

补系统输出 visualizer：

- loopback capture
- spectrum frame streaming
- 可视化样式与性能治理

### Milestone 5

接真正的 QML / Qt / Rust adapter：

- 让 sidecar 变成多语言 native helper
- 继续复用宿主 UI lifecycle，而不是旁路

---

## Current Commands

当前保留的 sidecar drill 命令仍然有价值，建议继续保留：

- `utils.probe.system`
- `utils.probe.performance`
- `utils.probe.windows`
- `utils.probe.qt.adapter`
- `utils.simulate.hang`
- `utils.simulate.crash`

当前 `utils.probe.performance` 只做低频 command snapshot：

- sidecar 采样粗粒度 CPU 使用率、总内存 / 可用内存、sidecar 进程内存和网络接口数量
- 不返回主机名、用户名、本地路径、IP 地址或 MAC 地址
- 不启动 stream，也不打开 Qt/QML 顶层窗口
- 结果通过 `host.pmp.storage.config` 回写为 versioned envelope，webview surface 只读取宿主配置快照来渲染

`utils.probe.qt.adapter` 当前只验证 native adapter lane 的 contract artifact：

- `qt/UtilsAdapterProbe.qml` 是 `QtObject` contract，不是 UI carrier
- probe 可以检查 QML artifact 是否存在、摘要 hash 和 Qt tooling 的粗粒度可用性
- Qt/QML 若要成为正式 UI carrier，必须先进入 launcher / shell surface / runtime bridge 的宿主管理链

宿主自动注册的 shell surface summon command 也继续保留：

- `extv2:utils:shell-surface:utils-overlay:summon`
- `extv2:utils:shell-surface:utils-widget:summon`

后续建议新增一组更偏产品化的命令：

- `utils.media.playPause`
- `utils.media.next`
- `utils.media.previous`
- `utils.overlay.toggle`
- `utils.widget.focus`
- `utils.page.open`

如果这些行为需要可重绑、可发现、可被插件页展示，就继续走 command contribution。

---

## Design Summary

一句话概括：

`utils` 应该成为一个宿主管理 surface、sidecar 提供系统探针、并能够真实承接 SAO 风格系统工具体验的 magnet 插件样板。

它不是再做一个 demo 拼盘，而是做一个真正能落到产品里的“系统磁贴插件原型”。
