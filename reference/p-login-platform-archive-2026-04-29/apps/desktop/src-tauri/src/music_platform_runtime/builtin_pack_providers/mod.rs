pub mod bilibili;
pub mod netease;

use crate::music_platform_runtime::MusicPlatformRuntimeHost as AppHandle;
use serde::Serialize;
use serde_json::Value;

pub(crate) type BuiltinPackProviderInitFn = fn(&AppHandle) -> Result<(), String>;
pub(crate) type BuiltinPackProviderCleanupFn = fn(&AppHandle) -> Result<(), String>;
pub(crate) type BuiltinPackProviderAuthDispatchFn =
    fn(&AppHandle, &str, Option<&str>, &Option<Value>) -> Result<Value, String>;
pub(crate) type BuiltinPackProviderApiDispatchFn =
    fn(&AppHandle, &str, &str, Option<&str>, &Option<Value>) -> Result<Value, String>;

pub(crate) struct BuiltinPackProviderDescriptor {
    pub connector_id: &'static str,
    pub display_name: &'static str,
    pub init: BuiltinPackProviderInitFn,
    pub cleanup: Option<BuiltinPackProviderCleanupFn>,
    pub dispatch_auth: BuiltinPackProviderAuthDispatchFn,
    pub dispatch_api: BuiltinPackProviderApiDispatchFn,
}

pub(crate) const PLATFORM_LIBRARY_BINDING_ID: &str = "host.pmp.platform-instance.library";
pub(crate) const PLATFORM_RECOMMENDATIONS_BINDING_ID: &str =
    "host.pmp.platform-instance.recommendations";
pub(crate) const PLATFORM_SEARCH_BINDING_ID: &str = "host.pmp.platform-instance.search";
pub(crate) const PLATFORM_QUALITY_BINDING_ID: &str = "host.pmp.platform-instance.quality";
pub(crate) const PLATFORM_PAGES_BINDING_ID: &str = "host.pmp.platform-instance.pages";

const BUILTIN_PACK_PROVIDER_DESCRIPTORS: &[BuiltinPackProviderDescriptor] = &[
    BuiltinPackProviderDescriptor {
        connector_id: bilibili::CONNECTOR_ID,
        display_name: bilibili::DISPLAY_NAME,
        init: bilibili::init,
        cleanup: Some(bilibili::cleanup),
        dispatch_auth: bilibili::dispatch_auth,
        dispatch_api: bilibili::dispatch_api,
    },
    BuiltinPackProviderDescriptor {
        connector_id: netease::CONNECTOR_ID,
        display_name: netease::DISPLAY_NAME,
        init: netease::init,
        cleanup: None,
        dispatch_auth: netease::dispatch_auth,
        dispatch_api: netease::dispatch_api,
    },
];

pub(crate) fn list_builtin_pack_provider_descriptors() -> &'static [BuiltinPackProviderDescriptor] {
    BUILTIN_PACK_PROVIDER_DESCRIPTORS
}

pub(crate) fn resolve_builtin_pack_provider_descriptor(
    connector_id: &str,
) -> Option<&'static BuiltinPackProviderDescriptor> {
    BUILTIN_PACK_PROVIDER_DESCRIPTORS
        .iter()
        .find(|descriptor| descriptor.connector_id == connector_id)
}

pub(crate) fn serialize_response<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value)
        .map_err(|error| format!("Failed to serialize music platform runtime response: {error}"))
}

fn payload_field<'a>(payload: &'a Option<Value>, key: &str) -> Option<&'a Value> {
    payload.as_ref()?.get(key)
}

fn payload_string_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(raw)) => normalize_non_empty_string(Some(raw.as_str())),
        Some(Value::Number(raw)) => Some(raw.to_string()),
        _ => None,
    }
}

fn normalize_non_empty_string(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn first_payload_string(payload: &Option<Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| payload_string_value(payload_field(payload, key)))
}

pub(crate) fn required_payload_string(
    payload: &Option<Value>,
    keys: &[&str],
    field_name: &str,
) -> Result<String, String> {
    first_payload_string(payload, keys).ok_or_else(|| format!("{field_name} is required"))
}

pub(crate) fn optional_payload_u32(payload: &Option<Value>, key: &str) -> Option<u32> {
    match payload_field(payload, key) {
        Some(Value::Number(raw)) => raw
            .as_u64()
            .or_else(|| raw.as_i64().and_then(|value| u64::try_from(value).ok()))
            .and_then(|value| u32::try_from(value).ok()),
        Some(Value::String(raw)) => raw.trim().parse::<u32>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{first_payload_string, optional_payload_u32};
    use serde_json::json;

    #[test]
    fn reads_first_string_payload_from_aliases() {
        let payload = Some(json!({
            "query": "demo",
            "keyword": "unused"
        }));

        assert_eq!(
            first_payload_string(&payload, &["keyword", "query"]).as_deref(),
            Some("unused")
        );
        assert_eq!(
            first_payload_string(&payload, &["query", "keyword"]).as_deref(),
            Some("demo")
        );
    }

    #[test]
    fn parses_u32_payload_from_number_or_string() {
        let numeric = Some(json!({ "pageNum": 12 }));
        let text = Some(json!({ "pageNum": "24" }));

        assert_eq!(optional_payload_u32(&numeric, "pageNum"), Some(12));
        assert_eq!(optional_payload_u32(&text, "pageNum"), Some(24));
    }
}
