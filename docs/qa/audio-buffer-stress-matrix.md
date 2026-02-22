# 音频缓冲区压测场景与参数矩阵

本文档给出“缓冲区欠载/恢复”优化后的压测流程与推荐环境参数（env）矩阵，适用于 Windows 桌面端（Tauri + native audio）。

## 1. 快速执行

列出内置压测 preset：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-buffer-stress.ps1 -ListPresets
```

运行全部 preset（默认）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-buffer-stress.ps1
```

运行指定 preset（逗号分隔）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audio-buffer-stress.ps1 \
  -Presets shared-96-robust,exclusive-96-balanced \
  -TrackPath .\Eagles_Hotel_California.flac
```

运行后会在 `logs/audio-buffer-stress-<timestamp>/` 生成：

- `summary.md`
- `summary.csv`
- `<scenario>.log`

## 2. 场景设计（建议）

每个场景建议至少覆盖：

- **启动预缓冲**：首次播放 2.8s（`PlayMs=2800`）
- **seek 震荡**：`SeekCount=4`，`SeekIntervalMs=180`
- **CPU 干扰**：`StressCpuThreads=CPU核数/3`
- **后端切换**：shared / shared-raw / exclusive 分开看

## 3. 推荐参数矩阵（按后端 + 采样率）

> 说明：以下值优先用于压测与回归；正式默认值仍由代码内策略控制。若环境变量未设置，则走 `buffer_policy` 默认策略。

| Preset | Backend | 目标采样率 | 交互档位 | RenderQueueSeconds | SourcePopWait(ms N/G/C) | WASAPI Prefill(ms) | PrefillTimeout(ms) | SharedRenderAhead(s/preroll) |
| --- | --- | --- | --- | ---: | --- | ---: | ---: | --- |
| `shared-48-balanced` | `wasapi` | 44.1/48k | `balanced` | 1.2 | 1 / 2 / 3 | 180 (shared-raw fallback) | 220 | 0.8 / 0.14 |
| `shared-96-robust` | `wasapi` | 88.2/96k | `stable` | 1.8 | 2 / 3 / 4 | 240 (shared-raw fallback) | 280 | 1.1 / 0.20 |
| `shared-raw-96-robust` | `wasapi-shared-raw` | 88.2/96k | `stable` | 2.0 | 2 / 3 / 4 | 260 (shared-raw) | 320 | 使用默认 |
| `exclusive-48-fast` | `wasapi-exclusive` | 44.1/48k | `fast` | 0.9 | 1 / 1 / 2 | 90 (exclusive) | 120 | N/A |
| `exclusive-96-balanced` | `wasapi-exclusive` | 88.2/96k | `balanced` | 1.3 | 1 / 2 / 3 | 140 (exclusive) | 170 | N/A |
| `exclusive-192-robust` | `wasapi-exclusive` | 176.4/192k | `stable` | 2.4 | 2 / 3 / 4 | 220 (exclusive) | 280 | N/A |

## 4. 判定标准（回归门禁建议）

建议将以下项作为“通过”条件：

- **功能稳定性**：场景命令退出码为 `0`
- **无持续卡顿**：无连续 seek 失败或长时间停留 buffering
- **无明显欠载风暴**：同场景下 `shared.render_ahead.underrun` / `shared.output.render_underrun` 事件数量不持续上升
- **恢复可用**：在 stress 场景后，播放恢复延迟可接受且不会立即再次欠载

## 5. 调参优先级（从高到低）

1. `PMP_AUDIO_RENDER_QUEUE_SECONDS`
2. `PMP_AUDIO_WASAPI_*_PREFILL_MS` 与 `PMP_AUDIO_WASAPI_*_PREFILL_TIMEOUT_MS`
3. `PMP_AUDIO_SOURCE_POP_WAIT_*_MS`
4. `PMP_AUDIO_SHARED_RENDER_AHEAD_SECONDS` 与 `PMP_AUDIO_SHARED_RENDER_AHEAD_PREROLL_SECONDS`

## 6. 与代码策略的对应关系

核心策略实现位置：

- `apps/desktop/src-tauri/src/audio/buffer_policy.rs`
- `apps/desktop/src-tauri/src/audio/input/streaming.rs`
- `apps/desktop/src-tauri/src/audio/input/symphonia.rs`
- `apps/desktop/src-tauri/src/audio/input/sacd.rs`
- `apps/desktop/src-tauri/src/audio/output/render_ahead.rs`
- `apps/desktop/src-tauri/src/audio/output/wasapi_exclusive.rs`
- `apps/desktop/src-tauri/src/audio/engine.rs`

这保证了“输入解码 → transfer → render-ahead → 输出”全链路使用统一策略，而不是各处硬编码阈值。
