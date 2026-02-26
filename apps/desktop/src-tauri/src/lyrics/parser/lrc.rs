use crate::lyrics::domain::{LyricLine, LyricToken};
use crate::lyrics::parser::ParsedLyric;

pub fn parse_lrc(input: &str) -> ParsedLyric {
    let mut lines = Vec::new();
    let mut has_word_timing = false;

    for raw_line in input.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let (timestamps, text) = extract_lrc_timestamps(line);
        if timestamps.is_empty() {
            continue;
        }

        let text = text.trim();
        let (plain_text, mut tokens) = extract_inline_tokens(text);
        if !tokens.is_empty() {
            has_word_timing = true;
        }

        if tokens.len() > 1 {
            for index in 0..tokens.len() - 1 {
                let next_start = tokens[index + 1].start_ms;
                tokens[index].end_ms = next_start.max(tokens[index].start_ms);
            }
        }
        if let Some(last) = tokens.last_mut() {
            if last.end_ms <= last.start_ms {
                last.end_ms = last.start_ms.saturating_add(400);
            }
        }

        let line_text = if plain_text.is_empty() {
            text.to_string()
        } else {
            plain_text
        };

        for start_ms in timestamps {
            lines.push(LyricLine {
                start_ms,
                end_ms: None,
                text: line_text.clone(),
                translation: None,
                tokens: tokens.clone(),
            });
        }
    }

    lines.sort_by_key(|line| line.start_ms);
    if lines.len() > 1 {
        for index in 0..lines.len() - 1 {
            let next_start = lines[index + 1].start_ms;
            if next_start >= lines[index].start_ms {
                lines[index].end_ms = Some(next_start);
            }
        }
    }

    ParsedLyric::new(lines.clone(), !lines.is_empty(), has_word_timing)
}

fn extract_lrc_timestamps(line: &str) -> (Vec<u64>, &str) {
    let mut timestamps = Vec::new();
    let mut offset = 0usize;

    while line[offset..].starts_with('[') {
        let Some(end_rel) = line[offset + 1..].find(']') else {
            break;
        };
        let end = offset + 1 + end_rel;
        let marker = line[offset + 1..end].trim();
        if let Some(ms) = parse_timestamp(marker) {
            timestamps.push(ms);
        }
        offset = end + 1;
        if offset >= line.len() {
            break;
        }
    }

    (timestamps, &line[offset..])
}

fn extract_inline_tokens(text: &str) -> (String, Vec<LyricToken>) {
    let mut plain = String::new();
    let mut tokens = Vec::new();
    let mut cursor = 0usize;

    while cursor < text.len() {
        let Some(open_rel) = text[cursor..].find('<') else {
            plain.push_str(&text[cursor..]);
            break;
        };
        let open = cursor + open_rel;
        plain.push_str(&text[cursor..open]);

        let Some(close_rel) = text[open + 1..].find('>') else {
            plain.push_str(&text[open..]);
            break;
        };
        let close = open + 1 + close_rel;
        let marker = text[open + 1..close].trim();

        let Some(start_ms) = parse_timestamp(marker) else {
            plain.push_str(&text[open..=close]);
            cursor = close + 1;
            continue;
        };

        let token_start = close + 1;
        let token_end = text[token_start..]
            .find('<')
            .map(|next| token_start + next)
            .unwrap_or(text.len());
        let token_text = text[token_start..token_end].to_string();
        plain.push_str(&token_text);

        let normalized = token_text.trim();
        if !normalized.is_empty() {
            tokens.push(LyricToken {
                start_ms,
                end_ms: start_ms,
                text: normalized.to_string(),
            });
        }

        cursor = token_end;
    }

    (plain.trim().to_string(), tokens)
}

fn parse_timestamp(marker: &str) -> Option<u64> {
    let marker = marker.trim();
    let (minute_raw, sec_raw) = marker.split_once(':')?;
    let minute = minute_raw.parse::<u64>().ok()?;

    let (sec_digits, frac_digits) = if let Some((sec, frac)) = sec_raw.split_once('.') {
        (sec, Some(frac))
    } else if let Some((sec, frac)) = sec_raw.split_once(',') {
        (sec, Some(frac))
    } else {
        (sec_raw, None)
    };

    let second = sec_digits.parse::<u64>().ok()?;
    let fraction_ms = match frac_digits {
        None => 0,
        Some(fraction) => {
            let normalized: String = fraction
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .take(3)
                .collect();
            if normalized.is_empty() {
                return None;
            }
            let scale = match normalized.len() {
                1 => 100,
                2 => 10,
                _ => 1,
            };
            normalized.parse::<u64>().ok()?.saturating_mul(scale)
        }
    };

    Some(
        minute
            .saturating_mul(60_000)
            .saturating_add(second.saturating_mul(1000))
            .saturating_add(fraction_ms),
    )
}

#[cfg(test)]
mod tests {
    use super::parse_lrc;

    #[test]
    fn parse_multiple_timestamps() {
        let parsed = parse_lrc("[00:10.00][00:20.00]hello");
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].start_ms, 10_000);
        assert_eq!(parsed.lines[1].start_ms, 20_000);
        assert_eq!(parsed.lines[0].text, "hello");
    }

    #[test]
    fn parse_inline_word_timing_tokens() {
        let parsed = parse_lrc("[00:01.00]<00:01.10>Hello <00:01.60>World");
        assert_eq!(parsed.lines.len(), 1);
        assert!(parsed.has_word_timing);
        assert_eq!(parsed.lines[0].tokens.len(), 2);
        assert_eq!(parsed.lines[0].tokens[0].text, "Hello");
        assert_eq!(parsed.lines[0].tokens[0].start_ms, 1_100);
        assert_eq!(parsed.lines[0].tokens[1].text, "World");
        assert_eq!(parsed.lines[0].text, "Hello World");
    }

    #[test]
    fn ignore_invalid_lines_without_timestamp() {
        let parsed = parse_lrc("[ar:Artist]\nno timestamp\n[00:05.00]line");
        assert_eq!(parsed.lines.len(), 1);
        assert_eq!(parsed.lines[0].start_ms, 5_000);
        assert_eq!(parsed.lines[0].text, "line");
    }
}
