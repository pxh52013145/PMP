use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TelemetryLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl Default for TelemetryLevel {
    fn default() -> Self {
        Self::Info
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TelemetryKind {
    Log,
    Metric,
    SpanStart,
    SpanEnd,
    Snapshot,
    Audit,
}

impl Default for TelemetryKind {
    fn default() -> Self {
        Self::Log
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TelemetrySide {
    Frontend,
    Backend,
}

impl Default for TelemetrySide {
    fn default() -> Self {
        Self::Frontend
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryModulePolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<TelemetryLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persist: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub perf: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub realtime_verbose: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRetentionPolicy {
    #[serde(default = "default_telemetry_max_total_bytes")]
    pub max_total_bytes: u64,
    #[serde(default = "default_telemetry_error_days")]
    pub error_days: u32,
    #[serde(default = "default_telemetry_info_days")]
    pub info_days: u32,
    #[serde(default = "default_telemetry_debug_current_session_only")]
    pub debug_current_session_only: bool,
}

impl Default for TelemetryRetentionPolicy {
    fn default() -> Self {
        Self {
            max_total_bytes: default_telemetry_max_total_bytes(),
            error_days: default_telemetry_error_days(),
            info_days: default_telemetry_info_days(),
            debug_current_session_only: default_telemetry_debug_current_session_only(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryPolicy {
    #[serde(default = "default_telemetry_enabled")]
    pub enabled: bool,
    #[serde(default = "default_telemetry_ui_tail_enabled")]
    pub ui_tail_enabled: bool,
    #[serde(default)]
    pub frontend_min_level: TelemetryLevel,
    #[serde(default)]
    pub backend_min_level: TelemetryLevel,
    #[serde(default = "default_telemetry_persist_min_level")]
    pub persist_min_level: TelemetryLevel,
    #[serde(default = "default_telemetry_batch_flush_ms")]
    pub batch_flush_ms: u32,
    #[serde(default = "default_telemetry_batch_max_items")]
    pub batch_max_items: u32,
    #[serde(default = "default_telemetry_perf_sampling_ms")]
    pub perf_sampling_ms: u32,
    #[serde(default)]
    pub retention: TelemetryRetentionPolicy,
    #[serde(default)]
    pub modules: BTreeMap<String, TelemetryModulePolicy>,
}

impl Default for TelemetryPolicy {
    fn default() -> Self {
        Self {
            enabled: default_telemetry_enabled(),
            ui_tail_enabled: default_telemetry_ui_tail_enabled(),
            frontend_min_level: TelemetryLevel::Info,
            backend_min_level: TelemetryLevel::Info,
            persist_min_level: default_telemetry_persist_min_level(),
            batch_flush_ms: default_telemetry_batch_flush_ms(),
            batch_max_items: default_telemetry_batch_max_items(),
            perf_sampling_ms: default_telemetry_perf_sampling_ms(),
            retention: TelemetryRetentionPolicy::default(),
            modules: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryRecord {
    pub ts: u64,
    pub level: TelemetryLevel,
    pub kind: TelemetryKind,
    pub side: TelemetrySide,
    pub module_id: String,
    pub event: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<BTreeMap<String, serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStatus {
    pub enabled: bool,
    pub current_session_id: String,
    pub queued_records: u64,
    pub flushed_records: u64,
    pub dropped_records: u64,
    pub current_file_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_file_path: Option<String>,
    pub frontend_min_level: TelemetryLevel,
    pub backend_min_level: TelemetryLevel,
    pub persist_min_level: TelemetryLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryIngestBatchResult {
    pub accepted_count: u64,
    pub dropped_count: u64,
    pub status: TelemetryStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryClearSessionResult {
    pub previous_session_id: String,
    pub status: TelemetryStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReadSessionResult {
    pub status: TelemetryStatus,
    pub record_count: u64,
    pub records: Vec<TelemetryRecord>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryQueryInput {
    #[serde(default)]
    pub module_ids: Vec<String>,
    #[serde(default)]
    pub levels: Vec<TelemetryLevel>,
    #[serde(default)]
    pub kinds: Vec<TelemetryKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_ts: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_ts: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCountBucket {
    pub key: String,
    pub count: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryQueryResult {
    pub status: TelemetryStatus,
    pub scanned_record_count: u64,
    pub matched_record_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_matched_ts: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_matched_ts: Option<u64>,
    pub records: Vec<TelemetryRecord>,
    pub module_counts: Vec<TelemetryCountBucket>,
    pub level_counts: Vec<TelemetryCountBucket>,
    pub event_counts: Vec<TelemetryCountBucket>,
}

pub fn default_telemetry_enabled() -> bool {
    true
}

pub fn default_telemetry_ui_tail_enabled() -> bool {
    true
}

pub fn default_telemetry_persist_min_level() -> TelemetryLevel {
    TelemetryLevel::Warn
}

pub fn default_telemetry_batch_flush_ms() -> u32 {
    250
}

pub fn default_telemetry_batch_max_items() -> u32 {
    64
}

pub fn default_telemetry_perf_sampling_ms() -> u32 {
    1_000
}

pub fn default_telemetry_max_total_bytes() -> u64 {
    150 * 1024 * 1024
}

pub fn default_telemetry_error_days() -> u32 {
    14
}

pub fn default_telemetry_info_days() -> u32 {
    3
}

pub fn default_telemetry_debug_current_session_only() -> bool {
    true
}
