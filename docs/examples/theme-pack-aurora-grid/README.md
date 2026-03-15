# Aurora Grid 示例主题包

这个目录是一个可对外编写的 `.pmpk` 示例主题包, 只使用当前正式公开的皮肤模型:

- `tokens`
- `surfaces`
- `bindings`

不使用:

- `componentThemes`
- `surfaces[*].variantConfig`
- `surfaces[*].dynamicColor`
- `surfaces[*].styleOverride`
- `surfaces[*].classNameOverride`

## 文件说明

- `manifest.json`: `.pmpk` manifest
- `theme.pmpt`: 主题正文

## 这个示例演示了什么

- 用 `bindings.surface` 把 `page.settings` 和 `page.music-library` 切到自定义 surface
- 用 `bindings.surface` 替换 `primitive.button.primary` / `primitive.card.settings` / `primitive.dialog.default`
- 用 `bindings["magnet.track-info"]` 写 magnet variant / props / dynamicColor
- 用 `tokens` 统一色调和阴影语义

## 打包

当前项目里的 `ThemeEditor` 已支持导出 `.pmpk`。

如果手动打包, 需要把这个目录压成 zip, 然后将扩展名改为 `.pmpk`, 并保证:

- `manifest.json` 位于压缩包根目录
- `theme.pmpt` 路径与 `manifest.json -> entry.theme` 一致

## 编写约束

写新主题时, 推荐只依赖:

- `docs/architecture/skin-authoring-guide.md`
- `docs/architecture/skin-surface-catalog.md`

不要依赖内部 class 名或未列入目录的 DOM 结构。
