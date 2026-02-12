use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum ProcessPerfKind {
    #[serde(rename = "app")]
    App,
    #[serde(rename = "webview2")]
    WebView2,
    #[serde(rename = "child")]
    Child,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemorySnapshot {
    pub memory_load_percent: u32,
    pub total_physical_bytes: u64,
    pub available_physical_bytes: u64,
    pub total_page_file_bytes: u64,
    pub available_page_file_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPerfRow {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub kind: ProcessPerfKind,
    pub cpu_percent: Option<f64>,
    pub working_set_bytes: Option<u64>,
    pub private_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPerfTotals {
    pub working_set_bytes: u64,
    pub private_bytes: u64,
    pub cpu_percent: Option<f64>,
    pub app_working_set_bytes: u64,
    pub app_private_bytes: u64,
    pub app_cpu_percent: Option<f64>,
    pub webview2_working_set_bytes: u64,
    pub webview2_private_bytes: u64,
    pub webview2_cpu_percent: Option<f64>,
    pub other_working_set_bytes: u64,
    pub other_private_bytes: u64,
    pub other_cpu_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPerfSnapshot {
    pub timestamp_ms: u64,
    pub sample_interval_ms: Option<u64>,
    pub cpu_count: usize,
    pub root_pid: u32,
    pub system_memory: Option<SystemMemorySnapshot>,
    pub totals: ProcessPerfTotals,
    pub processes: Vec<ProcessPerfRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPerfTotalsSnapshot {
    pub timestamp_ms: u64,
    pub sample_interval_ms: Option<u64>,
    pub cpu_count: usize,
    pub root_pid: u32,
    pub system_memory: Option<SystemMemorySnapshot>,
    pub totals: ProcessPerfTotals,
}

#[derive(Debug, Default)]
pub struct PerfMonitor {
    inner: Mutex<PerfMonitorInner>,
}

#[derive(Debug, Default)]
struct PerfMonitorInner {
    last_sample: Option<LastSample>,
}

#[derive(Debug)]
struct LastSample {
    instant: Instant,
    cpu_times_by_pid_100ns: HashMap<u32, CpuTimes100ns>,
}

#[derive(Debug, Clone, Copy)]
struct CpuTimes100ns {
    kernel: u64,
    user: u64,
}

impl PerfMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> Result<ProcessPerfSnapshot, String> {
        #[cfg(target_os = "windows")]
        {
            snapshot_windows(&self.inner, true).map(|out| out.snapshot)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err("Process performance snapshot is only supported on Windows.".to_string())
        }
    }

    pub fn snapshot_totals(&self) -> Result<ProcessPerfTotalsSnapshot, String> {
        #[cfg(target_os = "windows")]
        {
            snapshot_windows(&self.inner, false).map(|out| out.totals)
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err("Process performance snapshot is only supported on Windows.".to_string())
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct ProcessEntry {
    pid: u32,
    ppid: u32,
    exe_name: String,
}

#[cfg(target_os = "windows")]
struct SnapshotOut {
    snapshot: ProcessPerfSnapshot,
    totals: ProcessPerfTotalsSnapshot,
}

#[cfg(target_os = "windows")]
fn snapshot_windows(
    inner: &Mutex<PerfMonitorInner>,
    include_processes: bool,
) -> Result<SnapshotOut, String> {
    use std::cmp::Reverse;

    let root_pid = std::process::id();
    let now = Instant::now();
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let cpu_count = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    let mut guard = match inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let (sample_interval, prev_cpu_times_by_pid_100ns) = match guard.last_sample.take() {
        Some(prev) => (
            Some(now.duration_since(prev.instant)),
            prev.cpu_times_by_pid_100ns,
        ),
        None => (None, HashMap::new()),
    };

    let entries = list_process_entries()?;
    let (tree_pids, by_pid) = build_process_tree(&entries, root_pid as u32);

    let interval_secs = sample_interval.map(|d| d.as_secs_f64()).unwrap_or(0.0);
    let cpu_capacity = interval_secs * cpu_count as f64;

    let mut next_cpu_times_by_pid_100ns: HashMap<u32, CpuTimes100ns> = HashMap::new();
    let mut rows: Vec<ProcessPerfRow> = Vec::with_capacity(tree_pids.len());
    let mut totals_builder = TotalsBuilder::default();
    for pid in tree_pids {
        let entry = by_pid.get(&pid).cloned().unwrap_or(ProcessEntry {
            pid,
            ppid: 0,
            exe_name: "unknown".to_string(),
        });

        let kind = classify_process(pid, &entry.exe_name, root_pid as u32);
        let metrics = read_process_metrics(pid);

        if let Some(times) = metrics.cpu_times_100ns {
            next_cpu_times_by_pid_100ns.insert(pid, times);
        }

        let cpu_percent = match (
            metrics.cpu_times_100ns,
            prev_cpu_times_by_pid_100ns.get(&pid),
        ) {
            (Some(current), Some(prev)) if sample_interval.is_some() && cpu_capacity > 0.0 => {
                let current_total = current.kernel.saturating_add(current.user);
                let prev_total = prev.kernel.saturating_add(prev.user);
                if current_total < prev_total {
                    None
                } else {
                    let delta_100ns = (current_total - prev_total) as f64;
                    let delta_secs = delta_100ns * 1e-7;
                    Some(((delta_secs / cpu_capacity) * 100.0).min(100.0).max(0.0))
                }
            }
            _ => None,
        };

        if include_processes {
            rows.push(ProcessPerfRow {
                pid,
                ppid: entry.ppid,
                name: entry.exe_name.clone(),
                kind,
                cpu_percent,
                working_set_bytes: metrics.working_set_bytes,
                private_bytes: metrics.private_bytes,
            });
        }

        totals_builder.add_metrics(
            kind,
            metrics.working_set_bytes,
            metrics.private_bytes,
            cpu_percent,
        );
    }

    if include_processes {
        rows.sort_by_key(|row| {
            let private_bytes = row.private_bytes.unwrap_or(0);
            let working_set_bytes = row.working_set_bytes.unwrap_or(0);
            (
                Reverse(private_bytes),
                Reverse(working_set_bytes),
                row.name.clone(),
                row.pid,
            )
        });
    }

    let totals = totals_builder.finish();

    guard.last_sample = Some(LastSample {
        instant: now,
        cpu_times_by_pid_100ns: next_cpu_times_by_pid_100ns,
    });

    let system_memory = read_system_memory_snapshot();

    let snapshot = ProcessPerfSnapshot {
        timestamp_ms,
        sample_interval_ms: sample_interval.map(|d| d.as_millis() as u64),
        cpu_count,
        root_pid: root_pid as u32,
        system_memory: system_memory.clone(),
        totals: totals.clone(),
        processes: rows,
    };

    let totals_snapshot = ProcessPerfTotalsSnapshot {
        timestamp_ms,
        sample_interval_ms: snapshot.sample_interval_ms,
        cpu_count,
        root_pid: root_pid as u32,
        system_memory,
        totals,
    };

    Ok(SnapshotOut {
        snapshot,
        totals: totals_snapshot,
    })
}

#[cfg(target_os = "windows")]
fn classify_process(pid: u32, exe_name: &str, root_pid: u32) -> ProcessPerfKind {
    if pid == root_pid {
        return ProcessPerfKind::App;
    }
    if exe_name.eq_ignore_ascii_case("msedgewebview2.exe")
        || exe_name.eq_ignore_ascii_case("msedgewebview2")
    {
        return ProcessPerfKind::WebView2;
    }
    ProcessPerfKind::Child
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct TotalsBuilder {
    working_set_bytes: u64,
    private_bytes: u64,
    cpu_percent_sum: f64,
    cpu_percent_count: u32,
    app_working_set_bytes: u64,
    app_private_bytes: u64,
    app_cpu_percent_sum: f64,
    app_cpu_percent_count: u32,
    webview2_working_set_bytes: u64,
    webview2_private_bytes: u64,
    webview2_cpu_percent_sum: f64,
    webview2_cpu_percent_count: u32,
    other_working_set_bytes: u64,
    other_private_bytes: u64,
    other_cpu_percent_sum: f64,
    other_cpu_percent_count: u32,
}

#[cfg(target_os = "windows")]
impl TotalsBuilder {
    fn add_metrics(
        &mut self,
        kind: ProcessPerfKind,
        working_set_bytes: Option<u64>,
        private_bytes: Option<u64>,
        cpu_percent: Option<f64>,
    ) {
        if let Some(ws) = working_set_bytes {
            self.working_set_bytes = self.working_set_bytes.saturating_add(ws);
            match kind {
                ProcessPerfKind::App => {
                    self.app_working_set_bytes = self.app_working_set_bytes.saturating_add(ws);
                }
                ProcessPerfKind::WebView2 => {
                    self.webview2_working_set_bytes =
                        self.webview2_working_set_bytes.saturating_add(ws);
                }
                ProcessPerfKind::Child => {
                    self.other_working_set_bytes = self.other_working_set_bytes.saturating_add(ws);
                }
            }
        }

        if let Some(private) = private_bytes {
            self.private_bytes = self.private_bytes.saturating_add(private);
            match kind {
                ProcessPerfKind::App => {
                    self.app_private_bytes = self.app_private_bytes.saturating_add(private);
                }
                ProcessPerfKind::WebView2 => {
                    self.webview2_private_bytes =
                        self.webview2_private_bytes.saturating_add(private);
                }
                ProcessPerfKind::Child => {
                    self.other_private_bytes = self.other_private_bytes.saturating_add(private);
                }
            }
        }

        if let Some(cpu) = cpu_percent {
            self.cpu_percent_sum += cpu;
            self.cpu_percent_count += 1;
            match kind {
                ProcessPerfKind::App => {
                    self.app_cpu_percent_sum += cpu;
                    self.app_cpu_percent_count += 1;
                }
                ProcessPerfKind::WebView2 => {
                    self.webview2_cpu_percent_sum += cpu;
                    self.webview2_cpu_percent_count += 1;
                }
                ProcessPerfKind::Child => {
                    self.other_cpu_percent_sum += cpu;
                    self.other_cpu_percent_count += 1;
                }
            }
        }
    }

    fn finish(self) -> ProcessPerfTotals {
        ProcessPerfTotals {
            working_set_bytes: self.working_set_bytes,
            private_bytes: self.private_bytes,
            cpu_percent: (self.cpu_percent_count > 0).then_some(self.cpu_percent_sum),
            app_working_set_bytes: self.app_working_set_bytes,
            app_private_bytes: self.app_private_bytes,
            app_cpu_percent: (self.app_cpu_percent_count > 0).then_some(self.app_cpu_percent_sum),
            webview2_working_set_bytes: self.webview2_working_set_bytes,
            webview2_private_bytes: self.webview2_private_bytes,
            webview2_cpu_percent: (self.webview2_cpu_percent_count > 0)
                .then_some(self.webview2_cpu_percent_sum),
            other_working_set_bytes: self.other_working_set_bytes,
            other_private_bytes: self.other_private_bytes,
            other_cpu_percent: (self.other_cpu_percent_count > 0)
                .then_some(self.other_cpu_percent_sum),
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct ProcessMetrics {
    cpu_times_100ns: Option<CpuTimes100ns>,
    working_set_bytes: Option<u64>,
    private_bytes: Option<u64>,
}

#[cfg(target_os = "windows")]
fn read_process_metrics(pid: u32) -> ProcessMetrics {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };

    struct WinHandle(HANDLE);
    impl Drop for WinHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
        if handle.is_null() {
            return ProcessMetrics::default();
        }
        let handle = WinHandle(handle);

        let mut metrics = ProcessMetrics::default();

        let mut mem: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        mem.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        let mem_ok = GetProcessMemoryInfo(
            handle.0,
            &mut mem as *mut _ as *mut PROCESS_MEMORY_COUNTERS,
            mem.cb,
        );
        if mem_ok != 0 {
            metrics.working_set_bytes = Some(mem.WorkingSetSize as u64);
            metrics.private_bytes = Some(mem.PrivateUsage as u64);
        }

        let mut creation: FILETIME = std::mem::zeroed();
        let mut exit: FILETIME = std::mem::zeroed();
        let mut kernel: FILETIME = std::mem::zeroed();
        let mut user: FILETIME = std::mem::zeroed();
        let times_ok = GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user);
        if times_ok != 0 {
            metrics.cpu_times_100ns = Some(CpuTimes100ns {
                kernel: filetime_to_100ns(kernel),
                user: filetime_to_100ns(user),
            });
        }

        metrics
    }
}

#[cfg(target_os = "windows")]
fn filetime_to_100ns(filetime: windows_sys::Win32::Foundation::FILETIME) -> u64 {
    ((filetime.dwHighDateTime as u64) << 32) | (filetime.dwLowDateTime as u64)
}

#[cfg(target_os = "windows")]
fn read_system_memory_snapshot() -> Option<SystemMemorySnapshot> {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return None;
        }
        Some(SystemMemorySnapshot {
            memory_load_percent: status.dwMemoryLoad,
            total_physical_bytes: status.ullTotalPhys,
            available_physical_bytes: status.ullAvailPhys,
            total_page_file_bytes: status.ullTotalPageFile,
            available_page_file_bytes: status.ullAvailPageFile,
        })
    }
}

#[cfg(target_os = "windows")]
fn list_process_entries() -> Result<Vec<ProcessEntry>, String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("CreateToolhelp32Snapshot failed".to_string());
        }

        let mut entries = Vec::new();

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) == 0 {
            let _ = CloseHandle(snapshot);
            return Err("Process32FirstW failed".to_string());
        }

        loop {
            let exe_name = wide_cstr_to_string(&entry.szExeFile);
            entries.push(ProcessEntry {
                pid: entry.th32ProcessID,
                ppid: entry.th32ParentProcessID,
                exe_name,
            });

            if Process32NextW(snapshot, &mut entry) == 0 {
                break;
            }
        }

        let _ = CloseHandle(snapshot);
        Ok(entries)
    }
}

#[cfg(target_os = "windows")]
fn wide_cstr_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

#[cfg(target_os = "windows")]
fn build_process_tree(
    entries: &[ProcessEntry],
    root_pid: u32,
) -> (Vec<u32>, HashMap<u32, ProcessEntry>) {
    use std::collections::HashSet;

    let mut by_pid: HashMap<u32, ProcessEntry> = HashMap::with_capacity(entries.len());
    let mut children_by_ppid: HashMap<u32, Vec<u32>> = HashMap::new();
    for entry in entries {
        by_pid.insert(entry.pid, entry.clone());
        children_by_ppid
            .entry(entry.ppid)
            .or_default()
            .push(entry.pid);
    }

    let mut tree: Vec<u32> = Vec::new();
    let mut stack: Vec<u32> = vec![root_pid];
    let mut visited: HashSet<u32> = HashSet::new();
    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        tree.push(pid);
        if let Some(children) = children_by_ppid.get(&pid) {
            for &child in children {
                stack.push(child);
            }
        }
    }
    (tree, by_pid)
}
