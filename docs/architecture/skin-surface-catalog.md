# PMP Surface / Part 目录

更新时间: 2026-03-15

本文只记录当前已经在代码中稳定暴露的 surface / part / state 合约。

## 1. 命名空间

- `magnet.*`: binding-first, 当前主要公开 `renderer / variant / props / capabilities.dynamicColor`
- `page.*`: 页面级 surface
- `overlay.*`: 遮罩、菜单、抽屉、确认框
- `primitive.*`: 可复用基础控件

## 2. magnet 绑定目录

当前推荐对外开放的 magnet 绑定写法:

| Binding ID | 说明 | 稳定字段 |
| --- | --- | --- |
| `magnet.track-info` | 曲目信息磁贴 | `renderer`, `variant`, `props`, `capabilities.dynamicColor` |
| `magnet.progress-bar` | 进度条磁贴 | `renderer`, `variant`, `props`, `capabilities.dynamicColor` |
| `magnet.audio-visualizer` | 音频可视化磁贴 | `renderer`, `variant`, `props`, `capabilities.dynamicColor` |
| `magnet.btn-play-pause` | 播放暂停按钮 | `renderer`, `variant`, `props`, `capabilities.dynamicColor` |
| `magnet.btn-previous` | 上一曲按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-next` | 下一曲按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-mode` | 播放模式按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-volume` | 音量按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-back` | 返回按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-play-queue` | 队列按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-playlists` | 歌单按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-music-library` | 音乐库按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-window-pin` | 置顶按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-debug` | 调试按钮 | `renderer`, `variant`, `props` |
| `magnet.btn-desktop-lyrics` | 桌面歌词按钮 | `renderer`, `variant`, `props` |
| `magnet.navigation-page` | navigation page 容器磁贴 | `renderer`, `variant`, `props` |

说明:

- 当前 magnet renderer 内部 DOM 不列为正式 part API
- magnet 的正式可写入口是 `bindings["magnet.*"]`

## 3. page surface 目录

### 3.1 `page.settings`

来源:

- `apps/desktop/src/components/pages/SettingsPage.tsx`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 页面根容器 |
| `shell` | 内层壳体 |
| `header` | 顶部区域 |
| `header-main` | 顶部主内容区 |
| `main-tabs` | 一级 tab 容器 |
| `header-title` | 标题块 |
| `divider` | 分隔线 |
| `subbar` | 二级导航条 |
| `sub-tabs` | 二级 tab 容器 |

### 3.2 `page.settings.main-tab`

消费组件:

- `PmpChoiceButton`

稳定 parts / states:

| 项 | 说明 |
| --- | --- |
| `root` | tab 根按钮 |
| `active` | 选中态 |
| `inactive` | 未选中态 |

### 3.3 `page.settings.sub-tab`

消费组件:

- `PmpChoiceButton`

稳定 parts / states:

| 项 | 说明 |
| --- | --- |
| `root` | tab 根按钮 |
| `active` | 选中态 |
| `inactive` | 未选中态 |

### 3.4 `page.music-library`

来源:

- `apps/desktop/src/components/pages/MusicLibrary.tsx`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 页面根容器 |
| `header` | 页面顶部栏 |
| `header-main` | 顶部主内容区 |
| `source-modes` | 本地 / 稳定库切换区 |
| `toolbar-region` | toolbar 外层区域 |
| `toolbar` | toolbar 主体 |
| `actions` | toolbar 按钮组 |

## 4. overlay surface 目录

### 4.1 `overlay.confirm-dialog`

来源:

- `apps/desktop/src/components/core/ConfirmDialog.tsx`
- `apps/desktop/src/components/magnet/ConfirmDialog.tsx`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `overlay` | 外层遮罩 |
| `container` | 弹窗容器 |
| `header` | 标题栏 |
| `title` | 标题文本 |
| `body` | 主内容区 |
| `message` | 消息文本 |
| `footer` | 底部操作区 |
| `cancelButton` | 取消按钮 |
| `confirmButton` | 确认按钮 |

已知 state:

- `confirmButton` 可能收到 `primary` 或 `danger`

### 4.2 `overlay.context-menu`

来源:

- `apps/desktop/src/components/magnet/ContextMenu.tsx`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `overlay` | 全屏遮罩层 |
| `container` | 菜单容器 |
| `divider` | 分割线 |
| `item` | 菜单项 |
| `icon` | 菜单项图标 |
| `label` | 菜单项文本 |
| `arrow` | 子菜单箭头 |
| `submenu` | 子菜单容器 |

已知 state:

- `item.disabled`
- `item.danger`

### 4.3 `overlay.modal`

消费组件:

- `PmpDialog`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `overlay` | modal 遮罩 |

### 4.4 `overlay.drawer`

消费组件:

- `PmpDrawer`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 抽屉根容器 |

## 5. primitive surface 目录

### 5.1 `primitive.button`

消费组件:

- `PmpButton`

相关 surface:

- `primitive.button`
- `primitive.button.default`
- `primitive.button.primary`
- `primitive.button.danger`
- `primitive.button.ghost`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 按钮根节点 |

### 5.2 `primitive.card`

消费组件:

- `PmpCard`

相关 surface:

- `primitive.card`
- `primitive.card.default`
- `primitive.card.settings`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 卡片根节点 |

### 5.3 `primitive.dialog`

消费组件:

- `PmpDialog`

相关 surface:

- `primitive.dialog`
- `primitive.dialog.default`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 对话框容器 |
| `header` | 头部 |
| `title` | 标题 |
| `body` | 内容区 |
| `footer` | 底部操作区 |

### 5.4 `primitive.choice`

消费组件:

- `PmpChoiceButton`

稳定 parts / states:

| 项 | 说明 |
| --- | --- |
| `root` | 根按钮 |
| `active` | 激活态 |
| `inactive` | 非激活态 |

### 5.5 `primitive.segmented`

消费组件:

- `PmpSegmented`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 容器根节点 |

### 5.6 `primitive.switch`

消费组件:

- `PmpSwitch`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 开关按钮根节点 |
| `track` | 轨道 |
| `thumb` | 滑块 |
| `label` | 文本标签 |

稳定 states:

- `checked`
- `unchecked`

### 5.7 `primitive.checkbox`

消费组件:

- `PmpCheckbox`

稳定 parts:

| Part | 说明 |
| --- | --- |
| `root` | 复选框按钮根节点 |
| `box` | 方框外壳 |
| `indicator` | 选中指示器 |
| `label` | 文本标签 |

稳定 states:

- `checked`
- `unchecked`

## 6. 作者约束

当前建议只把上面列出的内容视为正式公共皮肤 API。

不要依赖:

- 内部 class 名
- DOM 层级
- 具体的子节点顺序
- 未列入目录的 magnet renderer 内部结构

如果需要高级覆盖, 请优先使用:

- `bindings.surface`
- `surfaces.parts`
- `surfaces.states`
- `data-pmp-*`
