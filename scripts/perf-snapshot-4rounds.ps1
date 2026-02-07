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
  [string]$MainWindowTitleLike = "*Pixel Matrix Player Next*",

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
  [int]$PeakTopN = 8
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$repoRoot = Get-RepoRoot
$perfScript = Join-Path $PSScriptRoot "perf-snapshot.ps1"
$suiteOutDir = Get-SuiteOutDir -RepoRoot $repoRoot -InputSuiteName $SuiteName
$rounds = Build-Rounds -IsQuickMode $Quick.IsPresent

Write-Host "[perf-suite] Repo: $repoRoot"
Write-Host "[perf-suite] SuiteOutDir: $suiteOutDir"
Write-Host "[perf-suite] Rounds: $($rounds.Count)"
Write-Host "[perf-suite] QuickMode: $($Quick.IsPresent)"

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

