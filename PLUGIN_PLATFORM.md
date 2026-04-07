# Plugin Platform / Microkernel 开发方案（主线）

更新时间：2026-04-07  
目标：把插件系统推进为**更独立完整的微内核（microkernel）**——插件与宿主解耦、边界清晰、默认可沙箱、支持多语言/多进程运行时。

> 备注：仓库的 `/documents/` 目录是本地草案区（默认不提交）。本文件是可维护的主线说明入口。

---

## 1) North Star（硬目标）

- **Kernel First**：宿主只保留最小内核职责，其余能力通过 capability contracts 外挂。
- **Contracts Over APIs**：插件与宿主通过 `capabilityId + protocol envelopes` 交互，不暴露宿主内部实现细节（service 类型、事件名、localStorage key、Tauri command 名等）。
- **Sandbox Default**：默认不信任插件；权限显式授予，可拒绝/可撤销/可降级。
- **Polyglot Runtimes**：同一套契约支持 `webview / worker / native sidecar`（多语言与多进程）。
- **Carrier-Independent**：compat carrier 只是过渡；协议语义必须可复用到 worker/webview/sidecar。
- **Builtin Convergence**：长期 builtin 与 plugin 在同一 capability 边界同权同构（policy 可按 trust level 区分，但不允许永久双轨）。

### 1.1 交付基线（Definition of Done）
从“插件平台/微内核化”视角，一个里程碑要算完成，至少要能提供这些证据（缺一则视为未闭环）：

- **可运行**：至少 1 个插件实例能走“声明 → 解析 → 启动 → 交互 → 清理”的全链路（非 demo-only 的 mock）。
- **可观测**：settings/admin 能看到 runtime resolution、launcher、carrier、capability grants（或至少能导出 snapshot）。
- **可测试**：新增协议/解析/权限规则，必须有对应测试（优先补到 `apps/desktop/src/magnet-system/plugins/*.test.ts`）。
- **可降级/可清理**：runtime crash/dispose 时，stream/session 等资源必须由宿主回收（best-effort 也要可审计）。

---

## 2) 当前状态（以源码为准）

### 已落地（可运行/可测）

- **Phase 1**：runtime resolver / launcher registry 骨架已落地；现有 PMPM 插件的 view/command surfaces 已统一走 resolver，并在 settings 面板可观测。
- **Phase 2（compat carrier）**：capability protocol 在 compat carrier 上已有首版闭环：  
  - invoke  
  - session open/close  
  - stream open/data/end  
  - cancel/dispose cleanup  
- **`host.pmp.*` 能力目录**：host capability registry + host pack descriptor 已在宿主侧成型并有测试覆盖。
- **Manifest v2 installer/store**：宿主已可安装 `manifest.v2.json`，并持久化安装记录、resolved artifacts、capability deny 状态、基础治理审计。
- **Native manifest-v2 command runtime**：`pxp.extension-host.worker` 与 `pxp.sidecar.native-process` 已进入 command surface 的 resolver/runtime 路径；worker 路径已接上 `entryUrl` + Tauri asset scope，可完成 command + config round-trip。
- **治理服务统一化**：`GovernanceService` 与 runtime restart supervisor 已抽象到 host-extension 级别，PMPM 与 manifest-v2 已可共用 restart 请求与审计入口。

### 仍缺口（阻塞“微内核化/多语言/进程级”的关键项）

- **至少 1 个非 compat runtime 真正可启动**（worker/webview-host/sidecar 任一先跑通），即 launcher `availability: available` + 端到端样例。
- **sidecar/native-process 运行时**：进程级 carrier、IPC transport、runtime bridge handshake、capability invoke 的最小闭环。
- **Manifest v2 成为宿主安装主数据**：安装记录持久化、基础 enable/disable/deny/audit 已落地；但 activationEvents 调度、长生命周期 view surfaces、完整 lifecycle governance parity 仍未闭环。
- **多 carrier 复用协议**：让 capability protocol 真正 carrier-independent（不是只有 compat iframe 可跑）。
- **Builtin convergence 样板**：至少 1 个领域（navigation/i18n/telemetry/keybinding-context）从私有 shortcut 收口到 capability handler。

### Native manifest-v2 / host manager 状态校准（2026-04-07）

- **已完成的宿主基座**：
  - `manifest.v2.json` 已进入宿主安装/持久化主路径，settings 可直接安装、启停、卸载并查看 runtime resolution。
  - `contributes.core.commands` / `contributes.core.keybindings` 已接入宿主 contribution 注册链。
  - `pxp.extension-host.worker` 已可用于 command surface，覆盖 installed artifact `entryUrl`、runtime bridge hello/init/activate、permission/config round-trip。
  - manifest-v2 governance audit 已覆盖 installed / enabled / disabled / capabilities-updated / crash / runtime-unresponsive / runtime-restart / errors-cleared / uninstalled。
  - 宿主 restart/governance service 已统一抽象到 host-extension 级别，可同时覆盖 PMPM 与 manifest-v2。
- **仍未完成的关键缺口**：
  - manifest-v2 的长生命周期 view surfaces（settings/page/window/visualizer/magnet）仍未接入真实 carrier。
  - 当前 `extension-host worker` 仍是 command-oriented runtime，尚无 view mount carrier，因此不能把“worker command 跑通”误判为“native view surfaces 已上线”。
  - `activationEvents` 的统一调度与更完整的 lifecycle governance parity 仍未完成。
  - sidecar/native-process 仍受真实 transport/controller 未接线所限制，尚不具备生产可启动性。
- **当前结论**：
  - Native manifest-v2 已完成 installer/store、command runtime 与 restart/governance 基线，但还不能算完成长生命周期 runtime 或 native view hosting。

### Sidecar/native-process 状态校准（2026-04-07）

- **已完成的 MVP 基线**：
  - sidecar runtime 可被 resolver 命中。
  - `pxp.sidecar.native-process` 已进入 launcher `availability: available` 路径。
  - host session 已复用统一 runtime bridge 协议。
  - 测试已覆盖 `hello/init/activate`、capability invoke、config round-trip、crash cleanup。
- **仍未完成的生产接入**：
  - 默认 `createPortController` 仍无真实实现，当前默认行为仍会抛出 `Native sidecar runtime bridge is not configured`。
  - Tauri 前端 `invoke/listen` 桥接尚未接入 sidecar command runtime。
  - Rust 后端 child process registry、stdin/stdout framing、lifecycle cleanup 尚未形成宿主实现。
  - 真机 sidecar command 执行闭环尚未完成，因此 production 环境下 native-process runtime 仍不能真正启动。
- **当前结论**：
  - Sidecar/native-process MVP 已完成解析、适配、宿主会话与测试闭环，但尚未完成真实 native-process transport/controller 接入，因此生产环境下的 sidecar command runtime 仍未真正可启动。

---

## 3) Phase 开发方案（建议）

> 每个 Phase 必须有：**可运行样例** + **基线验证**（tests + 手测 checklist）。否则视为未闭环。

### Phase 0：边界冻结与债务清点（已完成）

- 产物：contracts 分层、compat vs platform vs builtin debt 的判定，关键落点文件明确可测试。

### Phase 1：resolver/launcher 成为真实入口（已完成，但缺 exit sample）

- 退出信号（缺 1 条）：  
  - ✅ surfaces 统一走 resolver  
  - ✅ compat inline/sandbox launcher 可用且可观测  
  - ⛔ 至少 1 个非 compat launcher 真正 `available` 并可启动
- 基线：`apps/desktop/src/magnet-system/plugins/pluginRuntimeResolver.test.ts`

### Phase 2：capability protocol 成为主交互层（进行中）

**Phase 2.0（已完成）：compat carrier 协议闭环**

- invoke/session/stream/cancel/dispose 在 compat carrier 上闭环（用于迁移与对照）。

**Phase 2.1（未完成）：direct registry path 的最终权限策略**

- 必须明确：`host.listCapabilities / host.invokeCapability` 的权限边界、legacy facade vs generic invoke 分层、deny/revoke 可恢复路径。

**Phase 2.2（部分完成）：worker carrier 复用协议**

- 当前已完成：`pxp.extension-host.worker` 已可用于 manifest-v2 command surface，且已覆盖 handshake、permission/config round-trip。
- 当前未完成：通用 session/stream、view mount，以及 settings/page/window/visualizer 等长生命周期 surface。
- 退出信号：worker carrier 不仅能跑 command，还要能覆盖至少 1 个非 command surface，并验证 session/stream 或等价长生命周期桥接能力。

**Phase 2.3（未完成）：generic webview host-frame 复用协议**

- 退出信号：`pxp.webview.host-frame` launcher `available` + view mount 在非 compat carrier 跑通（协议语义不变）。

**Phase 2.4（未完成）：sidecar/native-process（多语言）MVP**

- 退出信号（最小闭环）：  
  - `pxp.sidecar.native-process` launcher `available`  
  - runtime bridge hello/init/activate  
  - 至少 1 个 capability invoke（建议 `core.capability-registry.describe/list`）  
  - data plane 先明确 1 种（建议优先 `pipe` 或 `local-socket`）
- 当前状态拆分：
  - **已完成**：resolver 命中、launcher available、host runtime session 复用统一 bridge、测试覆盖 hello/init/activate 与 capability/config/crash cleanup。
  - **未完成**：真实 `createPortController`、Tauri `invoke/listen` 桥接、Rust child process registry 与 stdin/stdout framing、真机 command 执行闭环。
  - **判定口径**：`sidecar-capability-demo` 目前只能证明 fixture/test baseline 已齐，不代表平台原生进程链路已经上线。
- 备注：进程级插件本质上需要“可执行产物”，但并不等于“任意编译好的文件都能用”。至少要满足：  
  - **平台匹配**：OS/arch 匹配（Windows/macOS/Linux + x64/arm64 等）。  
  - **可描述**：可被 manifest（v2）稳定描述（入口、版本、权限/能力声明）。  
  - **可握手**：启动后必须完成 runtime bridge handshake，并遵守 capability 协议语义。  
  - **可治理**：允许签名/校验、trust floor、权限授予/撤销，以及 crash 后的回收与审计。

### Phase 3：Builtin convergence（未启动）

- 目标：选 1 个样板域，把 builtin 的对外边界收口到 capability handler，插件与 builtin 走同构路径。

### Phase 4：Compat 退场（远期）

- 目标：compat 仅保留 downgrade/migration；平台主线以 v2 + 多 runtime + 多 carrier 为主。

---

## 4) 基线验证（建议固定下来）

### 4.1 Automated（最少跑）

- `pnpm --dir apps/desktop type-check`
- `pnpm --dir apps/desktop lint`
- `pnpm --dir apps/desktop test -- --run pluginRuntimeResolver.test.ts hostPmpCapabilities.test.ts pmpmCompatCapabilityTransport.test.ts pmpmCompatContracts.test.ts pmpmProjection.test.ts pmpmRuntimeBridgeSnapshot.test.ts`

### 4.2 Manual（每次改协议/清理必测）

- 安装 demo 插件（`.pmpm` 导入）
- inline/sandbox 两种模式分别跑通 mount
- stream/session 打开后强制 crash，验证宿主 cleanup 与审计（参考 `stream-protocol-demo`）

---

## 5) Demo 插件（用于验证基线）

位置：`community/plugins/`

- `stream-protocol-demo`：stream/session/cancel/dispose + crash cleanup（协议与清理基线）
  - 打包：`pnpm plugin:pack:stream-demo`
- `hello-magnet-demo`：最小磁贴 smoke（无权限）
  - 打包：`pnpm plugin:pack:hello-magnet-demo`
- `capability-registry-demo`：`core.capability-registry` 的 list/describe/invoke 权限与结果可视化
  - 打包：`pnpm plugin:pack:capability-registry-demo`
- `command-surface-demo`：command contribution + `runCommand` + `storage:local` config 持久化
  - 打包：`pnpm plugin:pack:command-surface-demo`
  - 附带 `manifest.v2.json`，用于验证 native `extension-host worker` command path
- `settings-panel-demo`：settings panel contribution + `mountSettings` + config 编辑
  - 打包：`pnpm plugin:pack:settings-panel-demo`
- `sidecar-capability-demo`：Manifest v2 sidecar fixture，用于 sidecar runtime resolver / bridge host session / command runtime 的测试基线
  - 说明：当前用于验证 native-process 协议与清理语义的 fixture/test baseline，不代表宿主真实 native-process transport 已上线

---

## 6) 关键代码入口（定位问题用）

- Phase 1：runtime resolver/launcher  
  - `apps/desktop/src/magnet-system/plugins/runtime/runtimeResolver.ts`  
  - `apps/desktop/src/magnet-system/plugins/runtime/launcherRegistry.ts`
- Manifest v2 installer / host manager / governance  
  - `apps/desktop/src/magnet-system/plugins/extensions.ts`
  - `apps/desktop/src/magnet-system/plugins/extensionContributionsModule.ts`
  - `apps/desktop/src/magnet-system/plugins/extensionsGovernance.ts`
  - `apps/desktop/src/magnet-system/plugins/hostExtensionRuntimeSupervisor.ts`
- Phase 2：compat capability transport  
  - `apps/desktop/src/magnet-system/plugins/runtime/pmpmCompatCapabilityTransport.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/pmpmCompatRuntimeResources.ts`
- Native command runtime / sidecar bridge  
  - `apps/desktop/src/magnet-system/plugins/runtime/extensionCommandRuntime.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/workerCommandRuntime.ts`
  - `apps/desktop/src/magnet-system/plugins/runtime/tauriSidecarPortController.ts`
  - `apps/desktop/src-tauri/src/sidecar_bridge.rs`
- Host capability registry / host pack：  
  - `apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`
  - `apps/desktop/src/magnet-system/plugins/host-api/createPluginMountApi.ts`
- Contracts（类型定义 / 语义源）：
  - `packages/plugin-platform-contracts/src/core.ts`
  - `packages/plugin-platform-contracts/src/runtime-bridge.ts`
  - `packages/plugin-compat-pmpm/src/manifest.ts`
  - `packages/plugin-compat-pmpm/src/runtime.ts`
- 插件侧 `api.*` 合约（当前生效）：`plugin-host-api.md`
