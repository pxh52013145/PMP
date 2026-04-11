# Plugin Platform Phases

更新时间：2026-04-09  
原则：**源码与类型定义优先**。本文件只负责插件平台的阶段推进、进度判断、退出信号与验收基线。

配套文档：

- `documents/plugin-platform.md`：架构设计、稳定边界、长期演进方向
- `documents/plugin-platform-preflight.md`：正式扩面前的日志 / 性能 / 共享观测前置完善

---

## 0) 文档定位

### 0.1 Phase 文档职责

这份文档只承担这些职责：

- 跟踪当前阶段推进状态
- 明确下一步主优先级
- 给出每个 phase / subphase 的退出信号
- 固化自动化与真机手烟基线
- 统一 demo 插件口径与关键代码入口

### 0.2 V1 北极星与当前约束

V1 仍然围绕这句话推进：

> 让一个第三方插件，稳定地创建一个**受宿主管理**的桌面 `overlay` 或 `desktop-widget`，并通过统一 capability 协议拿到少量原生能力；插件崩溃、撤权、禁用时，宿主能完整回收。

V1 的约束不变：

- 优先收口统一 activation/runtime manager
- 新 surface 只先落 `overlay / desktop-widget`
- 高权限原生路径只先开放 `native-sidecar.process`
- 原则不变：**宿主掌握表面，sidecar 提供能力**

### 0.3 当前推进优先级

1. **收口 activation/lifecycle parity**  
   把 `onStartup / onCommand / onView / onCapability / onHost / onFile` 与 `restart / disable / unresponsive / deny / revoke` 纳入统一 extv2 manager。
2. **前移 Minimal Tracer，先消灭 native 联调黑箱**  
   至少先打通 `control` 通道，并可观察 `invoke / revoke / crash cleanup / timeout` 时间线；不再把 Tracer 埋到性能 phase 末尾。
3. **补真机手烟，不继续堆抽象**  
   优先跑 `view-surface-demo` 的五类 surface，再跑 `sidecar-capability-demo` 的安装 -> 命令执行闭环。
4. **把 shell surface 提前拆成 2.5a / 2.5b，并与 sidecar 加固并行**  
   `2.5a` 先只做 `overlay / desktop-widget` 的最小 `ShellSurfaceManager` 骨架；`2.5b` 再补多屏、DPI、`Win + D`、睡眠恢复与热插拔强化。
5. **提前插入一个极薄的 `navigation` convergence 样板**  
   在 Phase 3 正式 builtin convergence 之前，先验证 builtin 与 plugin 是否真能共享同一 capability handler / audit / policy 语义。
6. **native adapter contract 后置，不抢 V1 主闭环**  
   QML/C++ 等 adapter contract 继续保留，但不应抢在 activation/lifecycle、Minimal Tracer、shell surface 最小闭环与 sidecar failure-path 治理之前扩面。

---

## 1) 当前开发进度总览

| 主题 | 状态 | 说明 |
| --- | --- | --- |
| Runtime resolver / launcher registry | 已完成 | 已成为真实入口，PMPM 与 extv2 都已统一走 resolver |
| Manifest v2 installer/store | 已完成 | 安装、持久化、卸载、restart/audit 已进入主路径 |
| `pxp.extension-host.worker` command runtime | 已完成 | command surface 已可走 worker runtime |
| `pxp.webview.host-frame` view runtime | 已完成 | `settings/page/window/visualizer/magnet` 五类 surface 已接线 |
| `activationEvents` | 部分完成 | `onStartup / onCommand / onView` 已落地，`onCapability / onHost / onFile` 未收口 |
| 统一 extv2 activation/runtime manager | 部分完成 | 初版已接入 restart token、activation assert、runtime resolve、startup runtime sync、command path、view host 接入 |
| `pxp.sidecar.native-process` bridge | 部分完成 | 桥接已接线，具备最小 command 闭环，待上线级加固 |
| 真机手烟 | 未完成 | 仍需优先补 `view-surface-demo` 五类 surface 与 `sidecar-capability-demo` 闭环 |
| Minimal Tracer | 未启动 | 需前移到 native-sidecar 大规模真机联调之前，至少覆盖 `control` 通道与 `invoke/revoke/crash cleanup` 时间线 |
| Shell surface foundation | 未启动 | 需拆成 `2.5a` 最小 `overlay / desktop-widget` 骨架与 `2.5b` 多屏/DPI/`Win + D`/睡眠恢复强化 |
| Native polyglot adapter contract | 未启动 | QML/C++ 等仍无正式 adapter contract |
| Builtin convergence（首块建议 `navigation`） | 未启动 | 应先以前置薄样板插针，再进入 Phase 3 正式 convergence |

当前结论：

- `manifest-v2 + resolver + worker command + host-frame view` 已经构成真正主线，不再只是规划。
- 当前最关键缺口不是再补抽象，而是把 activation/lifecycle、真机手烟、sidecar 上线级治理补成闭环。
- `overlay / desktop-widget` 的最小 `ShellSurfaceManager` 骨架与 Minimal Tracer 需要前移到 sidecar 加固阶段并行推进，不能等到 Phase 2.7 再补。
- native adapter contract 与更广 surface taxonomy 继续后置，避免 V1 被抽象扩面拖住。

---

## 2) 当前代码状态

### 2.1 已完成（可运行 / 可测）

- **Phase 1**：runtime resolver / launcher registry 已成为真实入口；现有 PMPM 插件的 view/command surfaces 与 manifest-v2 的 command/view surfaces 都已统一走 resolver，并在 settings 面板可观测。
- **Manifest v2 installer/store**：宿主已可安装 `manifest.v2.json`，并持久化安装记录、resolved artifacts、capability deny 状态、基础治理审计。
- **Native manifest-v2 command runtime**：`pxp.extension-host.worker` 已进入 command surface 的 resolver/runtime 路径；worker 路径已接上 `entryUrl` + Tauri asset scope，可完成 command + config round-trip。
- **Native manifest-v2 view runtime（webview host-frame）**：`pxp.webview.host-frame` 已接入 `settings/page/window/visualizer/magnet` 五类长生命周期 surface；`InstalledExtensionSurfaceHost`、window/page/visualizer host、magnet renderer 注册链与 `view-surface-demo` fixture 已落地。
- **`host.pmp.*` 能力目录**：host capability registry + host pack descriptor 已在宿主侧成型并有测试覆盖。
- **Phase 2（compat carrier）**：capability protocol 在 compat carrier 上已有首版闭环：invoke、session open/close、stream open/data/end、cancel/dispose cleanup。
- **治理服务统一化**：`GovernanceService` 与 runtime restart supervisor 已抽象到 host-extension 级别，PMPM 与 manifest-v2 已可共用 restart 请求与审计入口。

### 2.2 部分完成（主线已接线，但尚未闭环）

- **`activationEvents`**：`onCommand` / `onView` / `onStartup` 已进入 manifest-v2 的真实运行链路，并有测试覆盖；但 `onCapability` / `onHost` / `onFile` 与统一 lifecycle governance 仍未收口。
- **统一 extv2 activation/runtime manager**：当前工作树已存在初版 manager，已覆盖 restart token、activation assert、runtime resolve、startup runtime sync、command execution path、view host 接入；但 `disable / unresponsive / deny / revoke` 仍未完全纳入同一条治理链。
- **Sidecar/native-process bridge**：`pxp.sidecar.native-process` 已接入 resolver/runtime、Tauri 前端桥接与 Rust `sidecar_bridge`，具备最小 command 闭环与测试基线；但仍是“桥接已接线，待上线级加固”。
- **Host-frame view runtime 的协议复用**：host-frame 已经可挂载长生命周期 surface，但还没有像 command lanes 一样完整复用 invoke/session/stream transport。

### 2.3 仍缺口（阻塞 V1 与 SAO 类插件能力的关键项）

- **activation/lifecycle parity 收口**  
  仍缺一个真正统一的 extv2 activation/runtime manager。
- **sidecar/native-process 上线级加固**  
  仍缺真机手烟、签名/信任门槛、平台分发约束、异常恢复与 quarantine 策略。
- **Minimal Tracer**  
  仍缺 sidecar/native 联调前的最小抓包与时间线能力，当前调用链仍然容易黑箱化。
- **shell surface foundation**  
  仍缺 `2.5a` 最小 `overlay / desktop-widget` 骨架与 `2.5b` 多屏/DPI/`Win + D`/睡眠恢复强化两阶段设计。
- **native polyglot adapter contract**  
  还没有让 QML/C++、Rust、C#、Python 等原生实现通过同一协议接入的正式 contract。
- **performance/data-plane baseline**  
  高刷动画、实时频谱、低延迟召唤的性能预算与 data plane 边界尚未固化。
- **Builtin convergence 样板**  
  至少 1 个领域仍需从私有 service shortcut 收口到 capability handler，且建议先插一个薄的 `navigation` 样板再进入 Phase 3 正式 convergence。

---

## 3) Phase 路线图

### 3.1 Phase 0：边界冻结与债务清点

状态：已完成

退出信号：

- contracts 分层明确
- compat vs platform vs builtin debt 的边界形成共识

交付物：

- 架构设计主线稳定到 `documents/plugin-platform.md`
- compat / platform / builtin 的术语边界不再混写

### 3.2 Phase 1：resolver / launcher 成为真实入口

状态：已完成

退出信号：

- surfaces 统一走 resolver
- compat inline/sandbox launcher 可用且可观测
- `pxp.webview.host-frame` 已 `available` 并由 `view-surface-demo` 覆盖非 compat view surface 样例

自动化基线：

- `pluginRuntimeResolver.test.ts`
- `viewSurfaceDemoFixture.test.ts`

手烟基线：

- settings 面板可看到 runtime resolution / launcher
- `view-surface-demo` 安装后可命中 `pxp.webview.host-frame`

### 3.3 Phase 2：capability protocol 成为主交互层

状态：进行中

总要求：

- 新增 runtime / carrier / surface 能力时，默认优先接入统一治理链
- 不再继续扩 fat host object API
- 不允许绕过 `runtime.* / capability.* / governance.*` 主链做野生旁路
- native-sidecar 大规模真机联调前，至少具备 Minimal Tracer；shell surface 先做最小骨架，再做复杂环境强化
- 关键 subphase 必须定义进入条件与冻结条件；命中冻结条件后暂停加新能力，优先回修治理链

#### 3.3.1 Phase 2.0：compat carrier 协议闭环

状态：已完成

退出信号：

- invoke/session/stream/cancel/dispose 已在 compat carrier 上闭环

自动化基线：

- `pmpmCompatCapabilityTransport.test.ts`
- `pmpmCompatContracts.test.ts`
- `pmpmRuntimeBridgeSnapshot.test.ts`

手烟基线：

- `stream-protocol-demo` 可完成 stream/session/cancel/dispose + crash cleanup

#### 3.3.2 Phase 2.1：direct registry path 的权限策略与治理收口

状态：部分完成

已完成：

- `host.listCapabilities / host.invokeCapability` 基础权限边界与 registry 路径

未完成：

- legacy facade vs generic invoke 分层
- live deny / revoke 恢复路径
- extv2 各 runtime 的一致治理收口

退出信号：

- direct invoke 路径与 legacy facade 分层明确
- deny / revoke 后可看到宿主侧恢复与 cleanup 行为
- capability policy 进入统一 audit / telemetry 链

自动化基线：

- `hostPmpCapabilities.test.ts`
- `extensions.test.ts`

手烟基线：

- 人工 deny 后再次 invoke，宿主与插件两侧均能看到一致错误
- revoke 后能观察到资源释放与治理记录

#### 3.3.3 Phase 2.1a：`navigation` convergence 薄样板

状态：未启动

定位：

- 这是 Phase 3 正式 builtin convergence 之前的前置插针，不替代 Phase 3。

目标：

- 用最小 `navigation` capability 样板验证 builtin 与 plugin 是否真能共享同一 handler / audit / policy 语义
- 尽早发现 capability contract 是否仍然偷偷依赖 builtin 私有 shortcut

退出信号：

- 至少 1 条 `navigation` 调用由 builtin 与 plugin 共走同一 capability handler / contract 路径
- audit / telemetry / deny path 字段可复用，不再出现 builtin 与 plugin 各自漂移的命名

自动化基线：

- 复用 `hostPmpCapabilities.test.ts` 扩充 `navigation` contract case
- 待补 1 组 builtin/plugin 共用 handler fixture

手烟基线：

- builtin 触发与 plugin invoke 至少各跑 1 次 `navigation` 调用，并确认宿主侧 audit / policy / rollback 语义一致

#### 3.3.4 Phase 2.2：worker carrier 复用协议

状态：部分完成

已完成：

- `pxp.extension-host.worker` 已可用于 manifest-v2 command surface

未完成：

- session/stream 与非 command surface 的长期规范复用

退出信号：

- worker 路径至少覆盖 1 个非 command 生命周期事件
- `runtime.*` 与 `capability.*` 语义不再只为 command lane 服务

自动化基线：

- `runtime/extensionStartupRuntime.test.ts`
- `runtime/extensionCommandRuntime.test.ts`
- `startupWorkerDemoFixture.test.ts`

手烟基线：

- 安装 command demo 后可真实执行命令并回收 runtime
- startup 路径可触发并记录 activation reason

#### 3.3.5 Phase 2.3：generic webview host-frame

状态：已完成，待真机手烟补证

已完成：

- `pxp.webview.host-frame` 已接入 manifest-v2 的五类 long-lived view surfaces

待补证：

- 真机安装 -> `settings/page/window/visualizer/magnet` 五类 surface 的手烟

退出信号：

- 五类 surface 均能完成 install -> mount -> unmount -> cleanup
- host-frame 路径复用统一治理链，不再是 view 特判

自动化基线：

- `viewSurfaceDemoFixture.test.ts`
- `pluginRuntimeResolver.test.ts`

手烟基线：

- `view-surface-demo/manifest.v2.json`
- 五类 surface 逐个完成挂载、关闭、重开、禁用、卸载

#### 3.3.6 Phase 2.4a：Minimal Tracer

状态：未启动

定位：

- 这是 native-sidecar 大规模真机联调的前置能力，不等同于完整版 `Protocol Tracer / Profiler`。

目标：

- 先只打通 `control` 通道的 tracing
- 能按 `runtime.* / capability.* / governance.*` 观察最小时间线
- 至少可视化 `invoke / revoke / crash cleanup / timeout / unresponsive`

退出信号：

- `control` 通道至少能关联 `requestId / runtimeInstanceId / pluginId / traceId`
- 能看到 `invoke -> response/error`、`governance.revoke -> cleanup`、`crash -> forced teardown` 时间线
- tracing 本身不要求先覆盖高频数据面，但不能污染主控制链的协议语义

自动化基线：

- 待补 tracer envelope / timeline snapshot tests

手烟基线：

- 用 `sidecar-capability-demo` 至少观察 1 次 `invoke`、1 次 `revoke`、1 次 `crash cleanup` 的 `control` 时间线

#### 3.3.7 Phase 2.4b：sidecar/native-process（多语言）MVP

状态：部分完成，待上线级加固

进入条件：

- Phase 2.1 的 deny / revoke 宿主恢复链已可观察
- Phase 2.3 的五类 host-frame surface 至少完成 1 轮 install -> mount -> cleanup 手烟
- Phase 2.4a 的 Minimal Tracer 已能观察 `control` 时间线

冻结条件：

- crash cleanup 不稳定，无法持续复现一致回收
- orphan process / OS 级资源无法稳定回收
- 宿主退出后仍遗留 sidecar 子进程、系统钩子或共享资源
- 签名校验、artifact block path 或 quarantine 规则可被绕过

最小退出信号：

- `pxp.sidecar.native-process` launcher `available`
- runtime bridge hello/init/activate
- 至少 1 个 capability invoke
- 至少 1 条 data plane 边界明确
- 安装期 artifact resolution 跑通，并把匹配产物固化到 `resolvedArtifacts`
- OS 级进程治理可验证：Windows `Job Object` / macOS/Linux `process group`
- 签名无效或 digest 不匹配时，宿主必须拒绝启动并产生 audit 记录
- 当前 `os/arch/libc/abi` 无匹配 artifact 时，resolver 必须返回 blocked，不允许 runtime fallback
- hello 成功但 activate 卡死时，必须进入 `unresponsive -> forced teardown`
- quarantine 后默认禁止自动重启，只允许显式解除 quarantine 后手动恢复

当前状态：

- **已完成**：resolver 命中、launcher available、Tauri `invoke/listen`、Rust `sidecar_bridge`、host runtime session 复用统一 bridge、测试覆盖 hello/init/activate 与 capability/config/crash cleanup
- **未完成**：真机 `sidecar-capability-demo` 手烟、签名/信任/平台分发约束、安装期 artifact resolution、统一 lifecycle governance parity、OS 级进程回收、上线级异常恢复

自动化基线：

- `runtime/tauriSidecarPortController.test.ts`
- `pmpmRuntimeBridgeSnapshot.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml sidecar_bridge`

手烟基线：

- `sidecar-capability-demo/manifest.v2.json`
- install -> runtime resolution -> command execute -> cleanup
- stream/session 打开后强制 crash，验证 cleanup 与审计
- 验证安装期 artifact resolution：当前机器命中的 `os/arch` 产物写入 `resolvedArtifacts`
- 签名无效 / digest 不匹配时必须被阻止启动，并产生审计
- 当前机器无匹配 `os/arch/libc/abi` 产物时必须 blocked，且不可回退到其他 artifact
- hello 成功但 activate 超时时必须进入 `unresponsive -> forced teardown`
- quarantine 后验证不会自动重启，需显式解除后才允许手动恢复
- Windows 至少补 1 轮 `Job Object` orphan cleanup / 强杀回收手烟；macOS/Linux 至少补 1 轮 `process group` teardown 手烟

#### 3.3.8 Phase 2.5a：shell surface foundation（最小骨架）

状态：未启动

V1 目标：

- 只新增 `overlay / desktop-widget`
- 宿主具备 `ShellSurfaceManager`
- 焦点、Escape、z-order、placement、pointer policy 先有统一最小规则
- 宿主掌握表面，插件通过受管 surface mount 协议接入，而不是自己创建野生原生窗口

执行位置：

- 这一阶段与 Phase 2.4b 并行推进，不等 sidecar 全部加固结束后再开工。

进入条件：

- 统一 extv2 manager 已能处理 `disable / revoke / unresponsive`
- Phase 2.4a 的 Minimal Tracer 已可观察 mount / revoke / cleanup 主时间线

冻结条件：

- revoke 后 surface 仍残留可见或仍持有输入焦点
- disable / uninstall / crash 任一路径无法稳定触发 dismiss / cleanup
- pointer policy / Escape / focus 语义在相同场景下不一致

退出信号：

- `overlay / desktop-widget` 至少各有 1 条受管挂载路径
- summon -> focus -> revoke -> dismiss -> cleanup 全链路进入统一治理
- 插件无法借该 contract 私自创建不受管顶层 UI

自动化基线：

- 待补 shell-surface contract / mount / cleanup 最小测试

手烟基线：

- 先在真机上跑通 `overlay / desktop-widget` 的 summon -> focus -> revoke -> dismiss -> cleanup

#### 3.3.9 Phase 2.5b：shell surface foundation（环境强化）

状态：未启动

目标：

- 在 2.5a 最小骨架之上，补齐 `multi-monitor / mixed DPI / Win + D / 动态桌面或壁纸切换 / 睡眠恢复 / 热插拔`
- 固化 overlay / desktop-widget 在复杂桌面状态下的 placement、visibility、focus 与 cleanup 规则

进入条件：

- Phase 2.5a 的受管挂载路径已跑通
- Phase 2.4b 的 forced teardown / orphan cleanup 已具备稳定基线

冻结条件：

- `Win + D`、多屏热插拔、DPI 切换后 surface 状态不一致
- revoke / disable / crash 后出现 ghost surface、错误 z-order 或残留输入区域

退出信号：

- 复杂桌面状态矩阵下，`overlay / desktop-widget` 行为一致且可回收
- `summon / revoke / disable / crash / host restart` 均不会破坏 surface 治理链

自动化基线：

- 待补 shell-surface environment regression tests

手烟基线：

- 真机验证必须覆盖真实多屏、高低 DPI 混搭、`Win + D`、动态桌面/壁纸切换、睡眠恢复与热插拔
- 不允许只在虚拟机里完成 shell surface 验收

#### 3.3.10 Phase 2.6：native polyglot adapter contract

状态：未启动

目标：

- 让 QML/C++、Rust、C#、Python 等原生实现通过同一协议接入
- V1 先定义 `native-sidecar.process` 的 adapter contract
- 宿主按协议识别 adapter，不按语言分支

前置约束：

- 不抢在 Phase 2.4a / 2.4b / 2.5a 的最小闭环之前扩面

V2 再展开：

- `native-shell.surface`
- 更完整的原生 UI 承载模型
- 更广的原生 adapter family

退出信号：

- adapter contract 可描述 hello/init/activate、capability invoke、teardown、trust floor
- 至少 1 个非 JS 原生 adapter 能通过统一协议接入

自动化基线：

- 当前尚未落地，后续需要补 adapter handshake / contract validation / trust policy 测试

手烟基线：

- 至少补 1 组 QML/C++ 或等价原生 adapter 的冷启动、热召唤、崩溃恢复与 trust 校验手烟

#### 3.3.11 Phase 2.7：performance / data-plane baseline

状态：未启动

目标：

- 固化 `stream / shared-memory / pipe / local-socket` 的边界
- 固化“控制面可读、数据面二进制”的选型原则
- 固化 shell-surface 与 visualizer 类插件的性能预算
- 固化 warm summon / cold summon / first paint / revoke latency / cleanup latency 的验收脚本

并行建设：

- `Full Protocol Tracer / Profiler` 面板
- 高频数据路径的非 JSON 序列化基线
- 真实 visualizer / widget 的延迟 profiling

前置约束：

- Phase 2.4a 的 Minimal Tracer 已可用
- 至少已有 1 条 shell-surface 或 sidecar 真机闭环可被 tracing

退出信号：

- 至少 1 条高频链路不再走 JSON 主路径
- `Full Protocol Tracer / Profiler` 能可视化 `control / data / trace` 三通道
- 性能预算有脚本化验收入口

### 3.4 Phase 3：Builtin convergence

状态：未启动

目标：

- 至少选择 1 个样板域，让 builtin 与 plugin 走同构 capability path
- 当前优先建议：先选 `navigation`

说明：

- Phase 2.1a 只是前置插针；这里才是正式 convergence phase。

退出信号：

- builtin 与 plugin 共享同一 capability handler / contract 路径
- capability policy 只在 trust / rollout 上区分，不再永久双轨

### 3.5 Phase 4：Compat 退场

状态：远期

目标：

- compat 仅保留 downgrade / migration
- 平台主线以 v2 + 多 runtime + 多 carrier 为主

退出信号：

- 新能力默认不再先落 compat
- compat 成为兼容层而不是平台定义层

### 3.6 Long Horizon：V3 / V4 极致路线

状态：前瞻，不进入当前交付承诺

- **V3 主线前瞻**
  - `[Experimental / Research]` `wasm.component` 成为默认轻量 compute runtime，`native-sidecar.process` 收敛为高权限逃生舱
  - `[Experimental / Research]` `handle-first runtime` 成为运行时主安全模型，ACL 字符串权限退居安装期声明与策略 UI
  - `[Planned / V2]` `overlay / desktop-widget` 试点 scene protocol + host-rendered widget，降低 Webview 常驻开销
  - `[Experimental / Research]` 在通过 Tracer、预算与安全验证后，再引入限制型 hot-path compute kernel / 零拷贝超高频数据面
- **V4 research tracks**
  - `[Experimental / Research]` compositor backend：`scene protocol -> DirectComposition / CoreAnimation / opportunistic MPO`
  - `[Experimental / Research]` heterogeneous compute：`wasm.component + WGSL compute + GPU buffer broker`
  - `[Experimental / Research]` semantic capability bus：`host.intelligence.* / host.memory.*`
  - `[Experimental / Research]` deterministic component distribution：IR-first / AOT cache / recipe-based delivery

进入这些研究轨之前的前置条件：

- V1/V2 治理链稳定
- `Protocol Tracer / Profiler` 可用
- budget / fallback / audit 机制齐备
- 不影响当前 artifact 分发与 sidecar 主线的交付节奏

---

## 4) 基线验证

### 4.1 当前最少自动化基线

> 当 Phase 2.4a / 2.5a / 2.5b / 2.6 / 2.7 开始落地后，需要把 tracer、shell-surface、native adapter、performance budget 的自动化验收补进来，而不是继续只跑现有 command/view/sidecar 测试。

- `pnpm --dir apps/desktop type-check`
- `pnpm --dir apps/desktop lint`
- `pnpm --dir apps/desktop test -- --run pluginRuntimeResolver.test.ts activationEvents.test.ts viewSurfaceDemoFixture.test.ts startupWorkerDemoFixture.test.ts runtime/extensionStartupRuntime.test.ts runtime/extensionCommandRuntime.test.ts runtime/tauriSidecarPortController.test.ts hostPmpCapabilities.test.ts pmpmCompatCapabilityTransport.test.ts pmpmCompatContracts.test.ts pmpmProjection.test.ts pmpmRuntimeBridgeSnapshot.test.ts extensions.test.ts`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml sidecar_bridge`

### 4.2 当前最少手烟基线

`必须真机`

- 安装 demo 插件（`.pmpm` 导入）
- 安装 `view-surface-demo/manifest.v2.json`，在真实机器上跑通 `settings/page/window/visualizer/magnet` 五类 surface 的 install -> mount -> unmount -> cleanup
- 再安装 `sidecar-capability-demo/manifest.v2.json`，在真实机器上跑通 install -> runtime resolution -> command execute -> cleanup 闭环
- shell surface 落地后，必须在真实机器上跑 `overlay / desktop-widget` 的 summon -> focus -> revoke -> dismiss -> cleanup
- shell surface 强化验收必须覆盖真实多屏、高低 DPI 混搭、`Win + D`、动态桌面或壁纸切换、睡眠恢复与热插拔
- sidecar 的 orphan cleanup / 强杀回收必须在真实机器上验证，不能只看模拟退出

`可先 VM`

- inline / sandbox 两种模式分别跑通基础 mount
- stream/session 打开后强制 crash，验证宿主 cleanup 与审计
- 验证安装期 artifact resolution：当前机器命中的 `os/arch` 产物写入 `resolvedArtifacts`
- 签名无效 / digest 不匹配时必须阻止启动并产生审计
- 当前机器无匹配 `os/arch/libc/abi` 产物时必须 blocked，且不可 fallback
- hello 成功但 activate 超时时必须进入 `unresponsive -> forced teardown`
- quarantine 后默认不得自动重启，只允许显式解除后手动恢复

`必须双平台交叉`

- Windows 至少补 1 轮 `Job Object` orphan cleanup / 强杀回收手烟
- macOS/Linux 至少补 1 轮 `process group` teardown 手烟
- artifact resolution / block path 至少覆盖 Windows 与 1 个 POSIX 家族环境
- shell surface 复杂桌面状态至少在 Windows 与另一个目标平台上各完成 1 轮交叉验证

- native adapter 落地后，至少补 1 组 QML/C++ 或等价原生 adapter 的冷启动、热召唤、崩溃恢复与 trust 校验手烟

### 4.3 Phase 与基线对应关系

| 阶段 | 自动化主证据 | 手烟主证据 |
| --- | --- | --- |
| Phase 1 | `pluginRuntimeResolver.test.ts`、`viewSurfaceDemoFixture.test.ts` | settings 中可见 resolver/launcher，`view-surface-demo` 命中 host-frame |
| Phase 2.0 | compat transport / snapshot tests | `stream-protocol-demo` crash cleanup |
| Phase 2.1 | `hostPmpCapabilities.test.ts`、`extensions.test.ts` | deny / revoke 后的一致错误与 cleanup |
| Phase 2.1a | 待补 `navigation` convergence fixture | builtin/plugin 共走 `navigation` handler |
| Phase 2.2 | worker runtime tests、startup worker fixture | command execute / startup activation |
| Phase 2.3 | view surface fixture + resolver tests | 五类 surface install -> mount -> cleanup |
| Phase 2.4a | 待补 tracer envelope / timeline tests | `invoke / revoke / crash cleanup` 的 `control` 时间线可见 |
| Phase 2.4b | sidecar controller + Rust `sidecar_bridge` tests | `sidecar-capability-demo` install -> execute -> cleanup + block path + OS 级回收 |
| Phase 2.5a | 待补 shell-surface 最小 contract tests | `overlay / desktop-widget` 真机 summon/focus/revoke |
| Phase 2.5b | 待补 shell-surface environment regression tests | 多屏 / DPI / `Win + D` / 热插拔 / 睡眠恢复真机矩阵 |
| Phase 2.6 | 待补 adapter contract tests | 至少 1 组原生 adapter 真机接入 |
| Phase 2.7 | 待补 budget / profiling / full tracer tests | 非 JSON 高频链路 + `control/data/trace` 三通道验证 |

---

## 5) Demo 插件口径

位置：`community/plugins/`

- `stream-protocol-demo`
  - 用于 stream/session/cancel/dispose + crash cleanup 基线
- `hello-magnet-demo`
  - 用于最小磁贴 smoke
- `capability-registry-demo`
  - 用于 `core.capability-registry` 的 list/describe/invoke 可视化
- `command-surface-demo`
  - 用于 command contribution + `runCommand` + config 持久化
- `settings-panel-demo`
  - 用于 settings panel contribution + `mountSettings`
- `view-surface-demo`
  - 用于 manifest-v2 webview host-frame 下的五类 long-lived view surface
- `sidecar-capability-demo`
  - 用于 sidecar runtime resolver / bridge host session / command runtime 的测试基线

当前口径：

- `view-surface-demo` 优先服务于真机手烟与 host-frame regression
- `sidecar-capability-demo` 目前只能证明“桥接已接线”，不能代替上线级加固
- demo 插件可以证明链路成立，但不能直接替代生产级信任、分发、恢复与性能验收

---

## 6) 关键代码入口

- Runtime resolver / launcher
  - `apps/desktop/src/magnet-system/plugins/runtime/runtimeResolver.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/launcherRegistry.ts`
- Manifest v2 installer / host manager / governance
  - `apps/desktop/src/magnet-system/plugins/extensions.ts`
  - `apps/desktop/src/magnet-system/plugins/extensionContributionsModule.ts`
  - `apps/desktop/src/magnet-system/plugins/extensionsGovernance.ts`
  - `apps/desktop/src/magnet-system/plugins/hostExtensionRuntimeSupervisor.ts`
  - `apps/desktop/src/magnet-system/plugins/installedExtensionRuntimeManager.ts`
  - `apps/desktop/src/magnet-system/plugins/installedExtensionRuntimeManagerModule.ts`
- Native extv2 view / command runtime
  - `apps/desktop/src/magnet-system/plugins/InstalledExtensionSurfaceHost.tsx`
  - `apps/desktop/src/magnet-system/plugins/runtime/extensionStartupRuntime.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/extensionCommandRuntime.ts`
- Compat capability transport
  - `apps/desktop/src/magnet-system/plugins/runtime/pmpmCompatCapabilityTransport.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/pmpmCompatRuntimeResources.ts`
- Native sidecar bridge
  - `apps/desktop/src/magnet-system/plugins/runtime/tauriSidecarPortController.ts`
  - `apps/desktop/src-tauri/src/sidecar_bridge.rs`
- Host capability registry / host pack
  - `apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`
  - `apps/desktop/src/magnet-system/plugins/host-api/createPluginMountApi.ts`
- Contracts
  - `packages/plugin-platform-contracts/src/core.ts`
  - `packages/plugin-platform-contracts/src/runtime-bridge.ts`
  - `packages/plugin-compat-pmpm/src/manifest.ts`
  - `packages/plugin-compat-pmpm/src/runtime.ts`
- 插件侧 `api.*` 合约
  - `plugin-host-api.md`
