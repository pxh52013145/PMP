# Pixel Matrix Player (PMP)

一个以“像素点阵 + 磁贴组件（Magnets）”为核心 UI 的桌面音乐播放器（Tauri + React + TypeScript + Rust）。

## 快速开始

前置要求：
- Node.js `>= 18`
- pnpm `>= 8`
- Rust（stable toolchain）

安装依赖：

```bash
pnpm install
```

开发运行（桌面端，推荐）：

```bash
pnpm dev
```

并行前端模式：

```bash
# desktop（apps/desktop）+ 现有 tauri backend
pnpm dev

```

（可选）启用 ASIO 输出后端的构建（Windows，SDK gate）：

```bash
pnpm dev:asio
```

> 需要手动准备 Steinberg ASIO SDK 并设置 `CPAL_ASIO_DIR`，详见 `legacy/docs/guides/asio-sdk.md`。

仅启动前端（不启动 Tauri）：

```bash
pnpm dev:web
```

构建：

```bash
pnpm build
```

测试与检查：

```bash
pnpm test
pnpm type-check
pnpm lint
```

Rust（可选）：

```bash
cd apps/desktop/src-tauri
cargo test
```

## 文档入口

- 当前阶段采用源码优先；历史文档已归档：`legacy/`
- 归档索引：`legacy/README.md`

## 工程结构

- `apps/desktop/`：桌面应用（React + Tauri）
- `packages/app-contracts/`：跨前端/后端共享契约（command/event/perf profile key）

## 开发协作规范

请先阅读：`AGENTS.md`（目录边界、契约规范、质量门禁）。
