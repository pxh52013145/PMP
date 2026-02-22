param(
  [string]$TrackPath = "",
  [string]$Presets = "all",
  [int]$PlayMs = 2800,
  [double]$SeekSeconds = 8,
  [int]$SeekCount = 4,
  [int]$SeekIntervalMs = 180,
  [int]$StressCpuThreads = [Math]::Max([Environment]::ProcessorCount / 3, 1),
  [int]$TimeoutSeconds = 900,
  [switch]$ListPresets,
  [switch]$DryRun,
  [switch]$StopOnFailure
)

$ErrorActionPreference = 'Stop'

function Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message"
}

function Normalize-List([string]$Raw) {
  return @($Raw.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$audioSmokeScript = Join-Path $repoRoot 'scripts/audio-smoke.ps1'
if (-not (Test-Path $audioSmokeScript)) {
  throw "Cannot find scripts/audio-smoke.ps1"
}

$presetsTable = @(
  [pscustomobject]@{
    Name = 'shared-48-balanced'
    Backend = 'wasapi'
    Description = 'Shared baseline for 44.1/48k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'balanced'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '1.2'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '1'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '2'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '3'
      PMP_AUDIO_SHARED_RENDER_AHEAD_SECONDS = '0.8'
      PMP_AUDIO_SHARED_RENDER_AHEAD_PREROLL_SECONDS = '0.14'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_MS = '180'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_TIMEOUT_MS = '220'
    }
  },
  [pscustomobject]@{
    Name = 'shared-96-robust'
    Backend = 'wasapi'
    Description = 'Shared robust profile for 88.2/96k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'stable'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '1.8'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '2'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '3'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '4'
      PMP_AUDIO_SHARED_RENDER_AHEAD_SECONDS = '1.1'
      PMP_AUDIO_SHARED_RENDER_AHEAD_PREROLL_SECONDS = '0.20'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_MS = '240'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_TIMEOUT_MS = '280'
    }
  },
  [pscustomobject]@{
    Name = 'shared-raw-96-robust'
    Backend = 'wasapi-shared-raw'
    Description = 'Shared-raw robust profile for 88.2/96k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'stable'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '2.0'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '2'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '3'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '4'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_MS = '260'
      PMP_AUDIO_WASAPI_SHARED_RAW_PREFILL_TIMEOUT_MS = '320'
    }
  },
  [pscustomobject]@{
    Name = 'exclusive-48-fast'
    Backend = 'wasapi-exclusive'
    Description = 'Exclusive low-latency profile for 44.1/48k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'fast'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '0.9'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '1'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '1'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '2'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_MS = '90'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_TIMEOUT_MS = '120'
    }
  },
  [pscustomobject]@{
    Name = 'exclusive-96-balanced'
    Backend = 'wasapi-exclusive'
    Description = 'Exclusive balanced profile for 88.2/96k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'balanced'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '1.3'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '1'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '2'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '3'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_MS = '140'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_TIMEOUT_MS = '170'
    }
  },
  [pscustomobject]@{
    Name = 'exclusive-192-robust'
    Backend = 'wasapi-exclusive'
    Description = 'Exclusive robust profile for 176.4/192k'
    Env = [ordered]@{
      PMP_AUDIO_STREAM_INTERACTIVE_PROFILE = 'stable'
      PMP_AUDIO_RENDER_QUEUE_SECONDS = '2.4'
      PMP_AUDIO_SOURCE_POP_WAIT_NORMAL_MS = '2'
      PMP_AUDIO_SOURCE_POP_WAIT_GUARDED_MS = '3'
      PMP_AUDIO_SOURCE_POP_WAIT_CRITICAL_MS = '4'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_MS = '220'
      PMP_AUDIO_WASAPI_EXCLUSIVE_PREFILL_TIMEOUT_MS = '280'
    }
  }
)

if ($ListPresets.IsPresent) {
  $presetsTable | Select-Object Name, Backend, Description | Format-Table -AutoSize
  exit 0
}

$selectedNames = if ($Presets -eq 'all') {
  $presetsTable.Name
} else {
  Normalize-List $Presets
}

if ($selectedNames.Count -eq 0) {
  throw "No presets selected. Use -Presets all or comma-separated preset names."
}

$selectedPresets = @($presetsTable | Where-Object { $selectedNames -contains $_.Name })
$missing = @($selectedNames | Where-Object { $_ -notin $selectedPresets.Name })
if ($missing.Count -gt 0) {
  throw ("Unknown presets: {0}" -f ($missing -join ', '))
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputDir = Join-Path $repoRoot ("logs/audio-buffer-stress-{0}" -f $timestamp)
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$results = New-Object System.Collections.Generic.List[object]

foreach ($preset in $selectedPresets) {
  Step ("Running {0} ({1})" -f $preset.Name, $preset.Backend)

  $savedEnv = @{}
  foreach ($entry in $preset.Env.GetEnumerator()) {
    $key = $entry.Key
    if (Test-Path "Env:$key") {
      $savedEnv[$key] = (Get-Item "Env:$key").Value
    } else {
      $savedEnv[$key] = $null
    }
    Set-Item "Env:$key" $entry.Value
  }

  $scenarioLog = Join-Path $outputDir ("{0}.log" -f $preset.Name)
  $start = Get-Date
  $status = 'passed'
  $errorMessage = ''

  try {
    $args = @(
      '-ExecutionPolicy', 'Bypass',
      '-File', $audioSmokeScript,
      '-BackendId', $preset.Backend,
      '-PlayMs', [string]$PlayMs,
      '-SeekSeconds', [string]$SeekSeconds,
      '-SeekCount', [string]$SeekCount,
      '-SeekIntervalMs', [string]$SeekIntervalMs,
      '-StressCpuThreads', [string]$StressCpuThreads,
      '-TimeoutSeconds', [string]$TimeoutSeconds
    )

    if (-not [string]::IsNullOrWhiteSpace($TrackPath)) {
      $args += @('-TrackPath', $TrackPath)
    }

    if ($DryRun.IsPresent) {
      $status = 'dry-run'
      "powershell $($args -join ' ')" | Set-Content -Path $scenarioLog -Encoding UTF8
      Write-Host "DryRun: $($preset.Name)"
    } else {
      $output = & powershell @args 2>&1
      $exitCode = $LASTEXITCODE
      $output | Set-Content -Path $scenarioLog -Encoding UTF8
      if ($exitCode -ne 0) {
        $status = 'failed'
        $errorMessage = "audio-smoke exit code $exitCode"
      }
    }
  } catch {
    $status = 'failed'
    $errorMessage = $_.Exception.Message
    $_ | Out-String | Set-Content -Path $scenarioLog -Encoding UTF8
  } finally {
    foreach ($entry in $savedEnv.GetEnumerator()) {
      $key = $entry.Key
      $value = $entry.Value
      if ($null -eq $value) {
        Remove-Item "Env:$key" -ErrorAction SilentlyContinue
      } else {
        Set-Item "Env:$key" $value
      }
    }
  }

  $duration = [Math]::Round(((Get-Date) - $start).TotalSeconds, 2)
  Write-Host ("Result: {0} ({1}s)" -f $status, $duration)

  $results.Add([pscustomobject]@{
    Scenario = $preset.Name
    Backend = $preset.Backend
    Status = $status
    DurationSeconds = $duration
    Error = $errorMessage
    LogFile = [System.IO.Path]::GetFileName($scenarioLog)
  })

  if ($status -eq 'failed' -and $StopOnFailure.IsPresent) {
    throw ("Scenario failed: {0} ({1})" -f $preset.Name, $errorMessage)
  }
}

$summaryCsv = Join-Path $outputDir 'summary.csv'
$results | Export-Csv -Path $summaryCsv -NoTypeInformation -Encoding UTF8

$summaryMd = Join-Path $outputDir 'summary.md'
$md = New-Object System.Collections.Generic.List[string]
$md.Add('# Audio Buffer Stress Summary')
$md.Add('')
$md.Add(("- GeneratedAt: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')))
$md.Add(("- Presets: {0}" -f ($selectedPresets.Name -join ', ')))
$md.Add(("- TrackPath: {0}" -f ($(if ([string]::IsNullOrWhiteSpace($TrackPath)) { '(auto)' } else { $TrackPath }))))
$md.Add(("- OutputDir: {0}" -f $outputDir))
$md.Add('')
$md.Add('| Scenario | Backend | Status | Duration(s) | Log |')
$md.Add('| --- | --- | --- | ---: | --- |')
foreach ($row in $results) {
  $md.Add(("| {0} | {1} | {2} | {3} | {4} |" -f $row.Scenario, $row.Backend, $row.Status, $row.DurationSeconds, $row.LogFile))
}
$md.Add('')
$md.Add('## Preset Environment Variables')
foreach ($preset in $selectedPresets) {
  $md.Add('')
  $md.Add(("### {0}" -f $preset.Name))
  foreach ($entry in $preset.Env.GetEnumerator()) {
    $md.Add(("- {0}={1}" -f $entry.Key, $entry.Value))
  }
}
$md | Set-Content -Path $summaryMd -Encoding UTF8

Step 'Completed'
Write-Host "Summary CSV: $summaryCsv"
Write-Host "Summary MD:  $summaryMd"
