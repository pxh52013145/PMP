# PXP Capability / Session / Stream / Resource 协议

状态：draft

## 1. 文档目的

本文档定义未来插件平台的能力协议。

它解决的问题不是“如何做一个 RPC”，而是：

- 能力如何协商
- 长生命周期会话如何表达
- 高频或二进制数据如何传输
- 资源如何借出、回收、取消和清理
- sidecar、extension host、webview 如何共享同一套语义

## 2. 当前代码事实

### 2.1 共享 contracts 现状过薄

当前共享 `capabilities.ts` 只定义了：

- `HostCapabilityInfo`
- `HostCapabilityInvokeRequest`
- `HostCapabilityResult`

这意味着当前共享层只覆盖了 unary invoke。

相关代码：

- `packages/plugin-platform-contracts/src/capabilities.ts`

### 2.2 PMP 已经出现超出 unary 模型的真实语义

当前 PMP 插件 host capability 已经存在如下能力形态：

- `describe`
- `health`
- `listProviders`
- `invoke`
- `probe`
- `openSession`
- `closeSession`

相关代码：

- `apps/desktop/src/magnet-system/plugins/host-api/capabilities.ts`

这已经不是“普通方法调用”，而是至少包含：

- session ownership
- provider health
- timeout
- quarantine
- fallback
- runtime stats
- audit trace

### 2.3 Sidecar 已经提供会话与协议协商原型

当前音频 decoder sidecar 已经有：

- `protocol_version`
- `describe_provider`
- `probe`
- `open_session`
- `close_session`
- `health`
- `provider_session_id`
- `selected_input_id`
- `open_session_count`
- `status`

相关代码：

- `apps/desktop/src/magnet-system/plugins/host-api/audioInputAdapterSidecar.ts`
- `apps/desktop/src-tauri/src/audio/decoder_sidecar.rs`

结论：

- “session / health / protocol negotiation” 已经不是理论需求，而是当前代码事实

## 3. 设计原则

1. 协议必须 transport-agnostic。
2. `invoke / session / stream / resource` 必须是一级公民。
3. `describe` 与 `health` 应作为统一保留语义。
4. 所有长生命周期对象必须定义 owner、cancel、dispose、cleanup 顺序。
5. 高频数据默认走数据面，不能强行塞回 JSON 控制面。

## 4. 协议总览

### 4.1 协议层次

协议拆成两部分：

- 控制面：请求、响应、协商、生命周期管理
- 数据面：高频数据与二进制数据传输

### 4.2 控制面职责

控制面负责：

- capability discovery
- version negotiation
- unary invoke
- session open/close
- stream lifecycle
- resource handle lifecycle
- cancel / dispose
- error reporting

### 4.3 数据面职责

数据面负责：

- 大文件
- 二进制 buffer
- 共享内存
- 高频音频帧
- 频谱流

默认建议：

- 控制面：framed message protocol
- 数据面：shared memory、pipe、local socket

## 5. 核心标识

协议中的基础标识如下：

```ts
type ProtocolVersion = string;
type CapabilityId = string;
type RequestId = string;
type SessionId = string;
type StreamId = string;
type HandleId = string;
type LeaseId = string;
```

要求：

- `requestId` 只用于请求-响应配对
- `sessionId` 只用于平台管理的长期会话
- `streamId` 只用于流式通道
- `handleId` 只用于资源句柄
- `providerSessionId` 或其他外部 token 只能作为 capability 私有字段，不能替代平台 `sessionId`

## 6. 通用消息包络

建议所有控制面消息至少带下列公共字段：

```ts
interface PxpEnvelopeBase {
  protocolVersion: string;
  op: string;
  requestId?: string;
  capabilityId?: string;
  sessionId?: string;
  streamId?: string;
  handleId?: string;
  runtimeId?: string;
  traceId?: string;
  pluginId?: string;
}
```

说明：

- 具体 transport 可以把这些字段映射到不同帧格式
- 但语义上必须存在这些标识

## 7. Unary Invoke

### 7.1 请求

```ts
interface CapabilityInvokeRequest extends PxpEnvelopeBase {
  op: 'capability.invoke.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
}
```

### 7.2 响应

```ts
interface CapabilityInvokeResponseOk extends PxpEnvelopeBase {
  op: 'capability.invoke.response';
  requestId: string;
  ok: true;
  data: unknown;
}

interface CapabilityInvokeResponseError extends PxpEnvelopeBase {
  op: 'capability.invoke.response';
  requestId: string;
  ok: false;
  error: ProtocolError;
}
```

### 7.3 保留方法

所有 capability 建议至少支持：

- `describe`
- `health`

理由：

- 当前 `audio input adapter`、`AI adapter`、`runtime provider` 已经都使用该模式
- 统一的 `describe/health` 能把 discovery 与治理接口标准化

## 8. Session 原语

### 8.1 为什么必须独立建模

以下场景都不是一次调用能表达的：

- 登录流程
- 连接器握手
- sidecar 解码器实例
- 音频监测器任务
- 长时 provider conversation

### 8.2 平台级 session 模型

```ts
interface SessionOpenRequest extends PxpEnvelopeBase {
  op: 'session.open.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
}

interface SessionOpenResponse extends PxpEnvelopeBase {
  op: 'session.open.response';
  requestId: string;
  ok: true;
  sessionId: string;
  providerSessionId?: string;
  metadata?: unknown;
}

interface SessionCloseRequest extends PxpEnvelopeBase {
  op: 'session.close.request';
  requestId: string;
  capabilityId: string;
  sessionId: string;
  reason?: string;
}
```

### 8.3 Ownership 规则

必须明确：

- session owner 是哪个 plugin runtime
- capability provider 是否还维护自己的 `providerSessionId`
- runtime 终止时，平台必须主动回收 session
- 插件无权关闭其他插件拥有的 session

这些语义在当前 `audio input adapter` 代码里已经存在：

- session owner 校验
- `FORBIDDEN` on ownership mismatch
- plugin 维度 session 数量限制

### 8.4 治理字段

对于 provider 型 capability，建议 `describe` 暴露：

- `timeoutMs`
- `maxOpenSessionsPerPlugin`
- `quarantineThreshold`
- `quarantineMs`

说明：

- 这类字段不是所有 capability 都强制要求
- 但长生命周期 provider 型能力强烈建议标准化

## 9. Stream 原语

### 9.1 为什么必须独立建模

当前 PMP 已经有下列典型流需求：

- 频谱帧
- 分析器输出
- 长时 AI 流式响应
- sidecar 连续音频帧

如果继续全部塞进：

- `setInterval + RPC`
- `storage + event broadcast`

平台一定失效。

### 9.2 Stream 生命周期

建议最小语义如下：

```ts
type StreamOpenRequest = {
  op: 'stream.open.request';
  requestId: string;
  capabilityId: string;
  method: string;
  payload?: unknown;
};

type StreamOpenResponse = {
  op: 'stream.open.response';
  requestId: string;
  ok: true;
  streamId: string;
  mode: 'push' | 'pull';
  transport: 'inline-json' | 'shared-memory' | 'pipe' | 'local-socket';
};

type StreamData = {
  op: 'stream.data';
  streamId: string;
  sequence: number;
  payload?: unknown;
  handles?: ResourceHandleDescriptor[];
};

type StreamCredit = {
  op: 'stream.credit';
  streamId: string;
  credit: number;
};

type StreamEnd = {
  op: 'stream.end';
  streamId: string;
  reason?: string;
};
```

### 9.3 Backpressure

协议必须支持 backpressure。

建议规则：

- `push` 模式下消费者必须可回传 credit
- 生产者不得无限制推送
- 高频二进制流优先返回 handle 或数据面引用，而不是巨大内联 JSON

## 10. Resource Handle 原语

### 10.1 为什么必须独立建模

下列对象都不应该继续伪装成普通 JSON：

- 大文件
- 内存映射缓冲
- 共享内存块
- pipe/socket 端点
- 临时导出对象

### 10.2 统一描述

```ts
type ResourceHandleDescriptor = {
  handleId: string;
  kind: 'file' | 'blob' | 'shared-memory' | 'pipe' | 'local-socket';
  access: 'read' | 'write' | 'readwrite';
  leaseMs?: number;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
};
```

### 10.3 生命周期

至少要支持：

- create / attach
- renew lease
- revoke
- dispose

### 10.4 清理规则

清理顺序必须明确：

1. cancel active work
2. close stream
3. close session
4. revoke resource handle
5. terminate runtime

## 11. Cancel / Dispose

### 11.1 Cancel

`cancel` 作用于未完成请求、正在运行任务、活跃 stream。

```ts
type CancelRequest = {
  op: 'cancel.request';
  requestId: string;
  targetRequestId?: string;
  streamId?: string;
  sessionId?: string;
  reason?: string;
};
```

### 11.2 Dispose

`dispose` 作用于已建立的长期对象。

```ts
type DisposeRequest = {
  op: 'dispose.request';
  requestId: string;
  handleId?: string;
  streamId?: string;
  sessionId?: string;
  reason?: string;
};
```

区别：

- `cancel` 偏中断正在进行的工作
- `dispose` 偏释放已经存在的长期对象

## 12. 错误模型

### 12.1 统一结构

```ts
type ProtocolError = {
  code: string;
  message: string;
  retryable?: boolean;
  details?: unknown;
};
```

### 12.2 当前代码已经出现的错误域

建议把当前已出现的错误码保留为第一批标准错误码：

- `INVALID_PAYLOAD`
- `NOT_FOUND`
- `FORBIDDEN`
- `NOT_AVAILABLE`
- `NOT_CONFIGURED`
- `RESOURCE_EXHAUSTED`
- `PROVIDER_UNAVAILABLE`
- `OPEN_SESSION_FAILED`
- `CLOSE_SESSION_FAILED`
- `METHOD_NOT_SUPPORTED`
- `PROVIDER_ERROR`

说明：

- 当前 host capability 代码已经广泛使用这些错误语义
- 标准化它们可以减少不同 capability 的随意返回

## 13. `describe` 与 `health`

### 13.1 `describe`

`describe` 负责静态或半静态信息：

- capability id
- domain
- implementation
- methods
- provider list
- governance hints
- default provider

### 13.2 `health`

`health` 负责动态信息：

- ready
- status
- message
- degraded/offline
- open session count
- provider runtime state

当前 sidecar 与 host capability 都已具备这两个原型，因此应上升为保留方法语义。

## 14. Sidecar 适配映射

本文档不是 runtime bridge 规范，但必须说明 sidecar 映射关系。

当前 `decoder_sidecar.rs` 可直接映射为：

- `describe_provider` -> `describe`
- `probe` -> unary invoke
- `open_session` -> `session.open`
- `close_session` -> `session.close`
- `health` -> `health`
- `provider_session_id` -> capability 私有 provider token
- `protocol_version` -> transport/runtime 协商版本

结论：

- 现有 sidecar 代码已经证明 session 和 protocol negotiation 不是额外设计，而是现实需求

## 15. 当前契约与目标契约对比

| 维度 | 当前共享 contracts / PMP 原型 | 目标协议 | 评估 |
| --- | --- | --- | --- |
| unary invoke | 已有 | 保留 | 当前没问题 |
| describe/health | PMP 已大量出现，但未标准化 | 统一保留方法 | 当前已具备原型 |
| session | 只在具体 capability 内零散实现 | 统一 session 原语 | 当前缺正式协议 |
| stream | 主要依赖宿主事件与轮询 | 统一 stream 原语 + backpressure | 当前明显不足 |
| resource handle | 几乎没有正式建模 | 一等资源句柄 | 当前严重缺失 |
| cancel/dispose | 基本无统一模型 | 必须标准化 | 当前缺失 |
| data plane | 局部 sidecar / shm 需求存在 | 控制面与数据面分离 | 当前未平台化 |

## 16. 审计结论

当前能力体系不是完全没有基础，而是停在了“每个 capability 各自长协议”的阶段。

真实问题有 4 个：

1. 共享 contracts 只承认 unary invoke。
2. PMP 已经出现 session、health、治理、fallback，但没有被提升为平台协议。
3. 高频数据与二进制资源没有正式建模。
4. cancel、dispose、cleanup 顺序没有统一规则。

因此下一步不是再加几个 `invokeCapability(...)` 变体，而是把 `invoke / session / stream / resource` 升格成统一协议层。
