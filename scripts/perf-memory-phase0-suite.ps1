Param(
  [Parameter(Mandatory = $false)]
  [string]$SuiteName = "",

  [Parameter(Mandatory = $false)]
  [switch]$AutoStartDev,

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
  [string]$BaselineCsv = "",

  [Parameter(Mandatory = $false)]
  [switch]$NonInteractive,

  [Parameter(Mandatory = $false)]
  [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # best effort for terminals that do not allow changing output encoding
}

function Get-RepoRoot() {
  return (Split-Path -Parent $PSScriptRoot)
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Get-SuiteOutDir([string]$RepoRoot, [string]$InputSuiteName) {
  $name = $InputSuiteName
  if ([string]::IsNullOrWhiteSpace($name)) {
    $name = "phase0-memory-" + (Get-Date).ToString("yyyy-MM-dd-HHmmss")
  }

  $snapshotsRoot = Join-Path $RepoRoot "snapshots"
  Ensure-Directory $snapshotsRoot

  $suiteDir = Join-Path $snapshotsRoot $name
  Ensure-Directory $suiteDir
  return $suiteDir
}

function Format-Number([object]$Value) {
  if ($null -eq $Value -or $Value -isnot [ValueType]) {
    return "-"
  }

  $numericValue = [double]$Value
  if ([double]::IsNaN($numericValue) -or [double]::IsInfinity($numericValue)) {
    return "-"
  }

  return $numericValue.ToString("0.00")
}

function Read-SummaryMetric([string]$MarkdownPath, [string]$MetricName) {
  $line = Get-Content -Path $MarkdownPath | Where-Object { $_ -like "*${MetricName}*" } | Select-Object -First 1
  if (-not $line) {
    return $null
  }

  if ($line -match '`([0-9]+(?:\.[0-9]+)?)`\s*/\s*`([0-9]+(?:\.[0-9]+)?)`') {
    return [PSCustomObject]@{
      avg = [double]$Matches[1]
      max = [double]$Matches[2]
    }
  }

  return $null
}

function Build-Scenarios([bool]$IsQuickMode) {
  $durationShort = if ($IsQuickMode) { 12 } else { 35 }
  $durationMedium = if ($IsQuickMode) { 14 } else { 45 }
  $durationLong = if ($IsQuickMode) { 18 } else { 60 }
  $warmupShort = if ($IsQuickMode) { 2 } else { 5 }
  $warmupMedium = if ($IsQuickMode) { 3 } else { 8 }
  $warmupLong = if ($IsQuickMode) { 4 } else { 12 }

  return @(
    [PSCustomObject]@{
      Id = "phase0-startup-idle"
      Label = "startup idle"
      DurationSeconds = $durationShort
      WarmupSeconds = $warmupShort
      Preparation = "Launch the app, keep it idle, do not open the library, and do not start playback."
      Notes = "phase0 startup idle baseline"
    },
    [PSCustomObject]@{
      Id = "phase0-play-single-track"
      Label = "play single track"
      DurationSeconds = $durationMedium
      WarmupSeconds = $warmupMedium
      Preparation = "Play one local track, wait for playback to stabilize, and do not skip tracks."
      Notes = "phase0 single track playback"
    },
    [PSCustomObject]@{
      Id = "phase0-recent-playlist-208"
      Label = "recent playlist 208 tracks"
      DurationSeconds = $durationMedium
      WarmupSeconds = $warmupMedium
      Preparation = "Open the recent playlist, make sure the list is about 208 tracks, and wait for queue and page residency to settle."
      Notes = "phase0 recent playlist 208 tracks"
    },
    [PSCustomObject]@{
      Id = "phase0-music-library-card-view"
      Label = "music library card view"
      DurationSeconds = $durationMedium
      WarmupSeconds = $warmupMedium
      Preparation = "Switch to the music library card view and keep the page open until covers and layout settle."
      Notes = "phase0 music library card view"
    },
    [PSCustomObject]@{
      Id = "phase0-skip-20-tracks"
      Label = "skip tracks 20 times"
      DurationSeconds = $durationLong
      WarmupSeconds = $warmupLong
      Preparation = "With a playable queue loaded, skip tracks 20 times and then wait for the final track to settle."
      Notes = "phase0 switch tracks 20 times"
    },
    [PSCustomObject]@{
      Id = "phase0-clear-queue-hide-page"
      Label = "clear queue / hide page"
      DurationSeconds = $durationMedium
      WarmupSeconds = $warmupMedium
      Preparation = "Clear the playback queue, leave music-library and playlist-heavy pages, and wait for release to stabilize."
      Notes = "phase0 clear queue and hide resource-heavy pages"
    }
  )
}

function Show-HelpText() {
  $helpText = @'
Phase 0 desktop memory suite - scripts/perf-memory-phase0-suite.ps1

Purpose:
  Capture the six fixed Phase 0 scenarios from desktop-rust-memory-refactor-plan.md,
  emit per-scenario snapshots, a consolidated baseline table, and a regression summary.

Scenarios:
  1) startup idle
  2) play single track
  3) recent playlist 208 tracks
  4) music library card view
  5) switch tracks 20 times
  6) clear queue / hide page

Key parameters:
  -AutoStartDev      Start `pnpm dev` automatically before the suite
  -Quick             Use shorter durations for smoke validation
  -BaselineCsv       Compare current results against a previous baseline CSV
  -NonInteractive    Skip the "press Enter when ready" prompt before each scenario

Outputs:
  snapshots/<suite>/<scenario>/<scenario>.md
  snapshots/<suite>/<scenario>/<scenario>.csv
  snapshots/<suite>/phase0-baseline.csv
  snapshots/<suite>/phase0-baseline-summary.md
  snapshots/<suite>/phase0-debug-capture-template.csv
  snapshots/<suite>/phase0-regression-summary.md
'@
  Write-Host $helpText
}

function Wait-ForScenarioReady([object]$Scenario, [int]$Index, [int]$Total) {
  Write-Host ""
  Write-Host ("[phase0] Scenario {0}/{1}: {2}" -f $Index, $Total, $Scenario.Label)
  Write-Host ("[phase0] Prepare: {0}" -f $Scenario.Preparation)
  Write-Host "[phase0] Debug metrics to record in app:"
  Write-Host "[phase0]   - WebView2 private bytes"
  Write-Host "[phase0]   - tree private bytes"
  Write-Host "[phase0]   - queue approxJsonBytes"
  Write-Host "[phase0]   - playlist overlap diagnostics"
  Write-Host "[phase0]   - cover runtime stats"
  Write-Host "[phase0]   - retirePendingTasks"

  if (-not $NonInteractive.IsPresent) {
    [void](Read-Host "[phase0] Press Enter when the app is ready for capture")
  }
}

function Invoke-ScenarioCapture(
  [string]$PerfScriptPath,
  [string]$SuiteOutDir,
  [object]$Scenario
) {
  $args = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $PerfScriptPath,
    "-OutDir", $SuiteOutDir,
    "-OutSubDir", $Scenario.Id,
    "-OutName", $Scenario.Id,
    "-Scenario", $Scenario.Id,
    "-IncludeWebView2",
    "-DurationSeconds", [string]$Scenario.DurationSeconds,
    "-IntervalSeconds", [string]$IntervalSeconds,
    "-WarmupSeconds", [string]$Scenario.WarmupSeconds,
    "-WaitSeconds", [string]$WaitSeconds,
    "-PeakMetric", $PeakMetric,
    "-PeakTopN", [string]$PeakTopN,
    "-Notes", $Scenario.Notes
  )

  if (-not [string]::IsNullOrWhiteSpace($MainWindowTitleLike)) {
    $args += @("-MainWindowTitleLike", $MainWindowTitleLike)
  } else {
    $args += @("-AppProcessName", $AppProcessName)
  }

  if ($StrictHostExe.IsPresent) {
    $args += "-StrictHostExe"
  }

  & powershell @args
  if ($LASTEXITCODE -ne 0) {
    throw "Scenario '$($Scenario.Id)' failed with exit code $LASTEXITCODE"
  }
}

function Build-BaselineRows([string]$SuiteOutDir, $Scenarios) {
  $rows = @()
  foreach ($scenario in $Scenarios) {
    $scenarioDir = Join-Path $SuiteOutDir $scenario.Id
    $markdownPath = Join-Path $scenarioDir ("{0}.md" -f $scenario.Id)
    $csvPath = Join-Path $scenarioDir ("{0}.csv" -f $scenario.Id)
    if (-not (Test-Path $markdownPath)) {
      throw "Missing scenario markdown: $markdownPath"
    }
    if (-not (Test-Path $csvPath)) {
      throw "Missing scenario CSV: $csvPath"
    }

    $taskMgr = Read-SummaryMetric -MarkdownPath $markdownPath -MetricName 'Task Manager Memory MB (avg/max)'
    $ws = Read-SummaryMetric -MarkdownPath $markdownPath -MetricName 'Working Set MB (avg/max)'
    $private = Read-SummaryMetric -MarkdownPath $markdownPath -MetricName 'Private MB (avg/max)'

    $rows += [PSCustomObject]@{
      scenarioId = $scenario.Id
      scenarioLabel = $scenario.Label
      taskMgrAvgMB = if ($taskMgr) { [math]::Round($taskMgr.avg, 2) } else { $null }
      taskMgrMaxMB = if ($taskMgr) { [math]::Round($taskMgr.max, 2) } else { $null }
      wsAvgMB = if ($ws) { [math]::Round($ws.avg, 2) } else { $null }
      wsMaxMB = if ($ws) { [math]::Round($ws.max, 2) } else { $null }
      privateAvgMB = if ($private) { [math]::Round($private.avg, 2) } else { $null }
      privateMaxMB = if ($private) { [math]::Round($private.max, 2) } else { $null }
      snapshotMarkdown = $markdownPath
      snapshotCsv = $csvPath
    }
  }

  return $rows
}

function Write-DebugCaptureTemplate([string]$Path, $Rows) {
  $templateRows = foreach ($row in $Rows) {
    [PSCustomObject]@{
      scenarioId = $row.scenarioId
      scenarioLabel = $row.scenarioLabel
      webview2PrivateBytesMB = ""
      treePrivateBytesMB = ""
      queueApproxJsonBytes = ""
      playlistOverlapDiagnostics = ""
      coverRuntimeStats = ""
      retirePendingTasks = ""
      notes = ""
    }
  }

  $templateRows | Export-Csv -Path $Path -NoTypeInformation -Encoding utf8
}

function Write-BaselineSummary([string]$Path, [string]$SuiteOutDir, $Rows) {
  $lines = New-Object System.Collections.Generic.List[string]
  $generatedAt = (Get-Date).ToString("s")

  $lines.Add("# Desktop Memory Phase 0 Baseline Summary")
  $lines.Add("")
  $lines.Add("> Generated: $generatedAt")
  $lines.Add("")
  $lines.Add("## Suite")
  $lines.Add("- Suite directory: ``$SuiteOutDir``")
  $lines.Add("- Required debug capture template: ``phase0-debug-capture-template.csv``")
  $lines.Add("- Scenarios captured: ``$($Rows.Count)``")
  $lines.Add("")
  $lines.Add("## Process Metrics")
  $lines.Add("| Scenario | TaskMgr MB avg/max | Working Set MB avg/max | Private MB avg/max | Snapshot |")
  $lines.Add("| --- | ---: | ---: | ---: | --- |")

  foreach ($row in $Rows) {
    $taskMgr = "{0} / {1}" -f (Format-Number $row.taskMgrAvgMB), (Format-Number $row.taskMgrMaxMB)
    $ws = "{0} / {1}" -f (Format-Number $row.wsAvgMB), (Format-Number $row.wsMaxMB)
    $private = "{0} / {1}" -f (Format-Number $row.privateAvgMB), (Format-Number $row.privateMaxMB)
    $snapshotName = Split-Path -Leaf ([string]$row.snapshotMarkdown)
    $lines.Add("| $($row.scenarioLabel) | $taskMgr | $ws | $private | ``$snapshotName`` |")
  }

  $lines.Add("")
  $lines.Add("## Required Debug Metrics")
  $lines.Add("- WebView2 private bytes")
  $lines.Add("- tree private bytes")
  $lines.Add("- queue approxJsonBytes")
  $lines.Add("- playlist overlap diagnostics")
  $lines.Add("- cover runtime stats")
  $lines.Add("- retirePendingTasks")
  $lines.Add("")
  $lines.Add("## Notes")
  $lines.Add("- Fill the per-scenario debug numbers into ``phase0-debug-capture-template.csv`` right after the run.")
  $lines.Add("- Store the approved baseline CSV and summary under version control when Phase 0 is refreshed.")

  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

function Write-RegressionSummary([string]$Path, [string]$BaselineCsvPath, $CurrentRows) {
  $lines = New-Object System.Collections.Generic.List[string]
  $generatedAt = (Get-Date).ToString("s")

  if ([string]::IsNullOrWhiteSpace($BaselineCsvPath) -or -not (Test-Path $BaselineCsvPath)) {
    $lines.Add("# Desktop Memory Phase 0 Regression Summary")
    $lines.Add("")
    $lines.Add("> Generated: $generatedAt")
    $lines.Add("")
    $lines.Add("No baseline CSV was provided. Run this suite with ``-BaselineCsv <path>`` to produce deltas.")
    [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
    return
  }

  $baselineRows = Import-Csv -Path $BaselineCsvPath
  $baselineByScenario = @{}
  foreach ($row in $baselineRows) {
    $baselineByScenario[[string]$row.scenarioId] = $row
  }

  $lines.Add("# Desktop Memory Phase 0 Regression Summary")
  $lines.Add("")
  $lines.Add("> Generated: $generatedAt")
  $lines.Add("")
  $lines.Add("- Baseline CSV: ``$BaselineCsvPath``")
  $lines.Add("")
  $lines.Add("## Delta Table")
  $lines.Add("| Scenario | TaskMgr Max MB | Baseline | Delta | Private Max MB | Baseline | Delta |")
  $lines.Add("| --- | ---: | ---: | ---: | ---: | ---: | ---: |")

  foreach ($row in $CurrentRows) {
    $baseline = $baselineByScenario[[string]$row.scenarioId]
    $baselineTaskMgrMax = if ($baseline) { [double]$baseline.taskMgrMaxMB } else { [double]::NaN }
    $baselinePrivateMax = if ($baseline) { [double]$baseline.privateMaxMB } else { [double]::NaN }
    $deltaTaskMgr = if ([double]::IsNaN($baselineTaskMgrMax)) { $null } else { [math]::Round(([double]$row.taskMgrMaxMB) - $baselineTaskMgrMax, 2) }
    $deltaPrivate = if ([double]::IsNaN($baselinePrivateMax)) { $null } else { [math]::Round(([double]$row.privateMaxMB) - $baselinePrivateMax, 2) }

    $lines.Add(
      "| $($row.scenarioLabel) | $(Format-Number $row.taskMgrMaxMB) | $(Format-Number $baselineTaskMgrMax) | $(Format-Number $deltaTaskMgr) | $(Format-Number $row.privateMaxMB) | $(Format-Number $baselinePrivateMax) | $(Format-Number $deltaPrivate) |"
    )
  }

  $lines.Add("")
  $lines.Add("## Required Manual Review")
  $lines.Add("- Confirm whether debug metrics shifted together with the process deltas.")
  $lines.Add("- If only WebView2 private bytes moved, inspect page images and DOM resources first.")
  $lines.Add("- If queue approxJsonBytes stayed flat but process memory grew, keep investigation on page resources instead of queue payload.")

  [System.IO.File]::WriteAllLines($Path, $lines, [System.Text.UTF8Encoding]::new($false))
}

if ($Help.IsPresent) {
  Show-HelpText
  exit 0
}

$repoRoot = Get-RepoRoot
$perfScript = Join-Path $PSScriptRoot "perf-snapshot.ps1"
$suiteOutDir = Get-SuiteOutDir -RepoRoot $repoRoot -InputSuiteName $SuiteName
$scenarios = Build-Scenarios -IsQuickMode $Quick.IsPresent

Write-Host "[phase0] Repo: $repoRoot"
Write-Host "[phase0] SuiteOutDir: $suiteOutDir"
Write-Host "[phase0] Scenarios: $($scenarios.Count)"
Write-Host "[phase0] QuickMode: $($Quick.IsPresent)"

$devProcess = $null
if ($AutoStartDev.IsPresent) {
  Write-Host "[phase0] Auto starting app: pnpm dev"
  $devProcess = Start-Process -FilePath "pnpm.cmd" -ArgumentList "dev" -WorkingDirectory $repoRoot -PassThru
  if ($BootWaitSeconds -gt 0) {
    Write-Host "[phase0] Waiting $BootWaitSeconds seconds for startup"
    Start-Sleep -Seconds $BootWaitSeconds
  }
}

try {
  for ($index = 0; $index -lt $scenarios.Count; $index++) {
    $scenario = $scenarios[$index]
    Wait-ForScenarioReady -Scenario $scenario -Index ($index + 1) -Total $scenarios.Count
    Invoke-ScenarioCapture -PerfScriptPath $perfScript -SuiteOutDir $suiteOutDir -Scenario $scenario
  }

  $baselineRows = Build-BaselineRows -SuiteOutDir $suiteOutDir -Scenarios $scenarios
  $baselineCsvPath = Join-Path $suiteOutDir "phase0-baseline.csv"
  $baselineSummaryPath = Join-Path $suiteOutDir "phase0-baseline-summary.md"
  $debugTemplatePath = Join-Path $suiteOutDir "phase0-debug-capture-template.csv"
  $regressionSummaryPath = Join-Path $suiteOutDir "phase0-regression-summary.md"

  $baselineRows | Export-Csv -Path $baselineCsvPath -NoTypeInformation -Encoding utf8
  Write-DebugCaptureTemplate -Path $debugTemplatePath -Rows $baselineRows
  Write-BaselineSummary -Path $baselineSummaryPath -SuiteOutDir $suiteOutDir -Rows $baselineRows
  Write-RegressionSummary -Path $regressionSummaryPath -BaselineCsvPath $BaselineCsv -CurrentRows $baselineRows

  Write-Host "[phase0] Baseline CSV: $baselineCsvPath"
  Write-Host "[phase0] Baseline summary: $baselineSummaryPath"
  Write-Host "[phase0] Debug capture template: $debugTemplatePath"
  Write-Host "[phase0] Regression summary: $regressionSummaryPath"
  Write-Host "[phase0] Completed successfully"
} finally {
  if ($devProcess -and -not $devProcess.HasExited) {
    Write-Host "[phase0] Stopping auto-started dev process"
    cmd /c taskkill /PID $($devProcess.Id) /T /F | Out-Null
  }
}
