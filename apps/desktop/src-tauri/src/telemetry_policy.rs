use crate::telemetry_contract::{TelemetryLevel, TelemetryPolicy, TelemetryRecord, TelemetrySide};

pub fn should_accept_record(policy: &TelemetryPolicy, record: &TelemetryRecord) -> bool {
    if !policy.enabled {
        return false;
    }

    let min_level = match record.side {
        TelemetrySide::Frontend => policy.frontend_min_level,
        TelemetrySide::Backend => policy.backend_min_level,
    };

    compare_levels(record.level, min_level) >= 0
        && compare_levels(record.level, policy.persist_min_level) >= 0
}

pub fn compare_levels(left: TelemetryLevel, right: TelemetryLevel) -> i8 {
    level_rank(left) - level_rank(right)
}

fn level_rank(level: TelemetryLevel) -> i8 {
    match level {
        TelemetryLevel::Trace => 10,
        TelemetryLevel::Debug => 20,
        TelemetryLevel::Info => 30,
        TelemetryLevel::Warn => 40,
        TelemetryLevel::Error => 50,
        TelemetryLevel::Fatal => 60,
    }
}

#[cfg(test)]
mod tests {
    use super::{compare_levels, should_accept_record};
    use crate::telemetry_contract::{
        TelemetryKind, TelemetryLevel, TelemetryPolicy, TelemetryRecord, TelemetrySide,
    };

    fn record(level: TelemetryLevel, side: TelemetrySide) -> TelemetryRecord {
        TelemetryRecord {
            ts: 1,
            level,
            kind: TelemetryKind::Log,
            side,
            module_id: "test".to_string(),
            event: "event".to_string(),
            session_id: "session".to_string(),
            component: None,
            message: None,
            trace_id: None,
            span_id: None,
            window_id: None,
            fields: None,
        }
    }

    #[test]
    fn compare_levels_orders_values() {
        assert!(compare_levels(TelemetryLevel::Warn, TelemetryLevel::Info) > 0);
        assert!(compare_levels(TelemetryLevel::Debug, TelemetryLevel::Error) < 0);
        assert_eq!(
            compare_levels(TelemetryLevel::Info, TelemetryLevel::Info),
            0
        );
    }

    #[test]
    fn should_accept_record_requires_both_source_and_persist_levels() {
        let mut policy = TelemetryPolicy::default();
        policy.frontend_min_level = TelemetryLevel::Debug;
        policy.persist_min_level = TelemetryLevel::Warn;

        assert!(!should_accept_record(
            &policy,
            &record(TelemetryLevel::Info, TelemetrySide::Frontend)
        ));
        assert!(!should_accept_record(
            &policy,
            &record(TelemetryLevel::Debug, TelemetrySide::Frontend)
        ));
        assert!(should_accept_record(
            &policy,
            &record(TelemetryLevel::Warn, TelemetrySide::Frontend)
        ));
    }
}
