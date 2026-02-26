pub mod lrc;

use crate::lyrics::domain::{LyricLine, LyricToken};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLyric {
    pub lines: Vec<LyricLine>,
    pub is_dynamic: bool,
    pub has_word_timing: bool,
}

impl ParsedLyric {
    pub fn new(lines: Vec<LyricLine>, is_dynamic: bool, has_word_timing: bool) -> Self {
        Self {
            lines,
            is_dynamic,
            has_word_timing,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

pub fn parse_plain_text(input: &str) -> ParsedLyric {
    let mut lines = Vec::new();
    let mut time_cursor = 0_u64;

    for line in input.lines().map(str::trim).filter(|line| !line.is_empty()) {
        lines.push(LyricLine {
            start_ms: time_cursor,
            end_ms: Some(time_cursor.saturating_add(3000)),
            text: line.to_string(),
            translation: None,
            tokens: Vec::<LyricToken>::new(),
        });
        time_cursor = time_cursor.saturating_add(3000);
    }

    if lines.is_empty() {
        let normalized = input.trim();
        if !normalized.is_empty() {
            lines.push(LyricLine {
                start_ms: 0,
                end_ms: None,
                text: normalized.to_string(),
                translation: None,
                tokens: Vec::new(),
            });
        }
    }

    ParsedLyric::new(lines, false, false)
}
