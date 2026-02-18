# MUSIC_LIBRARY Baseline (PMP Local-First -> Hydra-Ready)

Updated: 2026-02-17

Scope:
- `apps/desktop/src/services/audio/MusicLibraryService.ts`
- `apps/desktop/src/components/pages/MusicLibrary.tsx`
- `apps/desktop/src/components/pages/MusicLibrary.css`
- `apps/desktop/src-tauri/src/music_library.rs`
- `apps/desktop/src/i18n/locales/zh-CN.json`
- `apps/desktop/src/i18n/locales/en-US.json`

---

## 1) Product intent and architecture boundary

This baseline follows your target direction:

1. **PMP now is local-first** (single-user desktop player, high performance).
2. **Hydra is the next layer** (networked/user-centric logical library, not tied to physical folder structure).
3. **Scan layer and display layer must be decoupled**:
   - Scan: ingest physical files from sources.
   - Display: controlled by source visibility + logical view rules.
4. **Identity split**:
   - Local identity: fast, metadata-resilient fingerprint (`quickFingerprint`, qf2).
   - Cloud identity: expensive full-content hash, generated lazily only when needed.

---

## 2) Decisions confirmed in this round

### A. No migration burden now

You explicitly confirmed no legacy migration is needed for now.

Therefore:
- No IndexedDB -> SQLite migration script in current phase.
- Rebuild/rescan is acceptable.

### B. Memory and UX first, protocol after

Before heavy backend migration, prioritize:
- list pressure reduction,
- source toggles,
- query/path filtering correctness,
- cover/image memory governance.

### C. Add explicit playback-time semantics

Future logical table should include explicit `last_played_at` (not only generic `updated_at`).

---

## 3) Evidence from current code (not theory)

### 3.1 Fingerprint pipeline (already aligned with your requirement)

`apps/desktop/src-tauri/src/music_library.rs` already provides qf2 quick fingerprinting and metadata-tolerant behavior.

Important point: **this path is not based on full-file hash for first scan**.

### 3.2 Memory pressure hotspots observed in frontend architecture

From `apps/desktop/src/components/pages/MusicLibrary.tsx` and `MusicLibraryService.ts`:

- Initial and incremental loading still move sizable data into WebView state.
- Search used to execute on every input change (now changed to debounce in this round).
- Large track/album collections still require strict render/caching controls.
- Cover and list rendering pressure remains a primary WebView memory risk area.

Conclusion: your judgment is correct — WebView pressure is a major contributor when entering library/play flows.

### 3.3 Source control model was incomplete before this patch

The service had path records, but query/filter behavior was not fully consistent with source visibility goals.

This round completes key filtering paths so source visibility affects:
- all track list,
- search,
- artist/album/genre facets,
- stats.

---

## 4) Implemented in this patch round

## 4.1 Source toggle model in service layer

`LibraryPath` now carries two switches:
- `isVisible`: controls display inclusion.
- `isScanned`: controls scan participation.

Implemented methods:
- `setLibraryPathVisibility(pathId, isVisible)`
- `setLibraryPathScanning(pathId, isScanned)`

Default normalization for existing records:
- missing flags are treated as `true`.

### 4.2 Query/filter consistency (visibility-aware)

`MusicLibraryService.ts` now applies visibility context in:
- `getAllTracks`
- `searchTracks`
- `getTracksByArtist`
- `getTracksByAlbum`
- `getAllArtists`
- `getAllAlbums`
- `getAllGenres`
- `getLibraryStats`

This makes “scan != display” behavior operational at data-query level.

### 4.3 Startup and full-scan respect scan switch

Startup refresh and `scanAllLibraryPaths` only process `isScanned=true` sources.

### 4.4 Music library UI: source controls

`MusicLibrary.tsx` path manager now supports:
- visibility toggle (show/hide source in library),
- scan toggle (enable/disable auto scan),
- state badges (hidden / scan paused),
- immediate data refresh after visibility/remove actions.

### 4.5 Search debounce (quick memory/CPU win)

Search input now uses debounce (`SEARCH_DEBOUNCE_MS`) instead of immediate query on every keystroke.

### 4.6 Viewport windowing (DOM pressure reduction)

`MusicLibrary.tsx` now uses viewport-based render windows:
- track list is rendered with top/bottom virtual spacers + overscan rows,
- album grid is rendered with row-window slicing + top/bottom spacers,
- scroll snapshot (`scrollTop/clientHeight/clientWidth`) drives the visible window.

This directly limits long-lived DOM node count when library size grows.

### 4.7 Cover payload tightening (runtime state)

Cover handling on playback-side hooks now avoids retaining heavyweight embedded payloads:
- runtime track sanitization removes oversized/ephemeral cover payloads from long-lived UI state,
- `useCoverUrlForTrack` uses compact fetch signatures instead of full cover-url strings in lookup keys,
- media-session metadata skips `data:`/`blob:` artwork payloads,
- dynamic color extraction no longer converts `blob:` covers into duplicated data URLs.

### 4.8 P2 cover reclamation (playback + album view)

Additional memory-control behavior is now in place:
- playback-side cover hooks keep only a small hot set and schedule delayed release for stale cover URLs,
- album view drops offscreen cover URLs (and clears request marks) after a short debounce,
- leaving album view clears album cover URLs from UI state and releases them from runtime caches.

### 4.9 Code-grounded memory budgets (current implementation)

The following values are **not assumptions**; they are from current code constants in
`apps/desktop/src/services/audio/MusicLibraryService.ts`:

- Default runtime cover budgets:
  - `coverUrlCacheMaxEntries = 320`
  - `albumCoverUrlCacheMaxEntries = 96`
  - `coverBlobCacheMaxBytes = 12 MB`
  - `coverDecodedEstimateMaxEntries = 160`
  - `coverDecodedEstimateMaxBytes = 36 MB`
  - `coverCacheMaxBytes = 80 MB`
  - `coverMaxImageBytes = 5 MB`
- Policy downshift budgets:
  - `watch`: blob `8 MB`, decoded `24 MB`
  - `high`: blob `6 MB`, decoded `16 MB`, max image `3 MB`
  - `critical`: blob `4 MB`, decoded `10 MB`, max image `2 MB`
  - `hidden`: blob `1 MB`, decoded `2 MB`, max image `1.5 MB`

Interpretation:
- This confirms current architecture already has cache ceilings and policy-based downshift.
- WebView memory spikes are therefore more likely from **render/data lifecycle pressure**
  (list/card retention, long-lived object references, large IPC payloads), not only from an
  unbounded cache map.

### 4.10 P2 verification matrix (implementation vs. target)

| Area | Target behavior | Current implementation status |
|---|---|---|
| Source visibility | `scan != display`; hide source without delete | ✅ service query layer + UI toggle are wired |
| Source scanning switch | source can be paused from auto-scan | ✅ `isScanned` path-level control is active |
| Search pressure | avoid per-keystroke full search | ✅ debounce (`180ms`) is active |
| Track list DOM pressure | render only viewport window | ✅ virtual window + spacers |
| Album grid DOM pressure | row windowing + spacers | ✅ virtual row window + spacers |
| Cover payload in runtime state | avoid retaining heavy embedded payloads | ✅ playback hooks sanitize and compact |
| Cover URL lifecycle | stale/offscreen URL reclaim | ✅ delayed release + offscreen reclaim + leave-view cleanup |
| Media Session artwork | avoid large `data:`/`blob:` payload | ✅ artwork source guard active |
| Dynamic color extraction | avoid blob->dataURL duplication | ✅ conversion path removed |

### 4.11 Native SQLite write-through baseline (refactor kickoff)

This round starts the local library data-layer refactor without breaking current UI behavior:

- Added Rust-side SQLite module: `apps/desktop/src-tauri/src/music_library_db.rs`
  - tables: `sources`, `local_tracks`
  - pragmas: `foreign_keys`, `WAL`, `synchronous=NORMAL`
  - schema versioning via `PRAGMA user_version`
- Added Tauri commands:
  - `music_library_db_upsert_source`
  - `music_library_db_list_sources`
  - `music_library_db_remove_source`
  - `music_library_db_sync_tracks`
- App startup now initializes music-library sqlite (best-effort) alongside existing services.
- Frontend `MusicLibraryService` now write-through syncs to native sqlite when in Tauri runtime:
  - source add/remove/visibility/scanning updates
  - backend scan diff (`upserts` + `missing`) sync in chunks

Boundary in this phase:

- IndexedDB remains the current read model for UI/query behavior.
- Native sqlite is the new persistent base being populated in parallel for next-phase read-path migration.

### 4.12 Native read-path pilot (`getAllTracks`)

This round adds a controlled read-path pilot:

- New backend query command:
  - `music_library_db_query_tracks`
- New frontend bridge:
  - `queryNativeLibraryTracks(...)`
- `MusicLibraryService.getAllTracks(...)` now tries native sqlite query first in Tauri runtime,
  then falls back to existing IndexedDB path when native result is empty/unavailable.
- `MusicLibraryService.searchTracks(...)` now follows the same native-first + IndexedDB fallback path
  with backend-side search predicate (`title/artist/album/file_path`, case-insensitive).

Boundary in this pilot:

- Scope currently covers `getAllTracks` + `searchTracks` only (facets/stats remain on IndexedDB).
- Fallback keeps old behavior intact while native sqlite coverage is still converging.

### 4.13 Native read-path expansion (`artists/albums/genres/stats`)

This round extends native-first reads for facet and stats APIs while preserving compatibility fallbacks:

- Backend SQLite schema/queries:
  - `local_tracks` now includes `genre` column.
  - schema version bumped to `v2` with in-place migration (`ALTER TABLE ... ADD COLUMN genre`).
  - added native read queries:
    - `list_artists`
    - `list_genres`
    - `list_albums`
    - `get_stats`
- Added Tauri commands:
  - `music_library_db_list_artists`
  - `music_library_db_list_genres`
  - `music_library_db_list_albums`
  - `music_library_db_get_stats`
- Frontend bridge (`nativeLibraryDb.ts`) now supports typed calls for facet/stats query payloads.
- `MusicLibraryService` integration:
  - `getAllArtists()` -> native-first + IndexedDB fallback
  - `getAllGenres()` -> native-first + IndexedDB fallback
  - `getAllAlbums({ includeStoredCover: false })` -> native-first + IndexedDB fallback
  - `getLibraryStats()` -> native-first + IndexedDB fallback (with existing cache behavior preserved)
  - write-through payload now also syncs `genre` into native sqlite.

Boundary in this phase:

- Native album list is only used when `includeStoredCover` is `false`.
- Any native empty/error path still falls back to IndexedDB to keep existing UX stable.

### 4.14 Native read-path expansion (`getTracksByArtist/getTracksByAlbum`)

This round extends native-first reads for artist/album track-detail views:

- Track query contract now supports exact facet filters:
  - `artist`
  - `album`
- Backend implementation (`music_library_db::query_tracks`) now applies optional
  case-insensitive exact matching for artist/album while keeping existing visibility/missing/search rules.
- Added query indexes to improve facet-detail lookup performance:
  - `local_tracks_artist_idx`
  - `local_tracks_album_idx`
- Frontend bridge (`queryNativeLibraryTracks`) now passes optional `artist/album` payload fields.
- `MusicLibraryService` integration:
  - `getTracksByArtist(...)` -> native-first + IndexedDB fallback
  - `getTracksByAlbum(...)` -> native-first + IndexedDB fallback

Boundary in this phase:

- Fallback remains active for empty/error native path to preserve current UX during migration convergence.

### 4.15 Native read-path expansion (`getTrackById`)

This round migrates single-track detail lookup to native-first:

- Track query contract now supports exact `trackId` filter.
- Backend `query_tracks` supports optional `track_id` equality filter while keeping existing behavior for
  visibility/missing/search/artist/album constraints.
- Frontend bridge supports `trackId` in `NativeLibraryTrackQuery`.
- `MusicLibraryService.getTrackById(...)` now uses native-first lookup and falls back to IndexedDB on miss/error.

Boundary in this phase:

- Empty native result still falls back to IndexedDB to keep migration-safe behavior.

### 4.16 Native read-path expansion (`getLibraryPaths`)

This round migrates library source listing to native-first while preserving browser/legacy compatibility:

- `getLibraryPaths()` now prefers native sqlite source list in Tauri runtime.
- IndexedDB remains fallback when native source list is empty/unavailable.
- Startup native bootstrap now explicitly reads from IndexedDB (`readLibraryPathsFromIndexedDb`) to avoid
  native-read recursion and keep first-run convergence deterministic.
- Native/IndexedDB merge behavior for source list:
  - source identity and flags (`isVisible/isScanned/addedAt/lastScanned`) come from native sqlite.
  - legacy-only fields (`folderHandle`, `trackCount`) are best-effort merged from IndexedDB by `id/path`.
- Native source payload now includes `trackCount` (available tracks per source), reducing reliance on
  IndexedDB path snapshots for source-count display.
- Path toggle resilience:
  - `setLibraryPathVisibility` / `setLibraryPathScanning` now recover when a source exists in native sqlite
    but is absent in IndexedDB, then backfill IndexedDB metadata and upsert native state.

Boundary in this phase:

- Source list is native-first only in Tauri runtime.
- Browser runtime remains IndexedDB-only as before.

### 4.17 Scan diff baseline optimization (`sourceId` native lookup)

This round reduces IndexedDB pressure in backend-scan diff:

- Track query contract now supports `sourceId` exact filter.
- `getStoredTracksForBackendScan(...)` now prefers native sqlite source-scoped query in Tauri runtime,
  then falls back to IndexedDB when native query fails.
- Effect: scan diff no longer needs to rely on IndexedDB full-store traversal for the common
  `pathId`-known backend scan path.

Boundary in this phase:

- Native source-scoped lookup is only used when `pathId` is present.
- Existing fallback preserves previous behavior for legacy or error paths.

### 4.18 Scan snapshot update convergence (`libraryPaths`)

This round unifies scan-snapshot update behavior across both scan flows (`scanFolder` and
`scanFolderViaTauriBackend`):

- Added a shared helper to update per-source scan snapshot (`lastScanned`, `trackCount`) with
  convergence logic.
- If a source exists in native sqlite but not in IndexedDB, scan snapshot update now:
  - recovers source metadata from current source list,
  - backfills IndexedDB (`libraryPaths`) record,
  - and upserts native source state.

Boundary in this phase:

- Behavior is functionally backward-compatible for existing IndexedDB-first records.
- New path mainly improves consistency when source records originate from native-first flow.

### 4.19 Native write-path parity (`clear/delete tracks`)

This round completes native sqlite write parity for track deletion operations while preserving
IndexedDB fallback compatibility:

- Rust sqlite module (`music_library_db.rs`) adds:
  - `clear_tracks(app)` -> delete all rows from `local_tracks`
  - `delete_tracks(app, track_ids)` -> normalized-id transactional delete
- Tauri command layer and registry now expose:
  - `music_library_db_clear_tracks`
  - `music_library_db_delete_tracks`
- Frontend bridge (`nativeLibraryDb.ts`) now supports typed native write calls:
  - `clearNativeLibraryTracks(): Promise<number>`
  - `deleteNativeLibraryTracks(trackIds: string[]): Promise<number>`
- `MusicLibraryService` write flow is now native-first in Tauri runtime for:
  - `clearLibrary()`
  - `deleteTrack(id)`
  - `deleteMultipleTracks(ids)`
  while keeping IndexedDB writes as fallback/compatibility path.

Validation baseline:

- Added bridge tests for clear/delete command payload normalization and affected-count parsing.
- Verified with:
  - desktop `type-check`
  - desktop `lint`
  - targeted vitest (`nativeLibraryDb.spec.ts`, `MusicLibraryService.spec.ts`)
  - `cargo test` in `src-tauri`

### 4.20 Source removal data convergence (`libraryPaths + tracks`)

This round hardens source removal behavior to avoid stale IndexedDB fallback data:

- `MusicLibraryService.removeLibraryPath(pathId)` now normalizes `pathId` and performs one
  IndexedDB write transaction across both stores:
  - delete source row from `libraryPaths`
  - delete all `tracks` rows where `libraryPathId == pathId`
- Removal uses `libraryPathId` index cursor when available, with full-store cursor fallback for
  legacy index-missing cases.
- Native source removal still runs via `removeNativeLibrarySource(pathId)` (sqlite FK cascade)
  after local IndexedDB cleanup.
- Cache invalidation (`clearCache`) is now explicit after source removal.

Expected effect:

- Prevents old source tracks from lingering in IndexedDB fallback path.
- Reduces stale-data surface and lowers legacy fallback memory pressure during large library
  path removals.

### 4.21 Source health + cleanup primitives (`sqlite native`)

This round adds native-by-source maintenance primitives to support future library governance panel
and dirty-data repair workflows:

- Rust sqlite (`music_library_db.rs`) adds:
  - `list_source_health(query)`
    - per-source aggregates: `total/available/missing tracks`, `artists`, `albums`,
      `totalSize`, `sourceUpdatedAtMs`, `lastTrackUpdatedAtMs`
    - optional `sourceId` filter
  - `cleanup_source_tracks(source_id, missing_only)`
    - `missing_only=true` (default): delete only rows with `status='missing'`
    - `missing_only=false`: clear all tracks under one source (preserve source row)
- Tauri command registry exposes:
  - `music_library_db_list_source_health`
  - `music_library_db_cleanup_source_tracks`
- TS bridge (`nativeLibraryDb.ts`) adds:
  - `listNativeLibrarySourceHealth({ sourceId? })`
  - `cleanupNativeLibrarySourceTracks(sourceId, { missingOnly? })`
- `MusicLibraryService` now exposes high-level wrappers:
  - `getLibraryPathHealth(pathId?)`
  - `cleanupLibraryPathTracks(pathId, { missingOnly? })`

Expected effect:

- Enables source-scoped diagnostics (missing-rate / stale-volume) without heavy full-table scans
  in WebView.
- Enables precise cleanup before/after scan cycles and reduces legacy fallback payload pressure.

### 4.22 Path manager maintenance UI baseline (`missing cleanup`)

This round wires source health into the existing Library Path Manager UI for operational cleanup:

- `MusicLibrary` now loads native source health map (`sourceId -> health`) when path manager is open.
- Per-path metadata now shows missing-track badge when `missingTracks > 0`.
- Added per-path cleanup action:
  - button triggers `cleanupLibraryPathTracks(pathId, { missingOnly: true })`
  - on success refreshes both path list and library data.
- Added global header action to clean missing records across all paths in one pass.
- Footer now surfaces health status (`loading / summary / unavailable`) to keep operator feedback explicit.

Contract notes:

- UI remains local-first and only enables health operations in Tauri runtime.
- User-visible strings are i18n-based (`zh-CN` + `en-US`) and avoid hardcoded text.

### 4.23 Cleanup safety confirmation (`destructive guard`)

This round adds an explicit confirmation layer before deleting missing-track records from path manager:

- Added `cleanupConfirmTarget` state in `MusicLibrary` to model pending cleanup scope:
  - single path (`mode='path'`, `pathId`, `pathName`, `count`)
  - all paths (`mode='all'`, `count`)
- Path-level and global cleanup buttons now trigger request handlers first; deletion runs only after
  user confirms via `ConfirmDialog`.
- Confirmation dialog uses danger style and localized copy in both `zh-CN` and `en-US`.
- While confirmation is open, cleanup buttons are temporarily disabled to prevent duplicate intent.

Operational effect:

- Prevents accidental mass cleanup from one-click actions.
- Keeps existing cleanup implementation and refresh behavior unchanged after confirmation.

### 4.24 Playback stats + local-first resolver baseline (`P2 trunk`)

This round lays the first executable trunk for Hydra-style playback resolution and owner-library stats:

- Native sqlite schema upgraded to `v3` with playback columns:
  - `local_tracks.play_count INTEGER NOT NULL DEFAULT 0`
  - `local_tracks.last_played_at_ms INTEGER`
- Added native command `music_library_db_mark_track_played`:
  - increments `play_count`
  - updates `last_played_at_ms`
  - keeps `updated_at_ms` monotonic
- `NativeAudioService` now writes playback mark best-effort when track actually starts:
  - normal load-and-play path
  - crossfade switch path
- Native track query contract extends exact filters for resolver usage:
  - `quickFingerprint`
  - `filePath`
- `MusicLibraryService` now exposes Hydra-oriented APIs:
  - `markTrackPlayed(trackId, { playedAtMs? })`
  - `resolveLocalPlaybackCandidate({ trackId?, quickFingerprint?, filePath?, sourceId?, includeMissing?, visibleOnly? })`
    - lookup priority: `trackId -> quickFingerprint -> filePath`
    - returns `{ track, strategy, requiresNetworkFallback }`

Contract notes:

- Resolver is local-first only in this phase and intentionally does **not** fetch network audio.
- `requiresNetworkFallback=true` is the handoff signal for future Hydra cloud/P2P resolver.
- Fingerprint matching uses canonical `qf2:<hex>` normalization at both TS and Rust boundaries.

---

## 5) Why this architecture is correct for Hydra evolution

This is the intended bridge:

1. **Physical source layer** (local folders/NAS etc.)
2. **Local track registry** keyed by quick fingerprint
3. **Logical user entry layer** (owner-aware metadata, tags, ratings, future cloud sync)

Resolver strategy:
- Play request -> resolve local by fingerprint/path first.
- If missing locally and cloud-enabled entry exists -> network fetch fallback.

This enables future “metaverse concert / shared listening” without forcing heavy cloud logic now.

---

## 6) Target schema (next phase, SQLite track)

When moving to SQLite, use this practical model (flat enough for local speed, extensible for cloud):

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  display_name TEXT,
  category TEXT NOT NULL DEFAULT 'music',
  is_visible INTEGER NOT NULL DEFAULT 1,
  is_scanned INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE local_tracks (
  id TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  quick_fingerprint TEXT,
  cloud_full_hash TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  duration_ms INTEGER,
  metadata_json TEXT,
  file_size INTEGER,
  mtime_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'available',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(source_id, file_path)
);

CREATE TABLE user_entries (
  id TEXT PRIMARY KEY,              -- e.g. <owner_uid>::<uuidv7>
  owner_uid TEXT NOT NULL,
  track_id TEXT NOT NULL,
  rating INTEGER,
  tags_json TEXT,
  in_cloud INTEGER NOT NULL DEFAULT 0,
  is_missing INTEGER NOT NULL DEFAULT 0,
  last_played_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

Notes:
- Full hash should stay **lazy** (`cloud_full_hash` nullable).
- `owner_uid` belongs to logical/user layer, not physical source identity.

---

## 7) Memory optimization baseline (execution order)

### P0 (now / immediate)

1. Keep source visibility filtering in all list/facet/stats queries.
2. Keep debounced search path.
3. Avoid passing/keeping heavyweight payloads in UI state.
4. Continue strict cover cache limits and reclaim policies.

### P1 (next)

1. Introduce true virtualized list/grid for large collections.
2. Move more expensive metadata/cover-side computations off hot UI path.
3. Keep source manager as first-class control surface.

### P2 (Hydra-ready)

1. Add logical user library tables with `owner_uid` + `last_played_at_ms`.
2. Lazy full-hash computation for share/sync actions.
3. Resolver fallback: local-first, network-second.

---

## 8) Anti-patterns explicitly rejected

1. Full-file hash for every file during initial local scan.
2. Coupling physical folder scan result directly to final display list.
3. Treating heavy cover payloads as long-lived frontend state.
4. Forcing cloud-level normalization complexity into current local-first phase.

---

## 9) Acceptance criteria for this baseline

1. Toggling a source to hidden removes its tracks from list/search/facets/stats without deleting source data.
2. Toggling source scanning off prevents auto scan participation.
3. Search no longer runs at every keystroke (debounced).
4. Functional behavior remains consistent for existing local playback flows.

---

## 10) Validation executed for this baseline

Executed on current workspace:

1. `pnpm --filter @pixel-matrix/desktop type-check`
2. `pnpm --filter @pixel-matrix/desktop lint`
3. `pnpm --filter @pixel-matrix/desktop test -- src/services/audio/__tests__/MusicLibraryService.spec.ts`
4. `cargo test` (under `apps/desktop/src-tauri`)

Result: all passed in current patch state.

---

## 11) `pmp://cover` protocol baseline (P2 extension)

To reduce WebView image-memory pressure from file-path based cover URLs, cover rendering now
uses a dedicated custom protocol.

- URL format:
  - `pmp://cover/<coverKey>`
- Frontend behavior:
  - `MusicLibraryService.getCoverUrlForTrack` still calls `music_library_get_cover`.
  - The command still returns `{ key, path, size, mediaType }`.
  - Frontend now builds URL from `key` (`pmp://cover/...`) and no longer depends on `convertFileSrc`.
- Backend behavior:
  - Tauri registers `register_uri_scheme_protocol("pmp", ...)`.
  - Protocol handler validates cover key format and rejects traversal-style requests.
  - Handler resolves cached cover file by key and returns binary bytes with content type.
  - Response includes cache headers (`Cache-Control`, `Content-Length`).

Boundary:
- Protocol input is **cover key only**, not arbitrary file path.
- File path -> cover key/variant resolve stays in `music_library_get_cover` command.

### 11.1 Size hint routing

Protocol now supports optional size hints:

- `pmp://cover/<coverKey>?size=small`
- `pmp://cover/<coverKey>?size=medium`
- `pmp://cover/<coverKey>?size=large`

Backend behavior:
- Size-to-edge mapping:
  - `small -> 160px`
  - `medium -> 256px`
  - `large -> 384px`
- If requested variant file exists, serve it first.
- If not, fall back to the original requested key.

Frontend behavior:
- `MusicLibraryService.getCoverUrlForTrack` accepts `coverSizeHint` and forwards matching `maxEdgePx` to `music_library_get_cover`.
- UI usage baseline:
  - Album grid: `small`
  - Progress bar / play-pause dynamic color: `small`
  - Track info: `medium`

### 11.2 Dynamic-color sampling and release lifecycle

Code-grounded behavior:

- `useDynamicColor` now supports:
  - `sampleSize: small|medium|large`
  - `releaseAfterExtract`
  - `cacheKey`
- Dynamic-color sampling for playback magnets uses `small` size.
- For non-image dynamic-color surfaces (play/pause, progress), extraction path can release cover URL after sampling.
- `dynamicColors.ts` now treats `pmp://...` as a portable image source, so extraction works directly against protocol URLs.

Memory implication:

- The old risk path (`blob -> dataURL` duplication) is avoided.
- Cover bytes stay in protocol/cache pipeline, and dynamic color keeps only tiny color values in React state.

### 11.3 Audio chain vs WebView memory (code-backed conclusion)

Current code shows native audio is not routed through WebView decode by default:

- Frontend audio service default decode mode is `streaming` (not full-track predecode).
- Rust audio engine default is also `streaming` for low startup latency and lower memory.

So when WebView memory rises sharply, primary suspects are UI-side assets/lifecycle, not PCM decode buffers:

1. Cover decode/render surfaces (JS image objects + GPU textures).
2. Long-lived list/card state retention and derived-array churn.
3. Dynamic-color sampling bursts during rapid track switches.

Current mitigation already landed:

- Size-hinted protocol covers (`small/medium/large`).
- Playback/album cover URL reclaim paths.
- Viewport windowing in library list/grid.
- Runtime track sanitization (drop heavy ephemeral payload fields).

---

## 12) Baseline metrics and evidence sources

To avoid guess-based tuning, use these built-in signals as optimization baseline:

1. Cover runtime cache snapshot
   - Source: `MusicLibraryService.getCoverRuntimeCacheStats()`
   - Fields:
     - `coverUrlCacheEntries`
     - `coverBlobUrlCacheEntries`
     - `coverBlobUrlTotalBytes`
     - `coverDecodedEstimateEntries`
     - `coverDecodedEstimateTotalBytes`
     - `albumCoverUrlCacheEntries`

2. Governance memory snapshot
   - Source: `DefaultMemoryGovernanceService.collectSnapshot()`
   - Includes:
     - `jsHeapUsedBytes`
     - `webview2.webview2WorkingSetBytes`
     - `webview2.webview2PrivateBytes`
     - `webview2.treeWorkingSetBytes`
     - `webview2.treePrivateBytes`

3. Tier thresholds already codified (`contracts/memoryGovernance.ts`)
   - Tier-1 trigger includes any of:
     - JS heap >= `700 MB`
     - WebView2 private >= `650 MB`
     - WebView2 working set >= `800 MB`
   - Tier-2/3 escalate from there and can trigger hidden-window destroy actions.

This gives a concrete, repeatable baseline:

- Measure before opening library.
- Measure after opening library and after starting playback.
- Compare cache bytes + WebView2 private/working-set deltas.
- Apply policy/manual reclaim and re-measure.

Operational helper now available in Debug Center:

- `Debug Center -> Memory / Cache -> Capture baseline`
- `Debug Center -> Memory / Cache -> Capture 3-stage baseline`
- `Debug Center -> Memory / Cache -> Export baselines JSON / CSV`
- `Debug Center -> Memory / Cache -> Copy latest scenario summary`
- `Debug Center -> Memory / Cache -> Write latest scenario report`
- 3-stage capture now auto-writes the latest scenario report (best-effort) when stage collection completes
  in Tauri runtime; manual write button remains available for ad-hoc snapshots.
- Samples are persisted at storage key:
  - `STORAGE_KEYS.MEMORY_BASELINE_SAMPLES_V1`
  - value type: array of manual memory snapshots (latest-first, capped)

3-stage capture behavior:

- Stage timeline:
  - `pre-library` at `t+0s`
  - `post-library` at `t+8s`
  - `post-playback` at `t+20s`
- Debug Center also shows latest scenario delta for:
  - JS heap
  - WebView2 Private/WS
  - cover blob/decoded estimates

Export payload notes:

- JSON includes:
  - raw baseline samples
  - scenario-level comparisons (start/end + byte deltas)
- CSV includes two sections:
  - `memory_baseline_samples`
  - `memory_baseline_scenario_comparisons`
- Copy summary outputs a single-line latest scenario delta text to clipboard
  (ready for issue/log paste).
- Write report stores a markdown snapshot with timestamp + best-effort commit hash:
  - Tauri runtime: writes to `AppData/logs/`
  - non-Tauri: downloads markdown file as fallback
- Report now also attempts to include latest git commit summaries (best-effort):
  - source: backend `debug_get_recent_git_commits`
  - fallback: `unavailable` when git metadata cannot be resolved

Only after this evidence loop should we decide whether to prioritize:

1. deeper list pagination/data slicing,
2. stricter cover cache ceilings,
3. dynamic-color extraction throttling.
