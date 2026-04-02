# PXP Runtime Bridge 规范

状态：draft

## 1. 文档目标

本文档定义未来插件平台的运行时桥接层，也就是 `runtime.*` 的硬契约。

它负责解决 5 类问题：

- 宿主如何启动 `extension-host / webview / sidecar`
- 插件运行时如何完成 handshake、activation、capability 注入与撤销
- UI runtime 如何挂载 `view / surface / slot`
- 宿主如何统一处理 `health / crash / restart / quarantine`
- 运行时关闭时，如何按固定顺序清理 `view / request / stream / session / resource handle`

本文档不负责：

- Manifest 字段设计
- Capability payload 细节
- PMP 宿主专有能力目录
- 签名、安装记录、权限 UI

这些分别属于：

- [PXP Manifest v2 规范](./plugin-platform-manifest-v2-spec.md)
- [PXP Capability / Session / Stream / Resource 协议](./plugin-platform-capability-protocol-spec.md)
- [PMP Host Capability Pack 规范](./plugin-platform-pmp-host-capability-pack-spec.md)

## 2. 当前代码事实

运行时桥不是从零开始空想，当前 PMP 代码已经暴露出一套不完整但真实存在的桥接语义：

- 当前 PMPM 同进程 runtime 仍然假定 JS 模块导出固定符号：
  - `mount`
  - `mountSettings`
  - `mountPage`
  - `mountVisualizer`
  - `mountWindow`
  - `runCommand`
  - 事实来源：`apps/desktop/src/magnet-system/plugins/pmpmRuntime.ts`
- 当前同进程 UI 挂载链已经存在：
  - `apps/desktop/src/magnet-system/plugins/PluginMagnetHost.tsx`
  - 以及与 page / window / settings / visualizer 对应的宿主组件
- 当前 sandbox bridge 已经存在 boot、RPC、heartbeat、event、dispose 语义：
  - `pmpm:init`
  - `pmpm:iframe-ready`
  - `pmpm:mounted`
  - `pmpm:disposed`
  - `pmpm:rpc`
  - `pmpm:rpc-result`
  - `pmpm:ping`
  - `pmpm:pong`
  - `pmpm:error`
  - `pmpm:permission-denied`
  - `pmpm:event`
  - 事实来源：
    - `apps/desktop/src/magnet-system/plugins/PmpmSandboxHost.tsx`
    - `apps/desktop/src/magnet-system/plugins/pmpmSandboxSrcDoc.ts`
    - `apps/desktop/src/magnet-system/plugins/pmpmSandboxCommandRunner.ts`
- 当前 runtime 治理语义已经存在：
  - crash audit
  - runtime restart
  - unresponsive audit
  - provider quarantine
  - 事实来源：
    - `apps/desktop/src/magnet-system/plugins/pmpmRuntimeSupervisor.ts`
    - `apps/desktop/src/magnet-system/plugins/pmpmGovernance.ts`
- 当前 sandbox 开关与宿主策略已经存在：
  - `apps/desktop/src/magnet-system/plugins/pmpmSandboxConfig.ts`

结论：

- 未来 runtime bridge 不是理论补丁，而是对当前已存在桥接事实的重组与标准化
- 当前 PMPM runtime 只能视为 compat seed，不能直接升级为未来标准

## 3. 核心判定

1. `runtime bridge` 是控制面与治理层，不是“再包一层宿主 API”。
2. `runtime bridge` 必须宿主无关，不能把 `page / window / settings-panel / visualizer / magnet` 写成核心协议名词。
3. 一个插件可以同时携带多个 runtime entry，并在同一宿主里同时激活多个 runtime instance。
4. `extension-host / webview / sidecar` 必须共享同一套生命周期语义，即使 carrier 不同。
5. 高频数据与二进制数据不属于 runtime bridge 本体，必须转交给 capability protocol 的 `stream / resource / data plane`。
6. 同进程 JS export 模式只能作为 compat 过渡，不得被视为未来长期基座。

## 4. 运行时对象模型

```ts
type RuntimeKind = 'extension-host' | 'webview' | 'sidecar';

type RuntimeCarrier =
  | 'same-process'
  | 'dedicated-worker'
  | 'webview-frame'
  | 'native-process';

type RuntimeState =
  | 'resolved'
  | 'spawning'
  | 'ready'
  | 'initialized'
  | 'active'
  | 'suspended'
  | 'disposing'
  | 'terminated'
  | 'crashed'
  | 'quarantined';
```

术语约束：

- `runtime entry`
  - Manifest 中声明的某一个运行时入口
- `runtime instance`
  - 某个 runtime entry 在某一次激活中的实际实例
- `bridge session`
  - 宿主与 runtime instance 之间的单次桥接会话
- `carrier`
  - 实际承载运行时的进程或容器
- `view instance`
  - 某个 runtime 挂载出的一个 UI 视图实例
- `cleanup scope`
  - 某次 runtime 生命周期中创建的所有 `view / request / stream / session / handle`

硬规则：

- `pluginId` 不是 `runtimeInstanceId`
- `runtimeId` 不是 `viewInstanceId`
- `providerSessionId` 之类 capability 私有 token 不能替代 bridge 层标识

## 5. 硬约束

以下条目是强约束，不是建议：

1. Runtime bridge 不得直接注入一个巨大宿主 API 对象。
2. Capability 注入必须是“解析后结果”，不是“原始宿主 service 引用”。
3. UI 挂载契约必须使用 `view / surface / slot / mount` 抽象，不得直接固化 PMP UI 名词。
4. `sidecar` 不得被要求通过 JSON 控制面承载高频二进制数据。
5. 宿主必须统一处理 `startup timeout / mount timeout / unresponsive / crash / restart / quarantine`。
6. 宿主必须拥有最终清理权；runtime 崩溃不构成资源泄露豁免。
7. Runtime bridge 必须允许 capability revoke；权限变化与信任降级不能要求插件重装。
8. 同进程 compat runtime 仍然必须服从统一 audit、health、cleanup 语义。

## 6. 桥接握手

### 6.1 通用 envelope

```ts
interface RuntimeBridgeEnvelope {
  bridgeVersion: string;
  op: string;
  pluginId: string;
  runtimeId: string;
  runtimeInstanceId: string;
  requestId?: string;
  traceId?: string;
}
```

`bridgeVersion` 负责 bridge 协议版本，不等于 capability protocol 版本，也不等于 manifest schema version。

### 6.2 标准握手阶段

标准阶段如下：

1. `resolve`
   - 宿主根据 manifest、host target、trust、platform、policy 解析最终 runtime entry
2. `spawn`
   - 宿主创建 carrier
3. `runtime.hello`
   - runtime 主动报告自身支持的 bridge 版本、carrier 能力、data plane 能力
4. `runtime.init`
   - 宿主注入解析后的运行参数与 capability grant
5. `runtime.init.ack`
   - runtime 确认初始化完成
6. `runtime.activate`
   - 宿主发送激活原因
7. `runtime.activate.ack`
   - runtime 进入 active

推荐结构：

```ts
type RuntimeHello = RuntimeBridgeEnvelope & {
  op: 'runtime.hello';
  supportedBridgeVersions: string[];
  runtimeKind: RuntimeKind;
  carrier: RuntimeCarrier;
  supportsViewMount: boolean;
  supportedDataPlanes?: Array<'inline-json' | 'shared-memory' | 'pipe' | 'local-socket'>;
};

type RuntimeInit = RuntimeBridgeEnvelope & {
  op: 'runtime.init';
  hostId: string;
  hostVersion?: string;
  trustLevel: string;
  grantedCapabilities: Array<{
    capabilityId: string;
    version: string;
    mode?: 'required' | 'optional';
  }>;
  runtimePolicy?: {
    startupTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    unresponsiveTimeoutMs?: number;
  };
  locale?: {
    active: string;
    fallback?: string;
  };
};

type RuntimeActivate = RuntimeBridgeEnvelope & {
  op: 'runtime.activate';
  cause:
    | 'startup'
    | 'command'
    | 'view'
    | 'capability'
    | 'host-event'
    | 'manual'
    | 'recovery';
  payload?: unknown;
};
```

### 6.3 握手规则

- `runtime.hello` 之前，宿主不得向 runtime 发送 capability invoke
- `runtime.init.ack` 之前，runtime 不得假定任何 capability 已可用
- `runtime.activate.ack` 之前，宿主不得把该 runtime 视为健康可服务实例
- 如果 runtime 不支持宿主选择的 `bridgeVersion`，握手必须失败，不能 silently degrade

## 7. 视图挂载契约

### 7.1 抽象目标

Runtime bridge 只定义抽象视图挂载，不定义最终宿主落点名词。

标准消息：

```ts
type ViewMountRequest = RuntimeBridgeEnvelope & {
  op: 'view.mount.request';
  requestId: string;
  viewInstanceId: string;
  viewId: string;
  viewType: string;
  surfaceSlot: string;
  props?: unknown;
};

type ViewMountAck = RuntimeBridgeEnvelope & {
  op: 'view.mount.ack';
  requestId: string;
  viewInstanceId: string;
};

type ViewUpdate = RuntimeBridgeEnvelope & {
  op: 'view.update';
  viewInstanceId: string;
  props?: unknown;
};

type ViewUnmountRequest = RuntimeBridgeEnvelope & {
  op: 'view.unmount.request';
  requestId: string;
  viewInstanceId: string;
  reason?: string;
};
```

### 7.2 挂载规则

- `view.mount` 与 `runtime.activate` 是两个独立阶段
- 一个 runtime instance 可以挂载多个 `viewInstance`
- `view.unmount` 不等于 `runtime terminate`
- `same-process` carrier 可以持有本地对象句柄，例如 DOM root
- `webview-frame` carrier 只能拿到其沙箱内部的 mount root
- `native-process` sidecar 默认不得直接处理 `view.mount`

### 7.3 对 PMP 现状的约束

当前这些导出：

- `mount`
- `mountSettings`
- `mountPage`
- `mountVisualizer`
- `mountWindow`

都只能作为 compat 适配层存在。未来标准 runtime 不再要求插件导出这些宿主形状函数。

## 8. Capability 注入与撤销

### 8.1 注入

Capability 必须以“解析结果”形式注入：

- 已协商 capability id
- 协商后的版本
- trust 与 permission 限制
- 是否 required / optional

禁止行为：

- 直接把 PMP 内部 service 实例传给插件
- 把宿主 `localStorage` key、Tauri command 名称、内部事件名作为公共接口发给插件

### 8.2 撤销

宿主必须支持下列 revoke 原因：

- 用户撤销权限
- 插件被降级为更低 trust level
- 宿主策略变化
- provider quarantine
- host capability pack 升级导致版本不兼容

推荐消息：

```ts
type CapabilityRevoke = RuntimeBridgeEnvelope & {
  op: 'runtime.capabilities.revoke';
  requestId: string;
  capabilityIds: string[];
  reason: string;
};
```

规则：

- runtime 收到 revoke 后，必须停止新的调用
- 受影响 capability 的 `stream / session / handle` 必须在 ack 前完成 best-effort 清理
- revoke 失败时，宿主可以直接 terminate runtime

## 9. 健康、崩溃与治理

### 9.1 健康语义

宿主必须至少支持：

- `runtime.health.request`
- `runtime.health.response`
- `runtime.ping`
- `runtime.pong`

`ping/pong` 只证明 carrier 活着，不等于 capability 健康。

### 9.2 标准状态

宿主必须区分：

- `healthy`
- `degraded`
- `unresponsive`
- `crashed`
- `quarantined`

### 9.3 崩溃与重启

宿主必须记录：

- runtime kind
- carrier
- plugin id
- runtime id
- crash surface
- reason
- restart decision
- quarantine decision

当前 PMP 已有这些原型事实：

- crash audit
- runtime restart audit
- runtime unresponsive audit
- provider quarantine audit

但它们仍是 PMPM 私有治理，不是正式 bridge 协议。

### 9.4 隔离与限流

运行时治理至少要支持：

- 自动重启次数上限
- 连续崩溃阈值
- quarantine 期间禁止自动再激活
- 手动清除 quarantine

这些语义对 `webview` 与 `sidecar` 都成立；不能只在 native provider 上实现。

## 10. 数据面要求

Runtime bridge 本身只承载控制面，但必须为 capability protocol 的数据面留出标准挂点。

强约束：

- `stream` 与 `resource handle` 语义沿用 capability protocol
- `sidecar` 默认控制面使用 `stdio` framed RPC
- 高频数据默认走：
  - `shared-memory`
  - `pipe`
  - `local-socket`
- `WebSocket / gRPC` 只能视为 adapter，不能成为唯一标准协议

这意味着：

- `visualizer.onSpectrum(setInterval)` 这类现有 PMP 方案只能视为 compat fallback
- 音频监测器、解码 sidecar、长期 analyzer 输出必须使用 data plane

## 11. 清理顺序

### 11.1 正常关闭

正常关闭必须按如下顺序执行：

1. 停止新的 activate / mount / invoke
2. `view.unmount`
3. `cancel` in-flight request 与 task
4. `stream.end` 或 `dispose(stream)`
5. `session.close`
6. `revoke / dispose(resource handle)`
7. flush telemetry / audit
8. terminate carrier

### 11.2 异常崩溃

如果 runtime 已经崩溃：

- 宿主可以先强制终止 carrier
- 然后对 orphaned `view / session / handle` 做 best-effort 回收
- 插件不得因为 runtime crash 而豁免资源清理

## 12. 当前 PMPM 协议到未来 bridge 的映射

| 当前 PMPM 事实 | 未来标准语义 | 判定 |
| --- | --- | --- |
| `mount(container, api)` | `view.mount.request` + carrier-local mount handle | 当前是宿主耦合导出 |
| `mountPage / mountWindow / mountVisualizer / mountSettings` | host mapping，非 core runtime export | 必须下沉到 host 层 |
| `runCommand(api, commandId)` | `core.commands` 激活/分发 | 不再保留为 runtime 必选导出 |
| `pmpm:init` | `runtime.init` | 可直接映射 |
| `pmpm:iframe-ready` | `runtime.hello` / `runtime.ready` | 可直接映射 |
| `pmpm:mounted` | `view.mount.ack` | 可直接映射 |
| `pmpm:disposed` | `view.unmount.ack` 或 `runtime.terminated` | 需区分作用域 |
| `pmpm:rpc` | capability protocol request | 当前只是宿主定制 RPC |
| `pmpm:rpc-result` | capability protocol response | 当前只是 compat seed |
| `pmpm:event` | host event stream / capability stream | 需要标准化命名与治理 |
| `pmpm:ping / pmpm:pong` | runtime health heartbeat | 可直接映射 |
| `pmpm:error` | `runtime.error` / `runtime.crash` | 需要区分 recoverable 与 fatal |
| `pmpm:permission-denied` | capability policy error / revoke | 不能继续停留在 ad-hoc 事件 |

## 13. 边界与非目标

Runtime bridge 不负责：

- host capability catalog
- 主题绑定、导航、磁贴、库字段这些宿主领域模型
- 插件签名验证与安装记录
- 业务领域 provider 协议

如果把这些继续塞进 runtime bridge，bridge 会重新退化成“宿主私有万能总线”。

## 14. 审计结论

当前代码已经足够证明以下判断：

- runtime bridge 不是凭空发明，当前 PMP 已经有 handshake、mount、heartbeat、restart、audit 原型
- 当前最严重的问题不是“没有桥”，而是“桥已经存在，但全部是 PMP 私有命名和私有导出假设”
- 如果不把这些桥接语义上升为 `runtime.*` 硬规范，平台最终一定会退回“每个 runtime 各写一套桥”的状态

一句话总结：

> Runtime bridge 的职责不是给插件再发一个宿主 API，而是把 runtime 的启动、挂载、健康、清理和治理语义从 PMP 私有实现中抽出来，变成可移植、可监督、可组合的公共底座。
