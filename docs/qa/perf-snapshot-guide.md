# 性能快照脚本使用指南（中文）

本文档说明 `scripts/perf-snapshot.ps1` 与 `scripts/perf-snapshot-4rounds.ps1` 的用途、参数与推荐流程。

## 1. 你应该用哪个脚本

- `scripts/perf-snapshot.ps1`：单轮采样，适合临时验证某个改动。
- `scripts/perf-snapshot-4rounds.ps1`：一键四轮，适合建立基线和做版本对比。

## 2. 单轮脚本（perf-snapshot.ps1）

### 2.1 常用命令

```powershell
powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 \
  -MainWindowTitleLike '*Pixel Matrix Player*' \
  -Scenario baseline \
  -DurationSeconds 60 \
  -IntervalSeconds 0.5
```

包含 WebView2（更接近真实桌面开销）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 \
  -MainWindowTitleLike '*Pixel Matrix Player*' \
  -Scenario stress \
  -IncludeWebView2 \
  -WarmupSeconds 20 \
  -DurationSeconds 90 \
  -PeakTopN 12
```

### 2.2 参数解释（重点）

- `-Scenario`：本轮名称，直接用于文件名和目录名。
- `-IncludeWebView2`：是否纳入 `msedgewebview2` 子进程。
- `-PeakMetric`：峰值判定维度。
  - `taskMgrMB`：任务管理器“内存（专用工作集）”近似值。
  - `wsMB`：Working Set（工作集）。
  - `privateMB`：Private Bytes（私有提交）。
- `-PeakTopN`：峰值时刻显示前 N 个进程。
- `-WarmupSeconds`：采样前等待秒数（给你打开窗口/切页面）。
- `-StrictHostExe`：严格按主窗口宿主过滤，只统计该宿主及其 WebView2，排除像 `SGTool` 这类无关进程噪声（建议用于基线对比）。

### 2.3 报告里的 WebView2 角色

`Top Processes At Peak` 表新增：

- `Role`：`browser / renderer / gpu-process / utility / crashpad-handler`
- `HostExe`：该 WebView2 实例归属的宿主进程（例如 `Pixel Matrix Player.exe`）

## 3. 四轮脚本（perf-snapshot-4rounds.ps1）

### 3.1 一键运行

```powershell
pnpm run perf:snapshot:4rounds
```

推荐（更稳定、可比性更强）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot-4rounds.ps1 -AutoStartNext -StrictHostExe
```

快速版：

```powershell
pnpm run perf:snapshot:4rounds:quick
```

### 3.2 四轮默认场景

1. `baseline-app-only`：只统计主进程（不含 WebView2）
2. `baseline-with-webview2`：统计主进程 + WebView2
3. `peak-auto-stress`：峰值压力场景
4. `recovery-after-stress`：压力后恢复场景

### 3.3 输出目录结构

```text
snapshots/
  suite-YYYY-MM-DD-HHMMSS/
    YYYY-MM-DD-baseline-app-only/
      YYYY-MM-DD-baseline-app-only.md
      YYYY-MM-DD-baseline-app-only.csv
    ...
```

即：**每轮一个目录，固定两个文件（md + csv）**。

## 4. 推荐基线流程（用于优化前后对比）

1. 先跑一次 `perf:snapshot:4rounds`，记录 baseline。
2. 只做一类优化（例如窗口延迟创建 / 列表虚拟化 / 纹理尺寸限制）。
3. 再跑一次四轮，比对每轮：
   - `Task Manager Memory MB (avg/max)`
   - `Private MB (avg/max)`
   - `CPU% p95/max`
4. 记录结论到 `docs/qa/` 或 `logs/`。

## 4.1 运行档位（Runtime Profile）对结果的影响（重要）

当前 `desktop` 的运行档位以“你上次在设置里保存的档位”为准（持久化）。

- `minimal`：更激进省内存/省渲染（封面边长、背景策略、质量档位更低）。
- `balanced`：折中模式。
- `boosted`：更偏体验，允许更高占用。
- `custom`：你手动改过细项后自动进入。

为了让不同版本结果可比，建议在测试前固定档位：

1. 打开设置 → 性能。
2. 明确选择 `minimal` / `balanced` / `boosted`。
3. 再跑四轮快照，避免“上次是 custom，这次是 minimal”造成误判。

### 4.1.1 `dev:next` 档位行为与低内存策略

从当前版本开始：

- `pnpm dev:next` **不强制覆盖档位**，沿用你在设置中持久化的 `runtime profile`。
- 当你显式指定 `minimal`（例如 `pnpm dev:next -- --profile minimal`）时，会自动注入 WebView2 低内存参数：
  - `--disable-gpu`
  - `--disable-gpu-compositing`

可选命令（显式覆盖本次启动档位）：

- `pnpm dev:next:minimal`
- `pnpm dev:next:balanced`
- `pnpm dev:next:boosted`

如需关闭默认 WebView2 低内存参数，可设置环境变量：

```powershell
$env:PMP_NEXT_DISABLE_LOWMEM_WEBVIEW2="1"
pnpm dev:next
```

## 4.2 如何理解 Private MB 偏高

`Private MB` 不是“泄漏”的同义词，它是进程私有提交内存。

- WebView2 的 `gpu-process` 常见会长期占较高 `Private MB`（图形缓存/合成上下文）。
- `renderer` 的 `Private MB` 会随页面复杂度、纹理、JS 堆波动。
- 优化时建议结合三项一起看：
  - `Task Manager Memory MB`
  - `Private MB`
  - `CPU% p95/max`

不要只盯某个瞬时 `Private MB` 峰值。

## 5. 常见问题

- 找不到窗口：先用 `-ListCandidates` 查看候选进程和窗口标题。
- 为什么同名 `msedgewebview2` 很多：WebView2 为多进程架构，属正常现象；看 `Role` + `HostExe` 才能定位来源。
