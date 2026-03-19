# Desktop Memory Phase 0 Regression Template

## Purpose

Use this template to compare a new Phase 0 run against the approved baseline.

Recommended command:

```powershell
pnpm run perf:memory:phase0 -- -BaselineCsv snapshots/<approved-suite>/phase0-baseline.csv
```

The suite will emit `phase0-regression-summary.md`, but this template is the review record that should be checked into PR notes or QA evidence.

## Run Metadata

| Field | Value |
| --- | --- |
| Date |  |
| Branch |  |
| Commit |  |
| Operator |  |
| Current suite |  |
| Baseline suite |  |
| Cover thumbnail quality |  |
| Audio backend |  |

## Regression Delta Table

| Scenario | Current TaskMgr max MB | Baseline TaskMgr max MB | Delta MB | Current Private max MB | Baseline Private max MB | Delta MB | queue approxJsonBytes delta | WebView2 private bytes delta | retirePendingTasks delta | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| 启动 idle |  |  |  |  |  |  |  |  |  |  |
| 播放单曲 |  |  |  |  |  |  |  |  |  |  |
| recent playlist 208 首 |  |  |  |  |  |  |  |  |  |  |
| 打开音乐库卡片视图 |  |  |  |  |  |  |  |  |  |  |
| 连续切歌 20 次 |  |  |  |  |  |  |  |  |  |  |
| 清空队列 / 隐藏页面 |  |  |  |  |  |  |  |  |  |  |

## Review Rules

- If `queue approxJsonBytes` is flat but process deltas grow, classify the issue as WebView/page residency first.
- If `retirePendingTasks` or buffer metrics remain elevated after track switching, classify as audio pipeline release regression.
- If only `WebView2 private bytes` regress in library or playlist views, inspect images, DOM, canvas, and context-menu chains before queue state.
- If `清空队列 / 隐藏页面` does not converge near baseline, the run fails regardless of peak improvements elsewhere.

## Decision

| Item | Result |
| --- | --- |
| Baseline preserved |  |
| Acceptable regression explained |  |
| Follow-up issue opened |  |
| Final decision |  |

## Notes

- Attach the generated `phase0-regression-summary.md`.
- Attach the filled `phase0-debug-capture-template.csv`.
- Reference the exact scenario snapshot markdown files for any disputed regression.
