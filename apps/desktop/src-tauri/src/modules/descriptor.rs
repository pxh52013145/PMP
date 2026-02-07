use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendModuleDescriptor {
    pub id: &'static str,
    pub version: &'static str,
    pub display_name: &'static str,
    pub depends_on: &'static [&'static str],
    pub command_domains: &'static [&'static str],
}
