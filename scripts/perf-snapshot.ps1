Param(
  [Parameter(Mandatory = $false)]
  [string]$OutDir = "",

  [Parameter(Mandatory = $false)]
  [string]$OutName,

  [Parameter(Mandatory = $false)]
  [string]$OutSubDir = "",

  [Parameter(Mandatory = $false)]
  [string]$AppProcessName = "*pixel*",

  [Parameter(Mandatory = $false)]
  [string]$MainWindowTitleLike = "",

  [Parameter(Mandatory = $false)]
  [int]$TargetPid = 0,

  [Parameter(Mandatory = $false)]
  [switch]$IncludeWebView2,

  [Parameter(Mandatory = $false)]
  [switch]$StrictHostExe,

  [Parameter(Mandatory = $false)]
  [double]$IntervalSeconds = 0.5,

  [Parameter(Mandatory = $false)]
  [int]$DurationSeconds = 60,

  [Parameter(Mandatory = $false)]
  [int]$WaitSeconds = 60,

  [Parameter(Mandatory = $false)]
  [string]$Scenario = "manual",

  [Parameter(Mandatory = $false)]
  [string]$Notes = "",

  [Parameter(Mandatory = $false)]
  [int]$WarmupSeconds = 0,

  [Parameter(Mandatory = $false)]
  [ValidateSet('taskMgrMB', 'wsMB', 'privateMB')]
  [string]$PeakMetric = "taskMgrMB",

  [Parameter(Mandatory = $false)]
  [int]$PeakTopN = 8,

  [Parameter(Mandatory = $false)]
  [switch]$FlatOutput,

  [Parameter(Mandatory = $false)]
  [switch]$ListCandidates,

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

function Resolve-DefaultOutDir() {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  return (Join-Path $repoRoot "snapshots")
}

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Get-DateStamp() {
  return (Get-Date).ToString("yyyy-MM-dd")
}

function Get-UniquePath([string]$Path) {
  if (-not (Test-Path $Path)) { return $Path }
  $base = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $ext = [System.IO.Path]::GetExtension($Path)
  $dir = [System.IO.Path]::GetDirectoryName($Path)
  $i = 1
  while ($true) {
    $candidate = Join-Path $dir ("{0}-{1}{2}" -f $base, $i, $ext)
    if (-not (Test-Path $candidate)) { return $candidate }
    $i++
  }
}

function Get-CimProcesses() {
  return Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine
}

function Get-WebView2TypeFromCommandLine([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return "browser"
  }
  if ($CommandLine -match '--type=([^\s]+)') {
    return [string]$Matches[1]
  }
  return "browser"
}

function Get-WebView2HostExeFromCommandLine([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return ""
  }
  if ($CommandLine -match '--webview-exe-name=(.+?)(?=\s--|$)') {
    return ([string]$Matches[1]).Trim('"').Trim()
  }
  return ""
}

function Build-WebView2MetaMap($CimProcesses) {
  $metaByPid = @{}
  foreach ($proc in $CimProcesses) {
    if ($null -eq $proc -or $null -eq $proc.Name) { continue }
    if ([string]$proc.Name -ne "msedgewebview2.exe") { continue }

    $procPid = [int]$proc.ProcessId
    $type = Get-WebView2TypeFromCommandLine -CommandLine ([string]$proc.CommandLine)
    $hostExe = Get-WebView2HostExeFromCommandLine -CommandLine ([string]$proc.CommandLine)

    $metaByPid[$procPid] = [PSCustomObject]@{
      type = $type
      hostExe = $hostExe
    }
  }
  return $metaByPid
}

function Get-TaskManagerMemoryMap() {
  $map = @{}
  try {
    $perfRows = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop |
      Select-Object IDProcess, WorkingSetPrivate
    foreach ($row in $perfRows) {
      $procId = [int]$row.IDProcess
      if ($procId -le 0) { continue }
      if ($null -eq $row.WorkingSetPrivate) { continue }
      $map[$procId] = [double]$row.WorkingSetPrivate
    }
  } catch {
    # best-effort metric; return empty map if perf class isn't available
  }
  return $map
}

function Get-DescendantPids([int[]]$RootPids, $CimProcesses) {
  $rootSet = @{}
  foreach ($p in $RootPids) { $rootSet[$p] = $true }

  $childrenByParent = @{}
  foreach ($proc in $CimProcesses) {
    $ppid = [int]$proc.ParentProcessId
    if (-not $childrenByParent.ContainsKey($ppid)) { $childrenByParent[$ppid] = New-Object System.Collections.Generic.List[int] }
    $childrenByParent[$ppid].Add([int]$proc.ProcessId)
  }

  $result = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($p in $RootPids) { $queue.Enqueue([int]$p) | Out-Null }

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($result.Add($current)) {
      if ($childrenByParent.ContainsKey($current)) {
        foreach ($child in $childrenByParent[$current]) {
          $queue.Enqueue($child) | Out-Null
        }
      }
    }
  }

  return ,@($result)
}

function Resolve-RootHostExeNames([int[]]$RootPids) {
  $names = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($rootPid in $RootPids) {
    try {
      $proc = Get-Process -Id ([int]$rootPid) -ErrorAction Stop
      if ($null -eq $proc -or [string]::IsNullOrWhiteSpace($proc.ProcessName)) { continue }
      $exeName = ([string]$proc.ProcessName).Trim() + '.exe'
      if (-not [string]::IsNullOrWhiteSpace($exeName)) {
        [void]$names.Add($exeName)
      }
    } catch {
      # ignore
    }
  }
  return ,@($names)
}

function Resolve-RootPids([string]$ProcessName, [string]$WindowTitleLike, [int]$PidValue, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ($true) {
    if ($PidValue -gt 0) {
      try {
        $p = Get-Process -Id $PidValue -ErrorAction Stop
        return ,@([int]$p.Id)
      } catch {
        if ((Get-Date) -ge $deadline) { throw "PID $PidValue not found within ${TimeoutSeconds}s." }
      }
    } elseif (-not [string]::IsNullOrWhiteSpace($WindowTitleLike)) {
      $titleMatches = @(
        Get-Process -ErrorAction SilentlyContinue |
          Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like $WindowTitleLike }
      )
      if ($titleMatches.Count -gt 0) {
        return ,@($titleMatches | Select-Object -ExpandProperty Id | ForEach-Object { [int]$_ })
      }
      if ((Get-Date) -ge $deadline) {
        throw "MainWindowTitle like '$WindowTitleLike' not found within ${TimeoutSeconds}s."
      }
    } else {
      $matches = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like $ProcessName })
      if ($matches.Count -gt 0) {
        return ,@($matches | Select-Object -ExpandProperty Id | ForEach-Object { [int]$_ })
      }
      if ((Get-Date) -ge $deadline) { throw "ProcessName '$ProcessName' not found within ${TimeoutSeconds}s." }
    }
    Start-Sleep -Milliseconds 200
  }
}

function Quantile([double[]]$Values, [double]$q) {
  if (-not $Values -or $Values.Count -eq 0) { return [double]::NaN }
  $sorted = $Values | Sort-Object
  $n = $sorted.Count
  if ($n -eq 1) { return [double]$sorted[0] }
  $pos = ($n - 1) * $q
  $lo = [math]::Floor($pos)
  $hi = [math]::Ceiling($pos)
  if ($lo -eq $hi) { return [double]$sorted[$lo] }
  $w = $pos - $lo
  return ([double]$sorted[$lo] * (1 - $w)) + ([double]$sorted[$hi] * $w)
}

function SafeAvg([double[]]$Values) {
  if (-not $Values -or $Values.Count -eq 0) { return [double]::NaN }
  return ($Values | Measure-Object -Average).Average
}

function SafeMax([double[]]$Values) {
  if (-not $Values -or $Values.Count -eq 0) { return [double]::NaN }
  return ($Values | Measure-Object -Maximum).Maximum
}

function Resolve-PeakProcessMetricField([string]$Metric) {
  switch ($Metric) {
    'taskMgrMB' { return 'taskMgrPrivateWorkingSetMB' }
    'wsMB' { return 'wsMB' }
    'privateMB' { return 'privateMB' }
    default { return 'taskMgrPrivateWorkingSetMB' }
  }
}

function Show-PerfSnapshotHelp() {
  $helpText = @'
鎬ц兘蹇収鑴氭湰锛堝崟杞級- scripts/perf-snapshot.ps1

鐢ㄩ€旓細
  1) 閲囬泦鎸囧畾搴旂敤锛堝彲鍚?WebView2 瀛愯繘绋嬶級鐨?CPU/鍐呭瓨鏇茬嚎
  2) 杈撳嚭 .md 鎶ュ憡 + .csv 鍘熷鏁版嵁
  3) 璁板綍宄板€兼椂鍒荤殑 Top N 杩涚▼

鍏抽敭鍙傛暟锛堝父鐢級锛?  -Scenario [name]            鍦烘櫙鍚嶏紙寤鸿蹇呭～锛?  -MainWindowTitleLike [pat]  閫氳繃绐楀彛鏍囬瀹氫綅涓昏繘绋嬶紙鎺ㄨ崘锛?  -AppProcessName [pat]       閫氳繃杩涚▼鍚嶅畾浣嶄富杩涚▼锛堝 '*pixel*'锛?  -TargetPid [pid]            鐩存帴鎸囧畾 PID锛堟渶绮剧‘锛?  -IncludeWebView2            鏄惁鍖呭惈 msedgewebview2 瀛愯繘绋?  -DurationSeconds [sec]      閲囨牱鏃堕暱
  -IntervalSeconds [sec]      閲囨牱闂撮殧
  -WarmupSeconds [sec]        棰勭儹绛夊緟锛堝厛鎵撳紑閲嶈礋杞界獥鍙ｏ級
  -PeakMetric [taskMgrMB|wsMB|privateMB]  宄板€煎垽瀹氱淮搴?  -PeakTopN [n]               宄板€兼椂鍒绘樉绀哄墠 n 涓繘绋?  -OutDir / -OutSubDir / -OutName  杈撳嚭鐩綍涓庢枃浠跺悕
  -ListCandidates             鍒楀嚭鍊欓€夎繘绋?绐楀彛锛堜笉閲囨牱锛?
鎸囨爣瑙ｉ噴锛?  taskMgrMB = 浠诲姟绠＄悊鍣ㄢ€滃唴瀛橈紙涓撶敤宸ヤ綔闆嗭級鈥濊繎浼煎€?  wsMB      = Working Set锛堝伐浣滈泦锛?  privateMB = Private Bytes锛堢鏈夋彁浜わ級

WebView2 瑙掕壊锛?  browser / renderer / gpu-process / utility / crashpad-handler

绀轰緥锛?  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 -MainWindowTitleLike '*Pixel Matrix Player*' -Scenario baseline -DurationSeconds 60 -IntervalSeconds 0.5
  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 -MainWindowTitleLike '*Pixel Matrix Player*' -Scenario stress -IncludeWebView2 -DurationSeconds 90 -WarmupSeconds 20 -PeakTopN 12
'@
  Write-Host $helpText
}

if ($Help.IsPresent) {
  Show-PerfSnapshotHelp
  exit 0
}

$dateStamp = Get-DateStamp
if (-not $OutName -or $OutName.Trim().Length -eq 0) {
  $OutName = "$dateStamp-$Scenario"
}

$OutDir = if ([string]::IsNullOrWhiteSpace($OutDir)) { Resolve-DefaultOutDir } else { $OutDir }
Ensure-Directory $OutDir

$resolvedOutSubDir = $OutSubDir
if ([string]::IsNullOrWhiteSpace($resolvedOutSubDir) -and -not $FlatOutput.IsPresent) {
  $resolvedOutSubDir = $OutName
}

$targetOutDir = $OutDir
if (-not [string]::IsNullOrWhiteSpace($resolvedOutSubDir)) {
  $targetOutDir = Join-Path $OutDir $resolvedOutSubDir
}

Ensure-Directory $targetOutDir

$outMdPath = Get-UniquePath (Join-Path $targetOutDir ("$OutName.md"))
$outCsvPath = [System.IO.Path]::ChangeExtension($outMdPath, ".csv")

$cpuCount = [Environment]::ProcessorCount
$peakMetricProcessField = Resolve-PeakProcessMetricField $PeakMetric

Write-Host ("[perf-snapshot] Out: {0}" -f $outMdPath)
Write-Host ("[perf-snapshot] OutDir: {0}" -f $targetOutDir)
Write-Host ("[perf-snapshot] Scenario: {0}" -f $Scenario)
Write-Host ("[perf-snapshot] Looking for process: {0}" -f $(
  if ($TargetPid -gt 0) {
    "PID $TargetPid"
  } elseif (-not [string]::IsNullOrWhiteSpace($MainWindowTitleLike)) {
    "MainWindowTitle like '$MainWindowTitleLike'"
  } else {
    $AppProcessName
  }
))
Write-Host ("[perf-snapshot] IncludeWebView2: {0}" -f $IncludeWebView2.IsPresent)
Write-Host ("[perf-snapshot] StrictHostExe: {0}" -f $StrictHostExe.IsPresent)
Write-Host ("[perf-snapshot] IntervalSeconds: {0}, DurationSeconds: {1}" -f $IntervalSeconds, $DurationSeconds)
Write-Host ("[perf-snapshot] WarmupSeconds: {0}" -f $WarmupSeconds)
Write-Host ("[perf-snapshot] PeakMetric: {0}, PeakTopN: {1}" -f $PeakMetric, $PeakTopN)

if ($ListCandidates.IsPresent) {
  Write-Host "[perf-snapshot] Candidate processes (name match):"
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like $AppProcessName } |
    Sort-Object Id |
    Select-Object Id, ProcessName, MainWindowTitle |
    Format-Table -AutoSize

  if (-not [string]::IsNullOrWhiteSpace($MainWindowTitleLike)) {
    Write-Host "[perf-snapshot] Candidate windows (title match):"
    Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like $MainWindowTitleLike } |
      Sort-Object Id |
      Select-Object Id, ProcessName, MainWindowTitle |
      Format-Table -AutoSize
  }

  Write-Host "[perf-snapshot] Tip: if nothing shows, try -AppProcessName '*pixel*' or pass -TargetPid <pid>."
  exit 0
}

try {
  $rootPids = Resolve-RootPids -ProcessName $AppProcessName -WindowTitleLike $MainWindowTitleLike -PidValue $TargetPid -TimeoutSeconds $WaitSeconds
} catch {
  Write-Host ("[perf-snapshot] ERROR: {0}" -f $_.Exception.Message)
  Write-Host "[perf-snapshot] Tip: run in the same Windows session where the app is running."
  Write-Host "[perf-snapshot] Tip: use -ListCandidates to discover the real process name:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 -ListCandidates -AppProcessName '*pixel*'"
  Write-Host "[perf-snapshot] Or target PID explicitly:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 -TargetPid <pid> -Scenario idle -DurationSeconds 60 -IntervalSeconds 0.5 -IncludeWebView2"
  Write-Host "[perf-snapshot] Or target by window title:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/perf-snapshot.ps1 -MainWindowTitleLike '*闊充箰鎾斁鍣?' -Scenario idle -DurationSeconds 60 -IntervalSeconds 0.5 -IncludeWebView2"
  exit 2
}
Write-Host ("[perf-snapshot] Root PIDs: {0}" -f (($rootPids -join ", ")))
$rootPidsDesc = ($rootPids -join ", ")
$rootHostExeNames = Resolve-RootHostExeNames -RootPids $rootPids
$rootPidSet = New-Object System.Collections.Generic.HashSet[int]
foreach ($rp in $rootPids) {
  [void]$rootPidSet.Add([int]$rp)
}

if ($WarmupSeconds -gt 0) {
  Write-Host ("[perf-snapshot] Warmup started: {0}s (open heavy windows now)" -f $WarmupSeconds)
  for ($remaining = $WarmupSeconds; $remaining -gt 0; $remaining--) {
    $elapsed = $WarmupSeconds - $remaining
    $pct = if ($WarmupSeconds -gt 0) { [math]::Round(($elapsed * 100.0) / $WarmupSeconds, 1) } else { 100 }
    Write-Progress -Id 2 -Activity "perf-snapshot warmup" -Status ("Open heavy views now; capture starts in {0}s" -f $remaining) -PercentComplete $pct
    Start-Sleep -Seconds 1
  }
  Write-Progress -Id 2 -Activity "perf-snapshot warmup" -Completed
}

$startTime = Get-Date

$prevCpuByPid = @{}
$prevTime = $startTime

$samples = New-Object System.Collections.Generic.List[object]
$peakSample = $null
$peakTopProcesses = @()
$peakMetricValue = [double]::NegativeInfinity

$endTime = $startTime.AddSeconds($DurationSeconds)
while ((Get-Date) -lt $endTime) {
  $now = Get-Date
  $elapsedSeconds = ($now - $startTime).TotalSeconds
  $remainingSeconds = [math]::Max(0, ($endTime - $now).TotalSeconds)
  $percent = if ($DurationSeconds -gt 0) { [math]::Min(100, [math]::Max(0, ($elapsedSeconds / $DurationSeconds) * 100.0)) } else { 0 }
  Write-Progress -Id 1 -Activity "perf-snapshot" -Status ("Scenario={0}  Elapsed={1:n1}s  Remaining={2:n1}s  Samples={3}" -f $Scenario, $elapsedSeconds, $remainingSeconds, $samples.Count) -PercentComplete $percent

  $dt = ($now - $prevTime).TotalSeconds
  if ($dt -le 0) { $dt = $IntervalSeconds }

  $cim = Get-CimProcesses
  $webView2MetaByPid = Build-WebView2MetaMap -CimProcesses $cim
  $allPids = Get-DescendantPids -RootPids $rootPids -CimProcesses $cim

  if (-not $IncludeWebView2.IsPresent) {
    $allPids = $allPids | Where-Object {
      $pidValue = [int]$_
      $proc = $cim | Where-Object { [int]$_.ProcessId -eq $pidValue } | Select-Object -First 1
      if (-not $proc) { return $false }
      return ($proc.Name -ne "msedgewebview2.exe")
    }
  } elseif ($StrictHostExe.IsPresent) {
    $allPids = $allPids | Where-Object {
      $pidValue = [int]$_
      if ($rootPidSet.Contains($pidValue)) { return $true }

      $proc = $cim | Where-Object { [int]$_.ProcessId -eq $pidValue } | Select-Object -First 1
      if (-not $proc) { return $false }

      if ([string]$proc.Name -ne 'msedgewebview2.exe') {
        return $false
      }

      if (-not $webView2MetaByPid.ContainsKey($pidValue)) {
        return $true
      }

      $meta = $webView2MetaByPid[$pidValue]
      $hostExe = [string]$meta.hostExe
      if ([string]::IsNullOrWhiteSpace($hostExe)) {
        return $true
      }

      return $rootHostExeNames -contains $hostExe
    }
  }

  $procs = @()
  foreach ($p in $allPids) {
    try {
      $procs += Get-Process -Id ([int]$p) -ErrorAction Stop
    } catch {
      # process exited between CIM snapshot and Get-Process; ignore
    }
  }

  $deltaCpuSeconds = 0.0
  foreach ($p in $procs) {
    $pidKey = [int]$p.Id
    $cpuSeconds = if ($null -ne $p.CPU) { [double]$p.CPU } else { 0.0 }
    if ($prevCpuByPid.ContainsKey($pidKey)) {
      $deltaCpuSeconds += ($cpuSeconds - [double]$prevCpuByPid[$pidKey])
    }
    $prevCpuByPid[$pidKey] = $cpuSeconds
  }

  $cpuPercent = ($deltaCpuSeconds / $dt) * 100.0 / $cpuCount
  if ($cpuPercent -lt 0) { $cpuPercent = 0 }

  $wsBytes = ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
  if (-not $wsBytes) { $wsBytes = 0 }

  $pmBytes = ($procs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
  if (-not $pmBytes) { $pmBytes = 0 }

  $taskManagerMemoryMap = Get-TaskManagerMemoryMap
  $tmBytes = 0.0
  foreach ($p in $allPids) {
    $pidValue = [int]$p
    if ($taskManagerMemoryMap.ContainsKey($pidValue)) {
      $tmBytes += [double]$taskManagerMemoryMap[$pidValue]
    }
  }

  $processRows = @()
  foreach ($process in $procs) {
    $procId = [int]$process.Id
    $procRole = "app"
    $procHostExe = ""
    if ($webView2MetaByPid.ContainsKey($procId)) {
      $meta = $webView2MetaByPid[$procId]
      $procRole = [string]$meta.type
      $procHostExe = [string]$meta.hostExe
    }

    $procTaskMgrBytes = 0.0
    if ($taskManagerMemoryMap.ContainsKey($procId)) {
      $procTaskMgrBytes = [double]$taskManagerMemoryMap[$procId]
    }

    $processRows += [PSCustomObject]@{
      pid                      = $procId
      name                     = $process.ProcessName
      role                     = $procRole
      hostExe                  = $procHostExe
      wsMB                     = [math]::Round(($process.WorkingSet64 / 1MB), 2)
      privateMB                = [math]::Round(($process.PrivateMemorySize64 / 1MB), 2)
      taskMgrPrivateWorkingSetMB = [math]::Round(($procTaskMgrBytes / 1MB), 2)
    }
  }

  $sample = [PSCustomObject]@{
    timestamp = $now.ToString("o")
    pidCount  = $procs.Count
    cpuPct    = [math]::Round($cpuPercent, 2)
    wsMB      = [math]::Round(($wsBytes / 1MB), 2)
    privateMB = [math]::Round(($pmBytes / 1MB), 2)
    taskMgrMB = [math]::Round(($tmBytes / 1MB), 2)
  }
  $samples.Add($sample) | Out-Null

  $metricValue = [double]$sample.$PeakMetric
  if ($metricValue -gt $peakMetricValue) {
    $peakMetricValue = $metricValue
    $peakSample = $sample
    if ($PeakTopN -gt 0 -and $processRows.Count -gt 0) {
      $peakTopProcesses = @($processRows | Sort-Object -Property $peakMetricProcessField -Descending | Select-Object -First $PeakTopN)
    } else {
      $peakTopProcesses = @()
    }
  }

  $prevTime = $now
  Start-Sleep -Milliseconds ([int]([math]::Max(50, $IntervalSeconds * 1000)))
}

Write-Progress -Id 1 -Activity "perf-snapshot" -Completed

$cpuSeries = @($samples | Select-Object -ExpandProperty cpuPct | ForEach-Object { [double]$_ })
$wsSeries = @($samples | Select-Object -ExpandProperty wsMB | ForEach-Object { [double]$_ })
$pmSeries = @($samples | Select-Object -ExpandProperty privateMB | ForEach-Object { [double]$_ })
$tmSeries = @($samples | Select-Object -ExpandProperty taskMgrMB | ForEach-Object { [double]$_ })

$summary = [PSCustomObject]@{
  startTime       = $startTime.ToString("o")
  endTime         = (Get-Date).ToString("o")
  durationSeconds = $DurationSeconds
  intervalSeconds = $IntervalSeconds
  cpuCores        = $cpuCount
  sampleCount     = $samples.Count
  cpuAvgPct       = [math]::Round((SafeAvg $cpuSeries), 2)
  cpuP95Pct       = [math]::Round((Quantile $cpuSeries 0.95), 2)
  cpuMaxPct       = [math]::Round((SafeMax $cpuSeries), 2)
  wsAvgMB         = [math]::Round((SafeAvg $wsSeries), 2)
  wsMaxMB         = [math]::Round((SafeMax $wsSeries), 2)
  privateAvgMB    = [math]::Round((SafeAvg $pmSeries), 2)
  privateMaxMB    = [math]::Round((SafeMax $pmSeries), 2)
  taskMgrAvgMB    = [math]::Round((SafeAvg $tmSeries), 2)
  taskMgrMaxMB    = [math]::Round((SafeMax $tmSeries), 2)
}

$samples | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $outCsvPath

$rootDesc = if ($TargetPid -gt 0) {
  "PID $TargetPid"
} elseif (-not [string]::IsNullOrWhiteSpace($MainWindowTitleLike)) {
  "MainWindowTitle like '$MainWindowTitleLike'"
} else {
  $AppProcessName
}
$csvLeaf = Split-Path -Leaf $outCsvPath
$tick = [char]96

$mdLines = New-Object System.Collections.Generic.List[string]
$mdLines.Add("# Perf Snapshot - $OutName") | Out-Null
$mdLines.Add("") | Out-Null
$mdLines.Add("> Generated: $($summary.startTime)") | Out-Null
$mdLines.Add("") | Out-Null
$mdLines.Add("## Scenario") | Out-Null
$mdLines.Add(("- Scenario: " + $tick + $Scenario + $tick)) | Out-Null
$mdLines.Add(("- Notes: " + $Notes)) | Out-Null
$mdLines.Add("") | Out-Null
$mdLines.Add("## Capture") | Out-Null
$mdLines.Add(("- Root: " + $tick + $rootDesc + $tick)) | Out-Null
$mdLines.Add(("- Root PIDs: " + $tick + $rootPidsDesc + $tick)) | Out-Null
$mdLines.Add(("- IncludeWebView2: " + $tick + $IncludeWebView2.IsPresent + $tick)) | Out-Null
$mdLines.Add(("- Duration: " + $tick + $DurationSeconds + $tick + "s, Interval: " + $tick + $IntervalSeconds + $tick + "s, Samples: " + $tick + $summary.sampleCount + $tick)) | Out-Null
$mdLines.Add(("- CPU cores: " + $tick + $summary.cpuCores + $tick)) | Out-Null
$mdLines.Add("") | Out-Null
$mdLines.Add("## Summary") | Out-Null
$mdLines.Add(("- CPU% (avg/p95/max): " + $tick + $summary.cpuAvgPct + $tick + " / " + $tick + $summary.cpuP95Pct + $tick + " / " + $tick + $summary.cpuMaxPct + $tick)) | Out-Null
$mdLines.Add(("- Task Manager Memory MB (avg/max): " + $tick + $summary.taskMgrAvgMB + $tick + " / " + $tick + $summary.taskMgrMaxMB + $tick)) | Out-Null
$mdLines.Add(("- Working Set MB (avg/max): " + $tick + $summary.wsAvgMB + $tick + " / " + $tick + $summary.wsMaxMB + $tick)) | Out-Null
$mdLines.Add(("- Private MB (avg/max): " + $tick + $summary.privateAvgMB + $tick + " / " + $tick + $summary.privateMaxMB + $tick)) | Out-Null
$mdLines.Add("") | Out-Null
$mdLines.Add("## Peak Snapshot") | Out-Null
$mdLines.Add(("- Peak metric: " + $tick + $PeakMetric + $tick)) | Out-Null
if ($null -ne $peakSample) {
  $mdLines.Add(("- Peak value: " + $tick + $peakMetricValue + $tick)) | Out-Null
  $mdLines.Add(("- Peak at: " + $tick + $peakSample.timestamp + $tick)) | Out-Null
}
if ($peakTopProcesses.Count -gt 0) {
  $mdLines.Add("") | Out-Null
  $mdLines.Add("### Top Processes At Peak") | Out-Null
  $mdLines.Add("| PID | Name | Role | HostExe | TaskMgrMB | WorkingSetMB | PrivateMB |") | Out-Null
  $mdLines.Add("| --- | --- | --- | --- | ---: | ---: | ---: |") | Out-Null
  foreach ($row in $peakTopProcesses) {
    $hostExeText = [string]$row.hostExe
    if ([string]::IsNullOrWhiteSpace($hostExeText)) {
      $hostExeText = "-"
    }
    $mdLines.Add(("| " + $row.pid + " | " + $row.name + " | " + $row.role + " | " + $hostExeText + " | " + $row.taskMgrPrivateWorkingSetMB + " | " + $row.wsMB + " | " + $row.privateMB + " |")) | Out-Null
  }

  $mdLines.Add("") | Out-Null
  $mdLines.Add("#### Role Legend") | Out-Null
  $mdLines.Add("- browser: WebView2 browser process") | Out-Null
  $mdLines.Add("- renderer: page renderer process (DOM/JS/layout)") | Out-Null
  $mdLines.Add("- gpu-process: GPU compositor and graphics process") | Out-Null
  $mdLines.Add("- utility: network/storage/decode service process") | Out-Null
  $mdLines.Add("- crashpad-handler: crash collection process") | Out-Null
}
$mdLines.Add("") | Out-Null
$mdLines.Add("## Raw Data") | Out-Null
$mdLines.Add(("- CSV: " + $tick + $csvLeaf + $tick)) | Out-Null

$mdLines | Out-File -Encoding UTF8 -FilePath $outMdPath

Write-Host ("[perf-snapshot] Wrote: {0}" -f $outMdPath)
Write-Host ("[perf-snapshot] CSV:   {0}" -f $outCsvPath)
