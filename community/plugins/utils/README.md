# Utils

`utils` 是一个面向当前 plugin-platform 新范式的 hybrid fixture：

- `webview.main`
  - 承接 magnet / page / overlay / desktop-widget
- `sidecar.main`
  - 承接 system probe / shell-window probe / crash drill / hang drill

它借用了 SAO Utils 的产品气质，但有意保持在当前宿主管理边界内：

- 磁贴、页面、桌面浮层继续由宿主管理
- sidecar 只承担 native-style probe 和跨语言桥接
- 不直接把 QML/native UI 当成 V1 的 magnet carrier

## Included surfaces

- magnet: `utils`
- page: `utils-page`
- overlay: `utils-overlay`
- desktop widget: `utils-widget`

## Included commands

- `utils.probe.system`
- `utils.probe.windows`
- `utils.simulate.hang`
- `utils.simulate.crash`

宿主还会自动注册这两个 shell surface summon command：

- `extv2:utils:shell-surface:utils-overlay:summon`
- `extv2:utils:shell-surface:utils-widget:summon`

## What the sidecar currently validates

- runtime bridge hello / init / activate
- host capability invoke from a native-process runtime
- config persistence back into the ext-v2 plugin namespace
- crash cleanup and hang -> unresponsive teardown drills

## Planned next step

这份 scaffold 的下一跳是把真正的 QML / Qt / Rust adapter 接到 `sidecar.main` 后面，用它做系统探针、native helper 和多进程边界实验，而不是直接旁路宿主 UI 生命周期。
