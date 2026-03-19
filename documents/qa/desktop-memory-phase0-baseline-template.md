# Desktop Memory Phase 0 Baseline Template

## Purpose

Use this template when refreshing the approved Phase 0 desktop memory baseline from [desktop-rust-memory-refactor-plan.md](/d:/pixel-matrix-player/documents/desktop-rust-memory-refactor-plan.md).

Process capture is produced by:

```powershell
pnpm run perf:memory:phase0
```

Quick smoke validation:

```powershell
pnpm run perf:memory:phase0:quick
```

The suite writes:

- `snapshots/<suite>/phase0-baseline.csv`
- `snapshots/<suite>/phase0-baseline-summary.md`
- `snapshots/<suite>/phase0-debug-capture-template.csv`
- `snapshots/<suite>/phase0-regression-summary.md`

## Run Metadata

| Field | Value |
| --- | --- |
| Date |  |
| Branch |  |
| Commit |  |
| Operator |  |
| Device |  |
| Audio backend |  |
| Cover thumbnail quality |  |
| Suite directory |  |

## Fixed Scenarios

| Scenario ID | Scenario | Manual setup |
| --- | --- | --- |
| `phase0-startup-idle` | 启动 idle | 启动应用后保持空闲，不打开音乐库，不播放歌曲。 |
| `phase0-play-single-track` | 播放单曲 | 播放单首本地歌曲，等待播放状态稳定。 |
| `phase0-recent-playlist-208` | recent playlist 208 首 | 打开 recent playlist，并确保列表规模约 208 首。 |
| `phase0-music-library-card-view` | 打开音乐库卡片视图 | 切到音乐库卡片视图，等待封面与列表稳定。 |
| `phase0-skip-20-tracks` | 连续切歌 20 次 | 连续切歌 20 次后停在最终曲目上等待回落。 |
| `phase0-clear-queue-hide-page` | 清空队列 / 隐藏页面 | 清空播放队列，并退出音乐库/playlist 等重资源页面。 |

## Required Metrics

Every scenario must record both:

- Process metrics from `phase0-baseline.csv`
- In-app debug metrics from `Debug Center` and `Native Debug`

Required debug fields:

- `WebView2 private bytes`
- `tree private bytes`
- `queue approxJsonBytes`
- `playlist overlap diagnostics`
- `cover runtime stats`
- `retirePendingTasks`

## Baseline Table

Copy process numbers from `phase0-baseline.csv`, then fill debug numbers from the in-app panels.

| Scenario | TaskMgr avg MB | TaskMgr max MB | Private avg MB | Private max MB | WebView2 private MB | tree private MB | queue approxJsonBytes | playlist overlap diagnostics | cover runtime stats | retirePendingTasks | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | --- |
| 启动 idle |  |  |  |  |  |  |  |  |  |  |  |
| 播放单曲 |  |  |  |  |  |  |  |  |  |  |  |
| recent playlist 208 首 |  |  |  |  |  |  |  |  |  |  |  |
| 打开音乐库卡片视图 |  |  |  |  |  |  |  |  |  |  |  |
| 连续切歌 20 次 |  |  |  |  |  |  |  |  |  |  |  |
| 清空队列 / 隐藏页面 |  |  |  |  |  |  |  |  |  |  |  |

## Acceptance Notes

- `queue approxJsonBytes` should stay in the expected KB-level range for text-only queues.
- If process memory rises while `queue approxJsonBytes` stays flat, investigate page resources before queue payload.
- If `retirePendingTasks` does not return close to baseline after `清空队列 / 隐藏页面`, treat that as a release regression.
- If `WebView2 private bytes` remains elevated after page exit, inspect images, DOM, canvas, and other page-owned resources first.
