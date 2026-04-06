# Cloud Music Library - Design Draft

## Vision

Build a remote music library system that behaves like a NAS-style personal cloud library, while fitting into the player's existing local-library-first model.

## Goals

- Support a cloud-hosted or self-hosted remote music library as a first-class source.
- Let users browse, search, manage, and play remote library content through a consistent model.
- Support metadata sync, caching, and playback preparation for remote assets.

## Scope (Initial)

- Remote library data model and identity model.
- Metadata sync, index refresh, and cache lifecycle.
- File-backed vs metadata-only library strategy.
- Remote playback preparation, download/cache, and fallback behavior.
- NAS / self-hosted compatibility direction.

## Non-Goals (Initial)

- Full generic SaaS cloud platform work.
- Large-scale social or collaboration features.

## Architecture Topics To Decide

- Authoritative model: remote metadata mirror vs remote file-aware library.
- Deployment model: self-hosted first, managed hosted first, or both.
- Local/remote identity model: shared track identity vs source-scoped identity with mapping.
- Sync model: eager sync, lazy fetch, background indexer, or hybrid.

## Milestone Slices

### Phase 0 - Domain Clarification

- Define what the current local library owns and what the remote library should own.
- Define the minimum viable NAS-style user flow.

### Phase 1 - Cloud Library MVP

- Implement one remote library read/browse/search/playback path.
- Define cache, metadata refresh, and remote availability semantics.

### Phase 2 - Unified Library Experience

- Merge local and remote views with clear source semantics.
- Add background sync, cache policy controls, and remote library management capabilities.

## Open Questions

- Is the remote library primarily metadata-based, file-backed, or both?
- Should NAS / self-hosted scenarios be first-class from day one?
- How should remote library identity interact with local scan identity and deduplication?
- What should be cached locally, and what should remain remote-only?
