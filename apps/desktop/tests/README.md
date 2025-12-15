# Smoke Test Plan (Phase 0)

> 目的：在重构过程中快速验证关键路径。以下用例会使用 Vitest + jsdom，实现后可纳入 CI。

## 1. Config Load / Save

- **文件**：`tests/configManager.test.ts`
- **范围**：
  1. `loadConfig` 默认返回内置 Magnets，且能处理损坏的 `localStorage` 数据。
  2. `saveConfig` 会写入 `pixel-matrix-player-config`，并保留版本/时间戳字段（如需）。
  3. `applyConfig` 能在缺失 Magnet 模板时回退到默认。
- **准备**：Mock `localStorage`、提供示例 Magnet 文件。

## 2. WebAudio Playback Lifecycle

- **文件**：`tests/webAudioService.test.ts`
- **范围**：
  1. `loadTrack -> play` 过程中状态机转换 `idle -> loading -> playing`。
  2. `pause`、`stop` 更新状态并暂停 `HTMLAudioElement`.
  3. `ended` 事件触发 `handleTrackEnded`，根据播放模式切换下一曲。
  4. `addToQueue` / `playTrackAtIndex` 在 shuffle / loop 模式下行为正确。
- **准备**：使用 `global.Audio` mock（例如 `happy-dom` 或自定义 stub），Fake timers 驱动 `timeupdate`。

## 3. Magnet Layout Solver

- **文件**：`tests/magnetLayout.test.ts`
- **范围**：
  1. `detectConflicts` 返回冲突对、冲突像素数量。
  2. `resolveMagnetPositions` 在给定冲突场景下输出非重叠坐标，并保持顺序。
  3. `calculatePixelOccupancy` 正确标记 `occupiedBy`。
- **准备**：构造小型 5×5 网格 + 简化 Magnet 数据。

## 4. 自动化入口

- 在 `package.json`（desktop）新增 `test` 脚本执行 `vitest run`（后续 Phase 1 再落地）。
- CI 可先仅跑 `pnpm --filter @pixel-matrix/desktop test --runInBand`。

> 当前文件仅描述范围，稍后真正添加 `*.test.ts` 并配置 Vitest。
