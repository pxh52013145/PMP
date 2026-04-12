# Magnet Plugin 设计：Utils

更新时间：2026-04-12

## 1. 定位

`utils` 是一个对标 SAO Utils 气质的桌面工具插件样板，但它的实现目标不是复刻旧式“插件自己随意起原生窗口”，而是验证当前 plugin-platform 的新范式：

- 宿主管理的 magnet / page / shell surface
- sidecar 负责跨语言与系统接口边界
- host capability 负责可审计、可治理的宿主能力入口
- cleanup / revoke / forced teardown / telemetry 时间线保持完整

它应当成为后续 QML / Qt / Rust native adapter 试验的承载器，而不是提前绕过宿主边界。

## 2. 当前源码约束

下面这些结论都以当前源码为准。

### 2.1 Magnet 与 view surface

- ext-v2 magnet 目前要求有 `webview` runtime，并通过 `pxp.webview.host-frame` 挂到宿主。
- PMPM magnet 允许 `extension-host` 或 `webview`，但 ext-v2 现阶段仍以 `webview` 为正式路径。
- overlay / desktop-widget 也已经纳入同一条宿主管理视图链路。

### 2.2 Sidecar 现实边界

- `pxp.sidecar.native-process` 当前只支持 `command` surface。
- 这意味着 sidecar 现在适合承接原生命令、OS probe、native helper、子进程治理。
- 它还不适合直接作为 magnet / overlay / desktop-widget 的 UI carrier。

### 2.3 Shell surface 已有稳定宿主链

- `overlay`
- `desktop-widget`

这两类 surface 目前已经覆盖：

- summon
- focus existing window
- dismiss
- destroy
- capability revoke cleanup
- runtime restart cleanup
- tracer / telemetry / audit 时间线

### 2.4 Host magnet capability 已成形

当前已有稳定 family：

- `host.pmp.magnets.catalog`
- `host.pmp.magnets.layout`
- `host.pmp.magnets.renderer`

因此 `utils` 不应再自造磁贴私有接口，而应直接复用现有 capability 边界。

## 3. `utils` 的推荐形态

`utils` 的 V1 采用“三层结构”。

### 3.1 Layer A：宿主管理的 webview magnet / page

这是用户真正看到的控制面：

- magnet 作为 SAO 风格的 compact hub
- page 作为 detail / audit / capability browser

它们继续走现有 ext-v2 `webview` runtime。

### 3.2 Layer B：sidecar probe / native adapter lane

这是跨语言和系统边界的实验面：

- system probe
- shell window boundary probe
- future QML / Qt / Rust adapter bridge
- hang / crash drill

sidecar 只做原生能力和治理压测，不直接拥有宿主 UI 生命周期。

### 3.3 Layer C：宿主管理的 ambient shell surfaces

SAO Utils 风格里的桌面浮层体验，优先由宿主管理：

- `overlay` 做快速面板
- `desktop-widget` 做常驻 HUD

插件只提供内容，不直接接管原生顶层窗的生杀大权。

## 4. SAO Utils 风格功能映射

`utils` 不做 1:1 模仿，而是做能力映射。

| SAO Utils 风格能力 | `utils` V1 对应形态 | 当前建议边界 |
| --- | --- | --- |
| launcher / quick menu | magnet hub + overlay quick panel | `webview` + host shell surface |
| HUD / status widget | desktop-widget surface | host-managed shell surface |
| notes / web tools | page surface，后续可补 window | host-managed view surface |
| media / status probe | magnet/page 中展示 probe 结果 | webview surface |
| system / monitor / process info | sidecar command probe | `sidecar` command runtime |
| native themed experiments | sidecar adapter，后续接 QML/Qt | native adapter lane |
| audit / runtime health | magnet/page/widget 中展示最近结果 | config + tracer / telemetry |

结论很明确：

- launcher、HUD、widget 属于宿主管理 UI
- probe、native helper、跨语言桥接属于 sidecar
- 宿主状态和 magnet catalog 继续走 `host.pmp.*`

## 5. `utils` V1 scaffold 建议

建议直接做一个可安装的 ext-v2 hybrid fixture：

- `webview.main`
  - 承接 magnet / page / overlay / desktop-widget
- `sidecar.main`
  - 承接 command probe / hang / crash drills

首批 surface：

- magnet：`utils`
- page：`utils-page`
- overlay：`utils-overlay`
- desktop-widget：`utils-widget`

首批 commands：

- `utils.probe.system`
- `utils.probe.windows`
- `utils.simulate.hang`
- `utils.simulate.crash`

首批 capability 关注点：

- `core.capability-registry`
- `host.pmp.navigation`
- `host.pmp.storage.config`
- `host.pmp.shell.window`
- `host.pmp.magnets.catalog`
- `host.pmp.magnets.layout`
- `host.pmp.magnets.renderer`

## 6. 为什么 V1 不直接做 QML magnet

当前不建议：

1. sidecar 还没有 magnet / overlay / desktop-widget launcher。
2. QML 顶层窗会绕开现有 shell surface manager。
3. revoke / restart / forced teardown / telemetry / audit 会断层。
4. 这样测到的是“插件绕过宿主”，不是“宿主边界是否稳固”。

所以 V1 正确方向仍然是：

- `webview magnet`
- `sidecar native adapter`
- host-managed `overlay` / `desktop-widget`

## 7. 验收链建议

`utils` 的验收不只看 UI，还要看整条运行时链：

1. install
2. view runtime resolve
3. magnet / overlay / widget mount
4. sidecar command invoke
5. capability invoke
6. config persistence
7. runtime crash cleanup
8. runtime hang -> unresponsive -> forced teardown
9. tracer / telemetry / audit 时间线核对

## 8. builtin magnet 检查结论

当前内置 magnet 不需要“推倒重来式重构”，但需要做“描述层归一化”。

### 8.1 已经符合新范式的部分

- builtin magnet 已统一经过 `createDefaultMagnetLibrary()`
- builtin renderer 已统一进入 shared registry
- builtin variant 已统一进入 shared variant registry
- builtin 与 plugin magnet 已在 renderer / variant / theme skin 层汇合

### 8.2 仍偏旧范式的部分

- builtin metadata 仍分散在 `defaultLibrary.ts`、`constants/magnets.ts`、`layoutStorage.ts`、`systemLayouts.ts`、`display.ts`、`data/builtin/*.ts`
- required / default active / system anchors 仍是分散硬编码集合
- 部分 builtin data 的 `renderer` / `previewText` / `description` 字段一致性不足
- `navigatorMagnet.ts` 和 `config.ts` 里仍可见过渡痕迹

### 8.3 推荐重构顺序

P0：先做 descriptor 层收口，不动 renderer 和布局算法

- 建议新增 `apps/desktop/src/modules/magnets/builtinDescriptors.ts`
- 统一收敛 `id` / `rendererId` / `labelKey` / `required` / `defaultSpaces` / `systemAnchorsBySpace`

P1：统一 builtin data 的最小字段集

- `renderer`
- `previewText`
- `description`

P2：清理遗留 magnet id 和过渡兼容项

P3：再评估是否进一步往 contribution/descriptor graph 并轨

## 9. 结论

`utils` 应该作为当前 plugin-platform 的“正式新范式样板”：

- 可见 UI 走宿主管理 surface
- native / cross-language 走 sidecar
- 宿主能力继续走 `host.pmp.*`

builtin magnet 这边则不需要大拆大改，先做 descriptor-layer normalization，等描述层统一之后再谈更深的并轨重构。
