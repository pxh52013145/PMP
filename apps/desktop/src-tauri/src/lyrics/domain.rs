use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyricSourceKind {
    Embedded,
    Sidecar,
    Cache,
    Web,
}

impl LyricSourceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Embedded => "embedded",
            Self::Sidecar => "sidecar",
            Self::Cache => "cache",
            Self::Web => "web",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricToken {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub text: String,
    pub translation: Option<String>,
    pub tokens: Vec<LyricToken>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PMPLyricDocument {
    pub id: String,
    pub entry_id: Option<String>,
    pub track_id: Option<String>,
    pub quick_fingerprint: Option<String>,
    pub source_kind: LyricSourceKind,
    pub source_locator: Option<String>,
    pub format: String,
    pub language: Option<String>,
    pub is_dynamic: bool,
    pub has_word_timing: bool,
    pub confidence: f32,
    pub lines: Vec<LyricLine>,
    pub raw_text: Option<String>,
    pub updated_at_ms: i64,
}
