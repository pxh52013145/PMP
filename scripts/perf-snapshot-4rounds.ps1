Param(
  [Parameter(Mandatory = $false)]
  [string]$SuiteName = "",

  [Parameter(Mandatory = $false)]
  [switch]$AutoStartNext,

  [Parameter(Mandatory = $false)]
  [int]$BootWaitSeconds = 12,

  [Parameter(Mandatory = $false)]
  [switch]$Quick,

  [Parameter(Mandatory = $false)]
  [string]$MainWindowTitleLike = "*Pixel Matrix Player*",

  [Parameter(Mandatory = $false)]
  [string]$AppProcessName = "*pixel*",

  [Parameter(Mandatory = $false)]
  [double]$IntervalSeconds = 0.5,

  [Parameter(Mandatory = $false)]
  [int]$WaitSeconds = 300,

  [Parameter(Mandatory = $false)]
  [ValidateSet('taskMgrMB', 'wsMB', 'privateMB')]
  [string]$PeakMetric = "taskMgrMB",

  [Parameter(Mandatory = $false)]
  [int]$PeakTopN = 8,

  [Parameter(Mandatory = $false)]
  [switch]$StrictHostExe,

  [Parameter(Mandatory = $false)]
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # best effort for terminals that don't allow changing output encoding
}

function Get-RepoRoot() {
  return (Split-Path -Parent $PSScriptRoot)
}

function Get-SuiteOutDir([string]$RepoRoot, [string]$InputSuiteName) {
  $name = $InputSuiteName
  if ([string]::IsNullOrWhiteSpace($name)) {
    $name = "suite-" + (Get-Date).ToString("yyyy-MM-dd-HHmmss")
  }
  $snapshotsRoot = Join-Path $RepoRoot "snapshots"
  if (-not (Test-Path $snapshotsRoot)) {
    New-Item -ItemType Directory -Force -Path $snapshotsRoot | Out-Null
  }
  $suiteDir = Join-Path $snapshotsRoot $name
  if (-not (Test-Path $suiteDir)) {
    New-Item -ItemType Directory -Force -Path $suiteDir | Out-Null
  }
  return $suiteDir
}

function Build-Rounds([bool]$IsQuickMode) {
  if ($IsQuickMode) {
    return @(
      @{ Scenario = "baseline-app-only"; DurationSeconds = 10; WarmupSeconds = 2; IncludeWebView2 = $false; Notes = "quick baseline app only" },
      @{ Scenario = "baseline-with-webview2"; DurationSeconds = 10; WarmupSeconds = 2; IncludeWebView2 = $true; Notes = "quick baseline app + webview2" },
      @{ Scenario = "peak-auto-stress"; DurationSeconds = 15; WarmupSeconds = 4; IncludeWebView2 = $true; Notes = "quick peak stress" },
      @{ Scenario = "recovery-after-stress"; DurationSeconds = 10; WarmupSeconds = 2; IncludeWebView2 = $true; Notes = "quick recovery" }
    )
  }

  return @(
    @{ Scenario = "baseline-app-only"; DurationSeconds = 45; WarmupSeconds = 5; IncludeWebView2 = $false; Notes = "baseline app process only" },
    @{ Scenario = "baseline-with-webview2"; DurationSeconds = 45; WarmupSeconds = 5; IncludeWebView2 = $true; Notes = "baseline app + webview2" },
    @{ Scenario = "peak-auto-stress"; DurationSeconds = 75; WarmupSeconds = 18; IncludeWebView2 = $true; Notes = "peak with stress windows" },
    @{ Scenario = "recovery-after-stress"; DurationSeconds = 45; WarmupSeconds = 5; IncludeWebView2 = $true; Notes = "recovery after peak" }
  )
}

function Show-PerfSuiteHelp() {
  $helpText = @'
性能快照脚本（四轮套件）- scripts/perf-snapshot-4rounds.ps1

用途：一键执行四轮性能采样，并按文件夹归档。

四轮默认场景：
  1) baseline-app-only        仅主进程（不含 WebView2）
  2) baseline-with-webview2   主进程 + WebView2
  3) peak-auto-stress         压力峰值场景
  4) recovery-after-stress    压力后恢复场景

关键参数：
  -AutoStartNext              自动启动 pnpm dev:next
  -Quick                      快速模式（每轮时长更短）
  -SuiteName [name]           套件目录名（默认 suite-日期时间）
  -MainWindowTitleLike [pat]  按窗口标题定位
  -AppProcessName [pat]       按进程名定位（标题匹配失败时可用）
  -PeakMetric / -PeakTopN     峰值度量与 TopN

输出结构：
  snapshots/[SuiteName]/[RoundName]/[RoundName].md
  snapshots/[SuiteName]/[RoundName]/[RoundName].csv

示例：
  pnpm run perf:snapshot:4rounds
  pnpm run perf:snapshot:4rounds:quick
  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot-4rounds.ps1 -AutoStartNext -SuiteName my-baseline-2026-02-08
'@
  Write-Host $helpText
}

if ($Help.IsPresent) {
  Show-PerfSuiteHelp
  exit 0
}

$repoRoot = Get-RepoRoot
$perfScript = Join-Path $PSScriptRoot "perf-snapshot.ps1"
$suiteOutDir = Get-SuiteOutDir -RepoRoot $repoRoot -InputSuiteName $SuiteName
$rounds = Build-Rounds -IsQuickMode $Quick.IsPresent

Write-Host "[perf-suite] Repo: $repoRoot"
Write-Host "[perf-suite] SuiteOutDir: $suiteOutDir"
Write-Host "[perf-suite] Rounds: $($rounds.Count)"
Write-Host "[perf-suite] QuickMode: $($Quick.IsPresent)"
Write-Host "[perf-suite] StrictHostExe: $($StrictHostExe.IsPresent)"

$devProcess = $null
if ($AutoStartNext.IsPresent) {
  Write-Host "[perf-suite] Auto starting app: pnpm dev:next"
  $devProcess = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev:next" -WorkingDirectory $repoRoot -PassThru
  if ($BootWaitSeconds -gt 0) {
    Write-Host "[perf-suite] Waiting $BootWaitSeconds seconds for startup"
    Start-Sleep -Seconds $BootWaitSeconds
  }
}

try {
  for ($index = 0; $index -lt $rounds.Count; $index++) {
    $round = $rounds[$index]
    Write-Host ("[perf-suite] Round {0}/{1}: {2}" -f ($index + 1), $rounds.Count, $round.Scenario)

    $args = @(
      "-ExecutionPolicy", "Bypass",
      "-File", $perfScript,
      "-OutDir", $suiteOutDir,
      "-Scenario", $round.Scenario,
      "-DurationSeconds", [string]$round.DurationSeconds,
      "-IntervalSeconds", [string]$IntervalSeconds,
      "-WarmupSeconds", [string]$round.WarmupSeconds,
      "-WaitSeconds", [string]$WaitSeconds,
      "-PeakMetric", $PeakMetric,
      "-PeakTopN", [string]$PeakTopN,
      "-Notes", $round.Notes
    )

    if (-not [string]::IsNullOrWhiteSpace($MainWindowTitleLike)) {
      $args += @("-MainWindowTitleLike", $MainWindowTitleLike)
    } else {
      $args += @("-AppProcessName", $AppProcessName)
    }

    if ($round.IncludeWebView2) {
      $args += "-IncludeWebView2"
    }

    if ($StrictHostExe.IsPresent) {
      $args += "-StrictHostExe"
    }

    & powershell @args
    if ($LASTEXITCODE -ne 0) {
      throw "Round '$($round.Scenario)' failed with exit code $LASTEXITCODE"
    }
  }

  Write-Host "[perf-suite] Completed successfully"
  Write-Host "[perf-suite] Output root: $suiteOutDir"
} finally {
  if ($devProcess -and -not $devProcess.HasExited) {
    Write-Host "[perf-suite] Stopping auto-started dev process"
    cmd /c taskkill /PID $($devProcess.Id) /T /F | Out-Null
  }
}
