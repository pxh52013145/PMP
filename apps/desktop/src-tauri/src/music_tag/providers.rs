use tauri::AppHandle;

use super::{
    resolve_lyrics_candidate, search_acoustid_candidates, search_musicbrainz_candidates,
    search_netease_candidates, MusicTagCandidate, MusicTagCandidateSearchRequest,
    MusicTagCanonicalMetadata, MusicTagLyricsResolutionSummary, MusicTagMetadataProviderDescriptor,
};

pub(super) struct ProviderSearchContext<'a> {
    pub app: &'a AppHandle,
    pub request: &'a MusicTagCandidateSearchRequest,
    pub metadata: &'a MusicTagCanonicalMetadata,
    pub limit: usize,
    pub fetched_at_ms: i64,
}

pub(super) struct ProviderSearchOutput {
    pub candidates: Vec<MusicTagCandidate>,
    pub lyrics_resolution: Option<MusicTagLyricsResolutionSummary>,
}

impl ProviderSearchOutput {
    fn candidates(candidates: Vec<MusicTagCandidate>) -> Self {
        Self {
            candidates,
            lyrics_resolution: None,
        }
    }
}

pub(super) trait MusicTagMetadataProvider: Send + Sync {
    fn descriptor(&self) -> MusicTagMetadataProviderDescriptor;
    fn search(&self, context: &ProviderSearchContext<'_>) -> Result<ProviderSearchOutput, String>;
}

struct MusicBrainzProvider;
struct AcoustIdProvider;
struct LyricsProvider;
struct NeteaseCloudProvider;

impl MusicTagMetadataProvider for MusicBrainzProvider {
    fn descriptor(&self) -> MusicTagMetadataProviderDescriptor {
        descriptor(
            "musicbrainz",
            "MusicBrainz",
            "Open music metadata catalog",
            &["metadata"],
            false,
            100,
        )
    }

    fn search(&self, context: &ProviderSearchContext<'_>) -> Result<ProviderSearchOutput, String> {
        search_musicbrainz_candidates(
            context.request,
            context.metadata,
            context.limit,
            context.fetched_at_ms,
        )
        .map(ProviderSearchOutput::candidates)
    }
}

impl MusicTagMetadataProvider for NeteaseCloudProvider {
    fn descriptor(&self) -> MusicTagMetadataProviderDescriptor {
        descriptor(
            "netease-cloud",
            "NetEase Cloud Music",
            "Built-in Cloud Music metadata source",
            &["metadata", "cover-art"],
            false,
            90,
        )
    }

    fn search(&self, context: &ProviderSearchContext<'_>) -> Result<ProviderSearchOutput, String> {
        search_netease_candidates(
            context.request,
            context.metadata,
            context.limit,
            context.fetched_at_ms,
        )
        .map(ProviderSearchOutput::candidates)
    }
}

impl MusicTagMetadataProvider for AcoustIdProvider {
    fn descriptor(&self) -> MusicTagMetadataProviderDescriptor {
        let mut value = descriptor(
            "acoustid",
            "AcoustID",
            "Chromaprint fingerprint lookup",
            &["metadata", "fingerprint"],
            true,
            80,
        );
        value.requires_api_key = true;
        value
    }

    fn search(&self, context: &ProviderSearchContext<'_>) -> Result<ProviderSearchOutput, String> {
        search_acoustid_candidates(
            context.request,
            context.metadata,
            context.limit,
            context.fetched_at_ms,
        )
        .map(ProviderSearchOutput::candidates)
    }
}

impl MusicTagMetadataProvider for LyricsProvider {
    fn descriptor(&self) -> MusicTagMetadataProviderDescriptor {
        descriptor(
            "lyrics",
            "Lyrics Resolver",
            "Local, sidecar and network lyrics resolution pipeline",
            &["lyrics"],
            false,
            70,
        )
    }

    fn search(&self, context: &ProviderSearchContext<'_>) -> Result<ProviderSearchOutput, String> {
        let (lyrics_resolution, candidate) = resolve_lyrics_candidate(
            context.app,
            context.request,
            context.metadata,
            context.fetched_at_ms,
        )?;
        Ok(ProviderSearchOutput {
            candidates: candidate.into_iter().collect(),
            lyrics_resolution,
        })
    }
}

fn descriptor(
    id: &str,
    display_name: &str,
    description: &str,
    capabilities: &[&str],
    requires_api_key: bool,
    priority: i32,
) -> MusicTagMetadataProviderDescriptor {
    MusicTagMetadataProviderDescriptor {
        id: id.to_string(),
        display_name: display_name.to_string(),
        description: description.to_string(),
        capabilities: capabilities.iter().map(|value| value.to_string()).collect(),
        builtin: true,
        requires_network: true,
        requires_api_key,
        enabled: true,
        priority,
    }
}

pub(super) fn builtin_providers() -> Vec<Box<dyn MusicTagMetadataProvider>> {
    let mut providers: Vec<Box<dyn MusicTagMetadataProvider>> = vec![
        Box::new(MusicBrainzProvider),
        Box::new(NeteaseCloudProvider),
        Box::new(AcoustIdProvider),
        Box::new(LyricsProvider),
    ];
    providers.sort_by_key(|provider| -provider.descriptor().priority);
    providers
}

pub(super) fn provider_descriptors() -> Vec<MusicTagMetadataProviderDescriptor> {
    builtin_providers()
        .into_iter()
        .map(|provider| provider.descriptor())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::provider_descriptors;

    #[test]
    fn builtin_provider_ids_are_unique_and_stable() {
        let descriptors = provider_descriptors();
        let ids = descriptors
            .iter()
            .map(|descriptor| descriptor.id.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(ids.len(), descriptors.len());
        assert!(ids.contains("musicbrainz"));
        assert!(ids.contains("netease-cloud"));
        assert!(ids.contains("acoustid"));
        assert!(ids.contains("lyrics"));
    }
}
