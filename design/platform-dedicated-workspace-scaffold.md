# Platform Dedicated Workspace 脚手架（P0-P3 一步到位版）

更新时间：2026-03-01

## 目标

为 `platform-magnet` 提供可扩展的多平台专属工作区脚手架，保证：

1. 每个平台实例按 `connectorId` 独立。
2. PMP 可聚合平台能力，但平台模块不反向依赖 PMP 系统歌单。
3. 新平台接入时只需补“平台适配层 + 业务 controller”，不改主流程。

## 当前落地结果

### 1) Connector 定义层已具备 dedicated 扩展能力

- 文件：`apps/desktop/src/modules/music-platform/connectorAuth.ts`
- `PlatformConnectorWorkspaceKind` 已开放为 `string`。
- 当前内置 dedicated 工作区：
  - `connector.platform.bilibili`
  - `connector.platform.netease`（占位）
  - `connector.platform.qqmusic`（占位）

### 2) Workspace 模式与描述统一

- 文件：`apps/desktop/src/components/magnet/platformPage/platformWorkspaceModes.ts`
- 模式使用 `workspace:${connectorId}` + `generic`。
- UI 模式来源完全由 `listPlatformConnectorDefinitions()` 驱动。

### 3) 适配器解析支持 connector 优先

- 文件：`apps/desktop/src/components/magnet/platformPage/platformWorkspaceAdapterRegistry.tsx`
- 解析优先级：
  1. `connectorId` 精确命中
  2. `workspaceKind` 回退
- 现阶段已注册 `bilibili` 专有适配器；其余 dedicated connector 走通用占位视图。

### 4) PlatformMagnet 主流程已去硬编码

- 文件：`apps/desktop/src/components/magnet/platformPage/PlatformMagnet.tsx`
- `Bilibili` 业务状态已下沉到：
  - `useBilibiliWorkspaceAdapterController.ts`
- `PlatformMagnet` 只负责：
  - workspace 选择
  - connector scope 的歌单状态隔离
  - 通用搜索面板
  - 适配器渲染分发

## 新平台接入模板（标准步骤）

### Step A：注册 connector 定义

在 `connectorAuth.ts` 添加/更新定义：

- `connectorId`: `connector.platform.xxx`
- `workspaceMode`: `dedicated`
- `workspaceKind`: 建议使用平台标识（如 `netease`）

### Step B：补专有 adapter（可选）

在 `platformPage/` 下新增：

1. `XxxWorkspaceAdapter.tsx`
2. `useXxxWorkspaceAdapterController.ts`

并在 `platformWorkspaceAdapterRegistry.tsx` 注册 connector 级映射。

### Step C：保持边界

- 平台层只暴露平台能力与平台歌单来源。
- 最近播放/智能歌单由 PMP 统一层维护。
- 禁止在 platform connector 内反向读取 PMP 系统歌单。

## 验证清单

1. dedicated tab 是否按 connector 独立出现。
2. 未接入平台是否显示占位，不影响已接入平台。
3. Bilibili 工作区状态切换后不串台。
4. playlist scope（selected/newName/error）按 connector 隔离。
5. type-check / lint / adapter 相关测试全部通过。

