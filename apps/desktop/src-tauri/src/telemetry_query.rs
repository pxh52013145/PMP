pub const DEFAULT_RECENT_LIMIT: usize = 160;
pub const MAX_RECENT_LIMIT: usize = 500;

pub fn normalize_recent_limit(limit: Option<u32>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_RECENT_LIMIT)
        .clamp(1, MAX_RECENT_LIMIT)
}
