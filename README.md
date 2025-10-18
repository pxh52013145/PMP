# 🎵 Pixel Matrix Player

> 一款基于像素点阵设计的高度可定制化桌面应用

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-orange)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://reactjs.org)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange)](https://www.rust-lang.org)

## ✨ 项目简介

Pixel Matrix Player 是一款创新的桌面应用，将**像素艺术**和**高度自定义**完美结合。通过独特的像素点阵系统和 Magnet 组件，让每个用户都能打造独一无二的界面。

### 核心特色

- 🎨 **像素点阵系统** - 27×20 的像素网格，每个像素点都可交互
- 🧲 **Magnet 组件** - 可拖动的磁性组件，通过锚点吸附到像素网格
- ✏️ **强大编辑器** - 8个独立窗口，支持实时编辑和预览
- 🖼️ **多样背景** - 支持纯色/渐变/图片/视频/HTML 自定义背景
- 💾 **配置管理** - 自动保存/加载，支持导入/导出分享
- 🎭 **赛博朋克风格** - 玻璃拟态、霓虹发光、动态边框

## 📸 已实现功能

### Pixel 点阵系统

- 27列×20行的交互式像素网格
- 实时占用率统计
- 动态颜色显示（空闲/占用/悬停）

### Magnet 组件系统

12个内置组件：

- **窗口控制** - 最小化、最大化、关闭按钮
- **拖动手柄** - 无边框窗口拖动
- **播放控制** - 播放/暂停、上一曲/下一曲、模式、音量
- **进度条** - 音乐进度显示
- **歌曲信息** - 歌曲名称和艺术家
- **编辑器按钮** - 切换编辑模式

### 编辑器系统

8个独立编辑窗口：

- **Control Panel** - 主控制面板
- **Statistics** - 像素占用统计
- **Library** - Magnet 库管理
- **Creator** - Magnet 创建和编辑
- **Style Editor** - 动画和样式设置
- **Background Manager** - 背景管理
- **Custom Background Editor** - 高级背景编辑
- **Help** - 使用帮助

### 背景系统

- 支持 5 种背景类型（纯色/渐变/图片/视频/HTML）
- 窗口模式和最大化模式独立配置
- 20+ 预设背景
- 实时预览和编辑

## 🎮 快速体验

项目目前处于 **UI 框架完成阶段**，核心编辑系统已实现，音频功能待开发

## 🏗️ 技术栈

### 前端

- **React 18** - UI框架
- **TypeScript** - 类型安全
- **PixiJS** - 2D渲染引擎（用于Pixel点阵渲染）
- **CSS3** - 样式和动画（玻璃拟态、霓虹效果）
- **Context API** - 状态管理

### 后端

- **Rust** - 核心引擎
- **Tauri 2.0** - 跨平台框架和窗口管理
- **LocalStorage** - 配置持久化

### 未来计划

- **音频引擎** - rodio/cpal + symphonia
- **数据库** - SQLite
- **音乐API** - 网易云、酷狗

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Rust 1.75+
- pnpm 8+

### 安装依赖

```bash
# 克隆仓库
git clone https://github.com/yourusername/pixel-matrix-player.git
cd pixel-matrix-player

# 安装依赖
pnpm install

# 安装Rust依赖
cd apps/desktop/src-tauri
cargo build
```

### 开发模式

```bash
# 启动开发服务器
pnpm dev

# 仅启动前端
pnpm dev:web

# 仅构建Rust后端
pnpm dev:tauri
```

### 构建生产版本

```bash
pnpm build
```

## 📖 文档

完整的项目文档请查看 **[Mannuals/](./Mannuals/)** 目录。

> 💡 **开发阶段说明**: 项目当前处于开发阶段，优先完善开发文档。用户文档将在项目完成后补充。

### 🚀 快速开始

- 🛠️ [开发环境配置](./GETTING_STARTED.md) - 环境配置和启动指南
- 📋 [文档开发状态](./Mannuals/DEVELOPMENT_STATUS.md) - 文档完成进度

### 🔧 开发文档（当前重点）

**开发者指南**：

- 🏗️ [系统架构](./Mannuals/developer-guide/architecture/) - 整体设计
- 📚 [API 参考](./Mannuals/developer-guide/api-reference/) - 接口文档
- 📖 [开发指南](./Mannuals/developer-guide/guides/) - 创建新功能
- 📋 [开发规范](./Mannuals/developer-guide/standards/) - 开发标准
- 🤝 [贡献指南](./Mannuals/developer-guide/contributing/) - 参与开发

**技术文档**：

- 🔍 [技术实现](./Mannuals/technical-docs/) - 深入系统原理
- 📐 [Pixel 系统](./Mannuals/technical-docs/pixel-system/) - 渲染引擎
- 🧲 [Magnet 系统](./Mannuals/technical-docs/magnet-system/) - 组件实现
- 🪟 [编辑器系统](./Mannuals/technical-docs/editor-system/) - 窗口架构

### 👤 用户文档（项目完成后）

> ⚠️ 用户文档将在项目基本完成后补充，当前可参考开发文档了解功能。

查看 [Mannuals/README.md](./Mannuals/README.md) 获取完整文档索引。

## 🗺️ 开发路线图

### Phase 1: UI 框架 ✅ 已完成

- [x] 项目架构搭建（Tauri 2.0 + React 18 + TypeScript）
- [x] Pixel 点阵渲染系统（27×20网格）
- [x] Magnet 组件系统（12个内置组件）
- [x] 编辑器系统（8个独立窗口）
- [x] 配置管理系统（自动保存/加载/导入/导出）
- [x] 背景系统（5种类型 + 20+预设）
- [x] 窗口通信机制（localStorage + Tauri事件）

### Phase 2: 音频功能 🔄 进行中

- [ ] Rust 音频引擎（rodio + symphonia）
- [ ] 本地音乐文件播放
- [ ] 播放控制（播放/暂停/上一曲/下一曲）
- [ ] 音量控制和进度条
- [ ] 播放模式（顺序/随机/单曲循环）
- [ ] 播放列表管理

### Phase 3: 高级功能 📅 计划中

- [ ] 音频可视化（频谱、波形）
- [ ] 均衡器（EQ）
- [ ] 歌词显示
- [ ] 搜索和过滤
- [ ] 音乐库管理

### Phase 4: 网络功能 💭 未来规划

- [ ] 网易云音乐 API 集成
- [ ] 酷狗音乐 API 集成
- [ ] 在线搜索和播放
- [ ] 歌曲信息获取

### Phase 5: 扩展功能 💭 未来规划

- [ ] 主题市场（分享和下载配置）
- [ ] 插件系统
- [ ] 自定义 Magnet 市场
- [ ] 社区功能

## 🤝 贡献指南

我们热烈欢迎社区贡献！无论是代码、设计、文档还是想法。

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 贡献类型

- 🐛 **Bug修复** - 发现问题？帮我们修复它！
- ✨ **新功能** - 有好点子？实现它！
- 🎨 **UI/UX设计** - 设计漂亮的界面和组件
- 📚 **文档** - 改进文档，帮助更多人
- 🎵 **主题/组件** - 创作并分享你的作品
- 🔌 **插件** - 扩展播放器功能

## 📊 项目状态

> 🎨 **当前阶段**: UI 框架已完成，音频功能开发中

**已完成**:

- ✅ 完整的 UI 编辑系统
- ✅ Magnet 组件框架
- ✅ 配置管理系统
- ✅ 背景自定义系统

**进行中**:

- 🔄 音频播放引擎
- 🔄 文档完善

**下一步**:

- 📅 本地音乐播放
- 📅 播放列表管理

## 🤝 贡献指南

欢迎贡献！无论是代码、设计还是文档。

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

### 贡献方向

- 🐛 **Bug 修复** - 发现并修复问题
- ✨ **新功能** - 实现新特性
- 🎨 **UI/UX 改进** - 优化界面和交互
- 📚 **文档** - 改进文档质量
- 🧲 **Magnet 组件** - 创作新的组件
- 🎭 **主题** - 设计新的背景和风格

## 📜 开源协议

本项目采用 [MIT 协议](LICENSE) 开源。

## ⚠️ 免责声明

本项目计划集成的第三方音乐平台 API 仅供个人学习和研究使用：

- 音乐版权归原平台及版权方所有
- 请尊重版权，支持正版音乐
- 禁止用于商业目的
- 使用本软件产生的法律责任由用户自行承担

## 💬 社区

- **问题反馈**: [GitHub Issues](https://github.com/yourusername/pixel-matrix-player/issues)
- **讨论**: [GitHub Discussions](https://github.com/yourusername/pixel-matrix-player/discussions)

## 🙏 致谢

- [Tauri](https://tauri.app) - 强大的跨平台框架
- [PixiJS](https://pixijs.com) - 优秀的 2D 渲染引擎
- [React](https://reactjs.org) - 灵活的 UI 框架

---

<p align="center">✨ 用像素点亮创意 ✨</p>
