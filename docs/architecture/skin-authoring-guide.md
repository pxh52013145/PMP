# PMP 皮肤作者指南

更新时间: 2026-03-16

## 1. 当前正式模型

PMP 现在对外推荐的主题模型只有三层:

- `tokens`: 全局语义变量
- `surfaces`: page / overlay / primitive 的视觉文档
- `bindings`: magnet / page / overlay / primitive 的绑定层

运行时正式类型定义在:

- `apps/desktop/src/themes/types/theme.ts`

导入兼容 schema 单独定义在:

- `apps/desktop/src/themes/types/themeImport.ts`

这意味着:

- runtime `Theme` 不再包含 `componentThemes`
- runtime `ComponentTheme` 不再包含 `variantConfig`
- runtime `ComponentTheme` 不再包含 `dynamicColor`
- runtime `ComponentTheme` 不再包含 `styleOverride`
- runtime `ComponentTheme` 不再包含 `classNameOverride`
- legacy 字段只允许出现在导入阶段, 然后由 `normalizeTheme()` 迁移

## 2. 三层职责

### 2.1 `tokens`

用于定义全局语义变量, 例如:

- `tokens.color.bg.surface`
- `tokens.color.fg.default`
- `tokens.motion.duration.fast`
- `tokens.radius.control.md`
- `tokens.space.panel.lg`
- `tokens.shadow.surface.glow`

推荐把颜色、节奏、圆角、间距、尺寸放在这里, 不要把业务名称直接写进 token。

### 2.2 `surfaces`

用于描述一个稳定 UI 表面的视觉结构, 例如:

- `page.settings`
- `page.music-library`
- `overlay.modal`
- `overlay.context-menu`
- `primitive.button.primary`
- `primitive.card.settings`

`surfaces` 只负责“长什么样”, 不负责“谁来用它”。

### 2.3 `bindings`

用于描述消费端与视觉文档的绑定关系, 例如:

- `bindings["page.settings"].surface = "page.settings.aurora"`
- `bindings["primitive.button.primary"].surface = "primitive.button.aurora-primary"`
- `bindings["magnet.track-info"].variant = "minimal"`
- `bindings["magnet.track-info"].props.layout = "compact"`

`bindings` 负责:

- surface 重定向
- magnet renderer 选择
- variant / props
- 能力开关, 当前稳定的是 `capabilities.dynamicColor`

## 3. magnet 和 page/primitive 的区别

### 3.1 magnet

magnet 现在是 binding-first:

- 公开契约是 `bindings["magnet.<id>"]`
- 当前稳定字段是 `renderer / variant / props / capabilities.dynamicColor`
- 不承诺 renderer 内部 DOM 结构稳定
- 当前不把 magnet renderer 的内部 part 列为正式公共 API

也就是说, magnet 皮肤主要通过下面这种方式写:

```json
{
  "bindings": {
    "magnet.track-info": {
      "variant": "minimal",
      "props": {
        "layout": "compact"
      },
      "capabilities": {
        "dynamicColor": {
          "enabled": true,
          "source": "cover",
          "mode": "gradient",
          "apply": "blend",
          "blendRatio": 0.28
        }
      }
    }
  }
}
```

### 3.1.1 已定稿的 simple magnet props

当前这批 simple magnet 已经完成正式 props 抽象, 可以直接写入主题包:

| Binding ID | 推荐 props |
| --- | --- |
| `magnet.progress-bar` | `showTimeLabels`, `trackDensity`, `bufferLayers`, `thumbVisibility` |
| `magnet.btn-play-pause` | `showStateLabel`, `showQueueCount`, `pulseMode` |
| `magnet.btn-previous` / `magnet.btn-next` | `showQueueCount`, `showLabel` |
| `magnet.btn-mode` | `showModeBadge`, `ringVisibility`, `pulseOnSwitch` |
| `magnet.btn-volume` | `popupPlacement`, `showValue`, `showMuteToggle` |
| `magnet.btn-play-queue` | `showCountBadge`, `showEditAction`, `showAddAction`, `showClearAction`, `autoScrollToActive` |
| `magnet.btn-playlists` | `showCountBadge`, `showLabel`, `showActiveIndicator` |
| `magnet.btn-music-library` | `showLabel`, `showActiveIndicator` |
| `magnet.btn-back` | `iconStyle`, `showHistoryCount` |
| `magnet.btn-window-pin` | `showPinnedAnchor`, `showPinnedShadow`, `idlePose` |
| `magnet.btn-debug` | `activeIndicator`, `spinMode` |
| `magnet.btn-desktop-lyrics` | `labelMode`, `showActiveIndicator`, `showClickThroughBadge` |
| `magnet.navigation-page` | `sourceSwitcherMode`, `showLibraryStats`, `placeholderMode` |

对应的 built-in variant 可直接通过 `bindings["magnet.<id>"].variant` 复用:

- `progress-bar`: `default` / `minimal` / `monitor`
- `btn-play-pause`: `default` / `labeled` / `queue-chip` / `ambient`
- `btn-previous`, `btn-next`: `default` / `queue-hint` / `labeled`
- `btn-mode`: `default` / `badge-chip` / `ambient`
- `btn-volume`: `default` / `compact` / `dock-start`
- `btn-play-queue`: `default` / `monitor` / `minimal`
- `btn-playlists`: `default` / `badge` / `chip`
- `btn-music-library`: `default` / `indicator` / `chip`
- `btn-back`: `default` / `outline` / `history-chip`
- `btn-window-pin`: `default` / `minimal` / `signal`
- `btn-debug`: `default` / `status-dot` / `quiet`
- `btn-desktop-lyrics`: `default` / `status-dot` / `full-label` / `compact-icon`
- `navigation-page`: `default` / `inline-sources` / `compact-meta`

### 3.2 page / overlay / primitive

这些是 surface-first:

- 公开契约是 `surface id + part id + state`
- 可以通过 `bindings[*].surface` 把一个消费入口切到另一份 surface 文档
- 允许用 `parts` / `states` 做结构化换肤

## 4. 稳定选择器

当前稳定的选择器契约是 `data-pmp-*`:

- `data-pmp-surface`
- `data-pmp-part`
- `data-pmp-primitive`
- `data-pmp-binding`
- `data-pmp-variant`
- `data-pmp-state`

这层选择器是 escape hatch, 用于高级 CSS 覆盖, 不是主配置模型。

推荐:

```css
[data-pmp-surface="page.settings"][data-pmp-part="root"] {
  outline: 1px solid rgba(103, 232, 249, 0.18);
}
```

不推荐:

```css
.settings-page > div:nth-child(2) > .settings-main-tab { ... }
```

## 5. 大小和尺寸应该放哪

建议按下面的边界处理:

- 全局尺度系统: 放在 `tokens`
- 控件语义尺寸: 放在 `primitive` surface 或其 `parts`
- 页面局部布局尺寸: 放在 page / overlay surface 的 `parts`
- 最终自适应布局: 仍然由 DOM / CSS 负责

简单说:

- 设计尺度归 `tokens`
- 组件语义归 `primitive`
- 页面局部布局归 `part`
- 最终像素实现归 DOM

## 6. 一个最小可写主题

```json
{
  "id": "theme-sample",
  "name": "Sample Theme",
  "version": "1.0.0",
  "tokens": {
    "color": {
      "bg.surface": "#101828",
      "fg.default": "#f8fafc",
      "accent.primary": "#67e8f9"
    }
  },
  "pixel": {
    "shape": "circle",
    "size": 1,
    "opacity": 1,
    "colors": {
      "default": { "slot": "primary", "alpha": 0.6 },
      "hover": { "slot": "accent", "state": "hover" },
      "active": { "slot": "primary", "state": "active" },
      "occupied": { "slot": "secondary", "alpha": 0.3 }
    }
  },
  "background": {
    "maximized": { "type": "color", "color": "#050816", "opacity": 1 },
    "windowed": { "type": "color", "color": "#050816", "opacity": 1 }
  },
  "fonts": {
    "primary": "IBM Plex Sans, sans-serif"
  },
  "surfaces": {
    "primitive.button.aurora": {
      "parts": {
        "root": {
          "style": {
            "background": "linear-gradient(135deg, #22d3ee, #60a5fa)",
            "color": "#08111f",
            "borderRadius": 12
          }
        }
      }
    }
  },
  "bindings": {
    "primitive.button.primary": {
      "surface": "primitive.button.aurora"
    }
  }
}
```

## 7. legacy 导入边界

下面这些字段现在仍然能导入, 但只作为迁移入口:

- `theme.colors`
- `theme.motion`
- `theme.typography`
- `theme.componentThemes`
- `surfaces[*].variantConfig`
- `surfaces[*].dynamicColor`
- `surfaces[*].styleOverride`
- `surfaces[*].classNameOverride`

它们会在 `normalizeTheme()` 中迁移到:

- `tokens`
- `surfaces.parts`
- `bindings.props`
- `bindings.capabilities.dynamicColor`

对外写新皮肤时, 不要再写这些 legacy 字段。

## 8. 当前建议

如果你的目标是“像 VSCode 一样可换整套色调, 同时允许局部控件完全换风格”, 当前最稳妥的写法是:

1. 用 `tokens` 管全局色调和尺度
2. 用 `surfaces` 管 page / overlay / primitive 的视觉文档
3. 用 `bindings` 管 magnet renderer / variant / props / dynamicColor
4. 只把 `data-pmp-*` 当成高级兜底

这条路径目前兼顾了:

- 低耦合
- 可迁移
- 性能稳定
- 可渐进扩展
