# PXP Manifest v2 规范

状态：draft

## 1. 文档目的

本文档定义未来插件平台的 Manifest v2。

它不是对现有 `PmpmManifest` 的字段扩充，而是把下面 4 个维度分离清楚：

- 插件身份
- 运行时入口
- 能力协商
- 宿主投放映射

它还必须解决一个当前代码里已经暴露出来的问题：

- “原始 manifest”
- “安装记录”
- “运行时状态”

这三类信息不能再混在一个结构里。

## 2. 当前代码事实

Manifest v2 的设计依据不是愿景，而是当前代码已经暴露出来的结构缺陷。

### 2.1 现有 PMPM manifest 事实

当前 `PmpmManifest` 以 `ExtensionManifestCore<'magnet-plugin'>` 为底，主要特征如下：

- 单 `entryPoint`
- `formatVersion`
- `type`
- `metadata`
- `permissions[]`
- `contributions.pages/windows/commands/settingsPanels/visualizers`
- `magnet.defaultAnchor/defaultStyle/defaultVariant/variants`

相关代码：

- `packages/plugin-platform-contracts/src/manifest.ts`
- `packages/plugin-platform-contracts/src/contributions.ts`
- `apps/desktop/src/magnet-system/plugins/pmpm.ts`

### 2.2 现有运行时事实

当前运行时并不是根据 manifest 的抽象 runtime 描述来解析，而是直接假定 JS 模块导出下列符号：

- `mount`
- `mountSettings`
- `mountPage`
- `mountVisualizer`
- `mountWindow`
- `runCommand`

相关代码：

- `apps/desktop/src/magnet-system/plugins/pmpmRuntime.ts`
- `apps/desktop/src/magnet-system/plugins/pmpmSandboxSrcDoc.ts`
- `apps/desktop/src/magnet-system/plugins/pmpmSandboxCommandRunner.ts`

结论：

- 当前 manifest 并未真正描述 runtime，只是描述一个 JS 入口文件路径
- 当前 manifest 直接绑定了 PMP 的 UI 落点形状

### 2.3 当前安装记录事实

当前 `InstalledPmpmPlugin` 实际混合了三类信息：

- 原始 manifest
- 安装完整性与签名信息
- 启停策略与错误状态

混合字段包括：

- `packageSha256`
- `manifestSha256`
- `entrySha256`
- `signature`
- `enabled`
- `disabledReason`
- `deniedPermissions`
- `lastError`
- `lastErrorAt`

相关代码：

- `apps/desktop/src/magnet-system/plugins/pmpm.ts`
- `apps/desktop/src/magnet-system/plugins/pmpmRuntime.ts`

结论：

- Manifest v2 必须把原始描述和安装状态拆开

### 2.4 当前配置与跨窗口同步事实

当前插件配置模型是：

- 每插件一个 `localStorage` key
- 任意 JSON
- 用 `storage event` 与 Tauri 事件做跨窗口同步

相关代码：

- `apps/desktop/src/magnet-system/plugins/pluginConfig.ts`
- `apps/desktop/src/modules/storage/index.ts`
- `apps/desktop/src/utils/windowCommunication.ts`

结论：

- Manifest v2 必须声明 config schema、scope、sync 语义
- 不能继续只描述“插件入口”和“若干贡献”

## 3. 术语

### 3.1 Raw Manifest

包内静态元数据，不包含宿主安装状态。

### 3.2 Install Record

宿主在安装后生成的记录，包含：

- 完整性校验
- 签名验证结果
- 启停策略
- 用户拒绝的能力
- runtime 健康状态摘要

### 3.3 Resolved Runtime

宿主根据 manifest、当前平台、信任策略、运行时可用性解析出的最终执行入口。

## 4. Manifest v2 顶层模型

```ts
export interface PxpManifestV2 {
  schemaVersion: '2.0';
  kind: 'extension';

  identity: {
    id: string;
    publisher: string;
    version: string;
    name: string;
    displayName?: string;
    description?: string;
    license?: string;
    homepage?: string;
    repository?: string;
    keywords?: string[];
    categories?: string[];
    icon?: string;
  };

  hostTargets: HostTargetDescriptor[];
  runtimes: RuntimeEntryDescriptor[];
  activationEvents?: ActivationEventDescriptor[];

  requiresCapabilities?: CapabilityRequirement[];
  optionalCapabilities?: CapabilityRequirement[];
  providesCapabilities?: CapabilityProvision[];

  dependencies?: DependencyDescriptor[];
  resourceBundles?: ResourceBundleDescriptor[];
  config?: ConfigContributionDescriptor;
  locales?: LocaleBundleDescriptor[];
  contributes?: ManifestContributionDescriptor;
  integrity?: IntegrityDescriptor;
  trustHints?: TrustHintsDescriptor;
  compat?: CompatDescriptor[];
}
```

## 5. 字段语义

### 5.1 `schemaVersion`

固定为 `2.0`。

要求：

- 用来区分 manifest 语义版本，而不是插件自身版本
- 不再沿用 `formatVersion: "1.0"` 这种 PMPM 专用命名

### 5.2 `kind`

当前规范内固定为 `extension`。

说明：

- 主题包、配置包、compat 包可以在未来独立定义 manifest 变体
- 不能再用 `magnet-plugin` 这种宿主化 kind 作为平台顶层类型

### 5.3 `identity`

`identity` 负责静态身份，不负责安装时状态。

要求：

- `id` 使用稳定插件 id，不能与宿主内建 id 产生冲突
- `publisher` 独立存在，不能再塞进模糊的 metadata
- `version` 采用 semver 或 semver-compatible 字符串
- `name` 是稳定技术名
- `displayName` 是可本地化的显示名入口

### 5.4 `hostTargets`

显式声明可运行宿主，而不是把 PMP 作为默认真理。

建议结构：

```ts
type HostTargetDescriptor = {
  hostId: string;
  versionRange?: string;
  required?: boolean;
  conditions?: Record<string, unknown>;
};
```

例子：

- `pmp`
- `musictag`

### 5.5 `runtimes`

Manifest v2 必须从单 `entryPoint` 升级为多 runtime 入口描述。

建议结构：

```ts
type RuntimeEntryDescriptor = {
  runtimeId: string;
  kind: 'extension-host' | 'webview' | 'sidecar';
  entry: string;
  platform?: string[];
  arch?: string[];
  priority?: number;
  sandbox?: 'strict' | 'host-supervised' | 'native';
  bridge?: string;
  provides?: string[];
  dataPlane?: {
    kinds: Array<'inline-json' | 'shared-memory' | 'pipe' | 'local-socket'>;
  };
};
```

要求：

- 同一个插件可以同时携带多个 runtime
- sidecar 入口必须允许按 `platform / arch` 分发
- runtime 解析必须由宿主根据当前环境决定

### 5.6 `activationEvents`

必须显式描述插件在什么条件下激活。

建议至少支持：

- `onStartup`
- `onCommand:<id>`
- `onView:<id>`
- `onCapability:<capabilityId>`
- `onHost:<hostId>`
- `onFile:<glob>`

结论：

- 不能再默认“安装后即整体加载入口模块”

### 5.7 `requiresCapabilities` / `optionalCapabilities` / `providesCapabilities`

这是 Manifest v2 的核心。

要求：

- `requiresCapabilities` 定义插件无法工作时必须拿到的能力
- `optionalCapabilities` 定义可降级的能力
- `providesCapabilities` 定义插件向宿主或其他插件暴露的能力

建议结构：

```ts
type CapabilityRequirement = {
  capabilityId: string;
  versionRange?: string;
  reasons?: string[];
};

type CapabilityProvision = {
  capabilityId: string;
  version: string;
  runtimeId?: string;
  visibility?: 'host-only' | 'workspace' | 'public';
};
```

说明：

- 这组字段取代当前粗糙的 `permissions[]`
- 网络、存储、宿主服务访问，最终都应归入 capability negotiation，而不是平面 permission 列表

### 5.8 `dependencies`

插件依赖不能只停留在 npm 模块层面。

建议结构：

```ts
type DependencyDescriptor = {
  id: string;
  kind: 'plugin' | 'host-pack' | 'resource-pack' | 'compat-layer';
  versionRange?: string;
  optional?: boolean;
};
```

### 5.9 `resourceBundles`

Manifest 必须显式声明资源包，而不是让 runtime 自己猜测文件布局。

建议覆盖：

- locale bundles
- web assets
- binary artifacts
- model files
- analyzer presets

### 5.10 `config`

Manifest v2 必须原生包含配置契约。

建议结构：

```ts
type ConfigContributionDescriptor = {
  schema: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  migrations?: Array<{
    from: string;
    to: string;
    strategy: string;
  }>;
  persistenceScope?: 'workspace' | 'profile' | 'device' | 'temp';
  syncScope?: 'none' | 'same-host-windows' | 'same-profile' | 'cloud';
};
```

原因：

- 当前 `pluginConfig.ts` 已经暴露出“跨窗口同步”和“配置持久化”是正式边界
- 不能继续靠每插件独立拼接 key

### 5.11 `locales`

Manifest 需要声明插件自己的消息包。

建议结构：

```ts
type LocaleBundleDescriptor = {
  locale: string;
  path: string;
  fallback?: boolean;
};
```

说明：

- 宿主不应直接把自身 i18n key 空间泄露给插件
- 插件也不应只提交已经翻译好的单语言标题字符串

### 5.12 `contributes`

Manifest v2 的贡献模型必须分层。

建议结构：

```ts
type ManifestContributionDescriptor = {
  core?: {
    commands?: unknown[];
    keybindings?: unknown[];
    views?: unknown[];
    menus?: unknown[];
    providers?: unknown[];
    tasks?: unknown[];
  };
  host?: Record<string, unknown>;
};
```

要求：

- `commands` 与 `keybindings` 进 core
- `page/window/panel/magnet/visualizer` 进入 `contributes.host.<hostId>`
- PMP 的 magnet 默认展示信息也应下沉到 `host.pmp.*`

### 5.13 `integrity`

Manifest 只描述完整性要求，不保存安装后计算结果。

建议结构：

```ts
type IntegrityDescriptor = {
  manifestDigest?: string;
  artifactDigests?: Array<{
    path: string;
    sha256: string;
  }>;
  signature?: {
    format: string;
    path: string;
  };
};
```

### 5.14 `trustHints`

仅用于声明意图，不代表宿主最终信任决定。

可包含：

- 是否要求 native sidecar
- 是否需要高频数据面
- 是否包含外部网络访问
- 是否希望进入官方信任域

### 5.15 `compat`

用于描述旧系统兼容入口，例如：

- `compat.pmpm`

要求：

- compat 信息不能污染 core
- 只能用于迁移和降级，不得变成未来主线契约

## 6. Install Record 规范性要求

Manifest v2 之外，宿主必须维护单独的安装记录。

至少应包含：

```ts
type InstalledExtensionRecord = {
  manifest: PxpManifestV2;
  installedAt: number;
  packageDigest?: string;
  resolvedArtifacts?: Array<{
    runtimeId: string;
    path: string;
    sha256?: string;
  }>;
  signature?: {
    verified: boolean;
    keyId?: string;
    summary?: string;
  };
  enabled: boolean;
  disabledReason?: 'manual' | 'crash' | 'policy';
  deniedCapabilities?: string[];
  lastError?: string;
  lastErrorAt?: number;
};
```

要求：

- `enabled/disabledReason` 不能回写 raw manifest
- `deniedCapabilities` 属于宿主状态，不属于插件自描述
- runtime 崩溃与政策禁用都属于安装记录层

## 7. PMPM v1 到 Manifest v2 的兼容映射

### 7.1 可直接映射的字段

- `formatVersion` -> `schemaVersion`
- `metadata.id` -> `identity.id`
- `metadata.name` -> `identity.name`
- `metadata.version` -> `identity.version`
- `metadata.description` -> `identity.description`
- `metadata.tags` -> `identity.keywords`
- `entryPoint` -> `runtimes[0].entry`

### 7.2 只能兼容迁移、不能保留为主线的字段

- `type: "magnet-plugin"` -> `kind: "extension"` + `compat.pmpm`
- `permissions[]` -> best-effort 映射到 `requiresCapabilities[]`
- `contributions.pages/windows/settingsPanels/visualizers` -> `contributes.host.pmp.*`
- `magnet.*` -> `contributes.host.pmp.magnets.*`

### 7.3 无法继续保留的假设

- 所有插件都只有一个 JS 入口
- 所有插件都运行在同一种 runtime
- 所有贡献都天然属于 PMP UI
- 所有能力都可以压成一维 permission 字符串

## 8. 当前契约与目标契约对比

| 维度 | 现有 PMPM / shared contracts | Manifest v2 | 评估 |
| --- | --- | --- | --- |
| 顶层类型 | `magnet-plugin` | `extension` | 现状被 PMP 形状锁死 |
| runtime 描述 | 单 `entryPoint` | `runtimes[]` | 现状无法表达 sidecar / webview / extension-host 并存 |
| 激活模型 | 基本隐式 | `activationEvents[]` | 现状无法按需激活 |
| 能力声明 | `permissions[]` | `requires/optional/providesCapabilities` | 现状不具协商能力 |
| 贡献模型 | 单宿主贡献桶 | `core` 与 `host` 分层 | 现状强宿主泄露 |
| 配置模型 | manifest 外自建 key-value | manifest 原生声明 schema/scope | 现状无法平台化迁移 |
| locale | 基本缺席 | `locales[]` | 现状只支持宿主文案 |
| 完整性 | 安装时零散 sha256 / signature | manifest 描述 + install record 结果 | 现状混层 |

## 9. 明确的边界判断

Manifest v2 不负责：

- runtime 心跳协议细节
- capability 流式传输细节
- host shell 具体行为
- provider session 生命周期实现

这些分别属于：

- runtime bridge
- capability protocol
- host pack

## 10. 审计结论

当前 Manifest v1 不是“字段不够多”，而是模型本身有 4 个根问题：

1. 它把 PMP 视为默认宿主。
2. 它把 runtime 简化成单文件入口。
3. 它把能力协商压扁成一维 permission。
4. 它把安装状态和原始声明混在一起。

因此 Manifest v2 必须整体换模型，而不是在旧结构上继续堆字段。
