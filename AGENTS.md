# AGENTS.md - Pixel Matrix Player 工程开发规范（pnpm workspace + Tauri + React + TypeScript + Rust）

本文档用于指导人类开发者与自动化工具（Codex / Agent）在仓库内协作开发，目标是让项目在“高性能桌面应用 + 插件生态 + 微内核解耦”的前提下，保持一致的：目录结构、模块边界、命名方式、契约规范与质量门禁。

适用范围：本仓库根目录与 `apps/*`、`packages/*`、`scripts/*`、`docs/*`、`logs/*`、`Mannuals/*`（包含 `apps/desktop/src-tauri` 的 Rust 代码）。

约束等级：
- **必须/禁止**：强约束，违反即视为不合规。
- **建议**：推荐做法，可评审后调整，但需同步更新本文档与相关架构文档。

重构/架构入口（必须先读）：
- 项目入口与命令：`README.md`
- 文档索引：`DOCUMENTATION.md`
- 微内核重构总规划（Single Source of Truth）：`docs/refactor.md`
- 技术架构（现状/目标/契约/算法/接口/状态矩阵）：`docs/architecture/`
- UI 设计（Editor / NavigationPage / MusicLibrary）：`docs/ui/`
- 测试与验收（按模块解耦）：`docs/qa/`

---

# 0. 总则（必须遵守）

1. **安全第一**：任何可能导致数据丢失、历史不可逆、批量破坏性修改的操作（例如删库/清空存储/重置配置/批量重命名/重写迁移）必须先说明影响范围与回滚方案。
2. **边界优先**：先定边界（目录/模块/契约/依赖方向）再写实现。边界参考：`docs/architecture/philosophy.md`。
3. **最小改动原则**：优先做最小可验证变更，避免“顺手重构”扩大影响面；大改必须拆阶段并对齐 `docs/refactor.md` 的 Phase。
4. **语言边界清晰**：
   - 前端/工具链：TypeScript（业务代码默认不新增 `.js`；配置/脚本例外）。
   - 后端：Rust（Tauri commands/windows/native audio）。
5. **契约先行**：跨边界交互必须有契约与版本策略（插件 Host API、Tauri commands/events、存储 schema），并同步到 `docs/architecture/contracts/*`。
6. **性能与无损优先**：UI 关键路径禁止同步重任务（解压/大 JSON/哈希/全量扫描）；音频线程禁止分配/阻塞；迁移必须可回滚。
7. **先跑通再打磨再优化**：遵循 `Make it work → Make it right → Make it fast`，并用 `docs/qa/` 的验收项保护回归。

（可选）用“四象限”快速校准职责边界：

| 概念 | 说明 | 常见落点（本项目） |
|---|---|---|
| 消费端 | 接收外部输入或依赖注入的入口 | React 事件/页面入口、Tauri commands、插件入口 `mount()` |
| 生产端 | 产生输出或副作用的出口 | 音频输出、文件/IndexedDB 写入、窗口创建、IPC/事件发布 |
| 状态 | 存储系统信息的数据 | localStorage/IndexedDB、Rust 静态状态、窗口状态 |
| 变换 | 纯逻辑处理 | 布局算法、参数校验、schema 映射、DSP 处理（实时约束） |

---

# 1. 技术栈（必须明确）

## 1.1 基线技术栈（必须具备）

- 运行时与包管理：Node.js `>=18` + `pnpm >=8`（pnpm workspace）
- 语言：
  - TypeScript（前端/脚本/devkit）
  - Rust（Tauri backend、native audio、窗口管理）
- 代码规范：ESLint + Prettier（TS）；rustfmt（Rust，建议）
- 测试：Vitest（TS）；cargo test（Rust）

## 1.2 桌面端（前端）栈

- 框架：React 18
- 构建：Vite 5
- 渲染/交互：Pixi.js（像素矩阵）
- 状态：Zustand + React Context（现状）；To‑Be 的模块化边界见 `docs/refactor.md`
- 样式：TailwindCSS + CSS（以现有工程为准）

## 1.3 桌面端（后端）栈

- 桌面框架：Tauri 1.x
- Rust：stable toolchain（按 `apps/desktop/src-tauri/Cargo.toml`）
- Native Audio：rodio/symphonia/rubato/rustfft 等（实时约束见 `docs/architecture/algorithms/audio-dsp-graph.md`）
- Sidecar：VST bridge（独立进程，IPC 协议；需要时依赖 CMake/JUCE）

## 1.4 依赖版本策略与文档查询（必须遵守）

- 依赖变更（新增/升级/移除）必须：
  - 明确兼容性（Node/TS/Vite/Tauri/Rust 组合）
  - 通过 `pnpm lint` + `pnpm type-check` + `pnpm test`（涉及 Rust 变更则 `cargo test`）
  - 更新 lockfile（本仓库使用 `pnpm-lock.yaml`；如策略调整需在文档中说明）
- 不确定 API/参数/行为时禁止“猜”：
  - 人工开发：查官方文档/Release Notes
  - Agent：优先用仓库内既有实现/测试作为事实来源，再查官方文档

---

# 2. 目录结构（必须遵守）

## 2.1 根目录（Monorepo 上帝视角）

```
.
├─ apps/
│  └─ desktop/                  # Tauri 桌面应用（React + Rust）
├─ packages/
│  └─ magnet-devkit/            # PMPM 开发工具链（create/lint/pack/sign）
├─ scripts/                     # 构建/诊断脚本（node/mjs）
├─ docs/                        # 重构/架构/UI/验收（本轮新增）
├─ logs/                        # 阶段日志/审计记录（按日期）
├─ Mannuals/                    # 手册/落地说明（历史/长期沉淀）
├─ package.json                 # 根脚本入口（pnpm --filter）
└─ pnpm-workspace.yaml          # workspace 配置
```

阶段日志/审计记录统一放 `logs/`（根目录）；请勿新增 `docs/logs/`。

禁止修改/提交的目录（必须遵守）：
- `**/node_modules/`
- `apps/desktop/dist/`
- `apps/desktop/src-tauri/target/`

## 2.2 `apps/desktop/`（前端 + Tauri 后端）

```
apps/desktop/
├─ src/                         # React/TS
├─ src-tauri/                   # Rust/Tauri
├─ tests/                       #（如存在）集成/端到端（以工程为准）
└─ package.json                 # dev/build/test/lint/type-check
```

关键子系统（建议先读对应 docs）：
- Magnet/插件宿主：`apps/desktop/src/magnet-system/`（对应：`docs/architecture/contracts/plugin-host-api.md`）
- Shader 系统（To-Be，规划：R3）：`apps/desktop/src/shader-system/`（算法参考：`docs/architecture/algorithms/shader-fuse.md`）
- 音频服务：`apps/desktop/src/services/audio/`（对应：`docs/architecture/algorithms/audio-dsp-graph.md`）
- Storage 边界：`apps/desktop/src/modules/storage/`（**禁止** UI 直接调用 `localStorage`）

## 2.3 `apps/desktop/src-tauri/`（Rust backend）

```
apps/desktop/src-tauri/src/
├─ main.rs                      # Tauri 入口与 command 注册（保持薄）
├─ windows/                     # 窗口创建/复用/隐藏策略
├─ native_audio.rs              # Native audio engine + DSP（现状：最小链）
├─ music_library.rs             # 扫描/封面/缓存等
└─ vst_bridge.rs                #（To-Be）VST sidecar IPC
```

约束（必须遵守）：
- `main.rs` 仅做 wiring（注册 commands、初始化、少量 glue），重逻辑下沉到模块文件。
- 音频处理路径必须遵守实时约束（不分配、不阻塞、可降级）。

## 2.4 `packages/`（可复用包）

现状主要包：
- `packages/magnet-devkit/`：`.pmpm` 插件开发工具链（zip/打包/签名）。

约束（必须遵守）：
- packages 的公共 API 必须从 `index.ts`（或等价入口）导出；内部实现不对外承诺稳定性。
- 若要对插件作者提供 SDK/类型定义，必须独立成包（规划见 `docs/architecture/interface-plan.md`），禁止直接复用应用内部类型。

---

# 3. packages 约定（可放什么 / 禁止放什么）

允许放在 `packages/` 的内容（建议）：
- host SDK（对插件公开的 types + helpers）
- devkit/cli（例如 `pmpm`）
- 纯工具库（不绑定 UI/运行时）

禁止（必须遵守）：
- 把 `apps/desktop/src` 的内部实现直接复制进 `packages/` 作为“共享代码”（会污染边界）
- 让 packages 依赖桌面专有能力（Tauri/Rust only）而又声称“可复用”

---

# 4. 前端分层与模块边界（必须遵守）

## 4.1 To‑Be 依赖方向（强约束，重构阶段按 `docs/refactor.md` 渐进落地）

目标依赖方向：
1. `kernel/`（ServiceRegistry/EventBus/ContributionRegistry/Governance）
2. `services/`（Audio/Storage/Windowing/...）
3. `features/`（Music Library/DSP Rack/Plugins/...）
4. `ui/`（React 组件）

禁止：
- Kernel import UI/Feature 实现
- Feature 直接 import 另一个 Feature 的内部实现（必须走服务/事件/贡献点）
- 插件直接 import `apps/desktop/src/*` 内部实现（只能走 Host API/SDK）

> 现状目录还未完全迁移；新增/重构代码请优先对齐该方向，避免耦合继续增长。

## 4.2 Storage 边界（强约束）

- **禁止**在 UI/业务代码里直接访问 `localStorage`（读写/监听）。
- **必须**使用 `apps/desktop/src/modules/storage/*` 的 API。
- 跨窗口同步必须通过 `broadcastDataUpdate`/`setup*Listener`（见 `apps/desktop/src/utils/windowCommunication.ts`）。

## 4.3 插件边界（强约束）

- 对 `.pmpm`/Host API 的改动必须：
  - 更新 `docs/architecture/contracts/plugin-host-api.md`
  - 更新版本策略（见 `docs/architecture/contracts/versioning.md`）
  - 保持向后兼容（除非明确提高 major 并提供迁移/禁用策略）
- 新增权限/能力点必须：
  - 默认拒绝（deny-by-default）
  - 有 UI 提示与审计（best-effort 也要可追溯）

---

# 5. Rust/Tauri 分层与约束（必须遵守）

## 5.1 Command 处理链路（必须保持“薄”）

- `main.rs`：注册 commands / wiring。
- 模块文件（`native_audio.rs`/`music_library.rs`/`windows/*`）：承载核心实现与状态机。
- 重任务必须 `spawn_blocking` 或独立线程；禁止阻塞 UI 线程。

## 5.2 并发与实时约束（强约束）

- 音频处理：
  - 处理函数不得分配大量内存、不得阻塞 IO、不得持锁过久。
  - 失败要可降级（bypass/回退），并向 UI 上报可诊断错误。
- IPC/sidecar：
  - 任何跨进程协议都必须版本化，并文档化（规划见 `docs/architecture/algorithms/audio-dsp-graph.md`）。

---

# 6. 语言、命名与注释（必须遵守）

- 代码标识符：英文（camelCase/PascalCase），文件夹优先 `kebab-case`。
- 用户可见文案：可中文（保持一致风格）。
- Window/Route 命名：遵循 `docs/architecture/page-window-management.md` 的规范（label/route/id 格式）。
- 注释：只写“为什么”（why），避免重复代码本身；跨线程/实时约束处允许必要注释。

---

# 7. TypeScript 规范（必须遵守）

- 任何跨边界输入（插件 manifest、Tauri event payload、外部文件）必须做运行时校验（不要直接信任 `any`）。
- 禁止在核心路径滥用 `any`；优先 `unknown` + 断言/校验。
- 事件/契约/存储结构变更必须补测试或脚本化验证（见 `docs/qa/`）。

## 7.1 i18n（文案）规范（必须遵守）

- **新增用户可见文案禁止硬编码**：必须使用 `t()` / `useT()`，并在 `apps/desktop/src/i18n/locales/zh-CN.json` 添加稳定 key。
- **Key 是稳定 API**：禁止复用同一个 key 表达不同含义；建议使用 `common.*` / `settings.*` / `pages.*` / `windows.*` 等域划分。
- **禁止拼接翻译碎片**：统一使用插值参数 `t('key', { name })`，避免 `t('a') + name + t('b')`。
- **不要持久化翻译结果**：存储/协议只存 ID/枚举值，渲染时再 `t()`；禁止把中文/英文文案写进 storage 或 IPC payload。
- **Contribution 标题/描述要支持切换刷新**：注册时使用 `t()` 生成快照，并用 `subscribeLocale(() => sync())` + `register(..., { replace: true })` 重新注册（参考 `apps/desktop/src/builtin-modules/builtinWorkbenchesModule.tsx`）。
- **插件字段不由宿主翻译**：插件 manifest 的 title/description 等按原样展示；宿主的 UI 标签/按钮/空状态等仍必须 i18n。
- 进度跟踪与开发指南：`docs/guides/i18n.md`

---

# 8. 样式与 UI 规范（必须遵守）

- 主窗口 UI（像素矩阵 + magnets）必须优先考虑“对齐网格/可读性/性能”。
- Editor/Music Library 属于高密度工具 UI，可用更复杂布局，但必须：
  - 有明确加载/进度/错误状态
  - 不做同步重任务阻塞渲染
- 确认/取消（confirm/cancel）交互：禁止使用系统弹窗（避免异步/焦点问题），统一使用应用内自定义 Modal/Window。
- UI 规范与页面分区请参考：
  - `docs/ui/editor-window.md`
  - `docs/ui/navigation-page.md`
  - `docs/ui/music-library.md`

---

# 9. ESLint / Prettier（必须遵守）

- 变更后必须通过：
  - `pnpm lint`
  - `pnpm type-check`
  - `pnpm test`（涉及逻辑变更）
- 禁止随意添加 `eslint-disable`；若确需禁用必须说明原因且限制范围最小。

---

# 10. 变更流程与危险操作确认机制（必须遵守）

1. 先更新规划/状态：
   - 大改动必须先更新 `docs/refactor.md` 与 `docs/architecture/status.md`
2. 最小闭环交付：
   - 每次 PR/提交尽量只做一类变更（功能/修复/重构不要混在一起）
3. 质量门禁：
   - 至少 `lint + type-check`；核心逻辑变更补 `test`

---

# 11. 文档维护（必须遵守）

当出现以下任一情况，必须同步更新文档（或其指向的文档）：

- 调整目录结构与模块边界 → `docs/architecture/directory-structure.md`
- 调整 Page/Window/Route 规则 → `docs/architecture/page-window-management.md`
- 调整插件 Host API / manifest → `docs/architecture/contracts/plugin-host-api.md`
- 调整版本/迁移策略 → `docs/architecture/contracts/versioning.md`
- 实现/推进重构阶段 → 更新 `docs/architecture/status.md` 与 `docs/qa/acceptance-matrix.md`

---

# 12. Spec-Driven（建议）

当需求跨多个子系统（插件/音频/窗口/渲染）或涉及架构调整时，建议采用：

```
草案 → 对齐（契约/边界/验收）→ 实施（分阶段）→ 归档（状态矩阵更新）
```

最小要求：把“边界/契约/验收”写进 `docs/refactor.md`/`docs/architecture/*`，并让后续改动可追溯。
