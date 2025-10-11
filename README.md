# 🎵 Pixel Matrix Player

> 一款基于像素点阵设计的高度可定制化音乐播放器

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-orange)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61dafb)](https://reactjs.org)
[![Rust](https://img.shields.io/badge/Rust-1.75+-orange)](https://www.rust-lang.org)

## ✨ 项目愿景

Pixel Matrix Player 是一款革命性的音乐播放器，将**像素艺术**、**音频技术**和**社区创造力**完美结合。每个像素点都是可交互的，每个组件都可自定义，每个主题都是独特的艺术品。

### 核心特色

- 🎨 **像素点阵UI** - 每个像素点可单独控制，支持动态动画
- 🎵 **强大音频引擎** - Rust驱动，支持无损音质和实时EQ
- 🎭 **命运2风格主题** - 着色器系统，色彩+纹理+动画的完美组合
- 🧩 **组件化设计** - 所有UI元素都是可拖放的组件
- 🌐 **多平台音乐源** - 网易云、酷狗，一站式管理
- 🎼 **AI音频分析** - 乐器识别、和弦分析、节奏检测
- 🏪 **社区市场** - 分享和下载组件、主题、插件
- 💎 **Pixel Dot货币** - 通过社区贡献获取，扩展你的画布

## 📸 预览

> 开发中...敬请期待

## 🏗️ 技术栈

### 前端

- **React 18** - UI框架
- **TypeScript** - 类型安全
- **PixiJS** - 2D渲染引擎（WebGL加速）
- **Zustand** - 状态管理
- **Tailwind CSS** - 样式框架
- **Framer Motion** - 动画库

### 后端

- **Rust** - 核心引擎
- **Tauri** - 跨平台框架
- **rodio/cpal** - 音频播放
- **symphonia** - 音频解码
- **SQLite** - 本地数据库

### 音乐API

- **网易云音乐** - 官方开发者API
- **酷狗音乐** - [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)

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

完整的技术文档请查看 **[docs/](./docs/)** 目录：

### 📂 分类导航

- 📍 **[Magnet 系统](./docs/magnet/)** - Magnet 组件实现和使用
- ✏️ **[编辑器功能](./docs/editor/)** - 编辑器开发和使用指南
- 🐛 **[Bug 修复](./docs/bugfixes/)** - 已知问题和修复记录
- ⚙️ **[系统设计](./docs/system/)** - 配置系统和架构设计
- 📦 **[归档文档](./docs/archive/)** - 历史文档和参考资料

### 🎯 快速链接

**用户指南**：

- 🚀 [快速开始](./GETTING_STARTED.md) - 运行和开发指南
- 🎨 [编辑器使用指南](./docs/editor/QUICK_START_GUIDE.md) - 自定义你的界面

**开发文档**：

- 🏗️ [UI 设计基础](./docs/system/UI_PIXEL_MATRIX_DESIGN.md) - Pixel 点阵设计
- 🧲 [Magnet 实现指南](./docs/magnet/MAGNET_IMPLEMENTATION_GUIDE.md) - Magnet 系统详解
- ✏️ [编辑器架构](./docs/editor/EDITOR_SYSTEM_REDESIGN.md) - 编辑器系统设计
- 🔧 [配置系统](./docs/system/CONFIG_SYSTEM_AND_GRID_EXTENSION.md) - 配置持久化和网格扩展

查看 [docs/README.md](./docs/README.md) 获取完整文档索引。

## 🗺️ 开发路线图

### Phase 1: MVP (3-4个月) 🔄 进行中

- [ ] 基础项目架构（Tauri + React + Rust）
- [ ] 本地音乐播放功能
- [ ] 简单的播放器UI
- [ ] 基础点阵渲染引擎
- [ ] 简单组件系统

### Phase 2: 核心功能 (3-4个月) 📅 计划中

- [ ] 完整点阵UI系统
- [ ] 组件拖放与布局
- [ ] 基础主题系统
- [ ] 播放器内EQ
- [ ] 频谱可视化

### Phase 3: 网络功能 (2-3个月)

- [ ] 网易云音乐API
- [ ] 酷狗音乐API
- [ ] 在线搜索与播放
- [ ] 收藏夹同步

### Phase 4: 高级功能 (3-4个月)

- [ ] 命运2风格着色器
- [ ] 动画系统
- [ ] AI音频分析
- [ ] 组件设计平台

### Phase 5: 社区生态 (持续)

- [ ] Pixel Dot经济系统
- [ ] 在线市场
- [ ] 插件系统
- [ ] 社区论坛

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

## 📜 开源协议

本项目采用 [MIT 协议](LICENSE) 开源。

## ⚠️ 免责声明

**重要**: 本项目集成的第三方音乐平台API仅供个人学习和研究使用。

- 音乐版权归原平台及版权方所有
- 请尊重版权，支持正版音乐
- 禁止用于任何商业目的
- 使用本软件产生的法律责任由用户自行承担

我们建议：

- 主要使用本地音乐播放功能
- 在线功能仅用于音乐发现
- 通过官方渠道购买/订阅音乐服务

## 💬 社区

- **讨论**: [GitHub Discussions](https://github.com/yourusername/pixel-matrix-player/discussions)
- **问题反馈**: [GitHub Issues](https://github.com/yourusername/pixel-matrix-player/issues)
- **Discord**: 即将推出

## 🙏 致谢

- [Tauri](https://tauri.app) - 强大的跨平台框架
- [PixiJS](https://pixijs.com) - 优秀的2D渲染引擎
- [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) - 酷狗音乐API
- [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) - 网易云音乐API灵感来源

## 📊 项目状态

> 🚧 **开发阶段**: 项目正在积极开发中，暂未发布可用版本

**当前进度**: 技术方案设计完成，即将开始编码实现

---

<p align="center">用像素点亮音乐 | Made with ❤️ by the community</p>
