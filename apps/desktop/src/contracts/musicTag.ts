export interface MusicTagCanonicalMetadata {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  genre?: string | null;
  year?: number | null;
  date?: string | null;
  originalDate?: string | null;
  trackNumber?: number | null;
  trackTotal?: number | null;
  discNumber?: number | null;
  discTotal?: number | null;
  composer?: string | null;
  lyricist?: string | null;
  conductor?: string | null;
  arranger?: string | null;
  label?: string | null;
  catalogNumber?: string | null;
  barcode?: string | null;
  isrc?: string | null;
  bpm?: number | null;
  musicalKey?: string | null;
  language?: string | null;
  comment?: string | null;
  lyrics?: string | null;
  mbidRecording?: string | null;
  mbidRelease?: string | null;
  mbidReleaseGroup?: string | null;
  mbidArtist?: string | null;
  mbidAlbumArtist?: string | null;
  acoustid?: string | null;
}

export type MusicTagMetadataFieldKey = keyof MusicTagCanonicalMetadata;
export type MusicTagCandidateProvider = 'local-tags' | 'musicbrainz' | 'acoustid' | 'lyrics' | 'manual' | string;
export type MusicTagCandidateConfidence = 'exact' | 'high' | 'medium' | 'low' | string;
export type MusicTagDbLockMode = 'merge' | 'replace' | string;
export type MusicTagProviderCapability = 'metadata' | 'fingerprint' | 'lyrics' | 'cover-art';

export interface MusicTagMetadataProviderDescriptor {
  id: string;
  displayName: string;
  description: string;
  capabilities: MusicTagProviderCapability[];
  builtin: boolean;
  requiresNetwork: boolean;
  requiresApiKey: boolean;
  enabled: boolean;
  priority: number;
}

export interface MusicTagReadLocalRequest {
  filePath: string;
  includeCover?: boolean;
}

export interface MusicTagEmbeddedCover {
  mimeType: string;
  dataBase64: string;
  byteLength: number;
  pictureType: string;
}

export interface MusicTagReadLocalResult {
  filePath: string;
  fileSize: number;
  mtimeMs: number;
  format?: string | null;
  tagCount: number;
  tagTypes: string[];
  fieldCount: number;
  metadata: MusicTagCanonicalMetadata;
  embeddedCover?: MusicTagEmbeddedCover | null;
  warnings: string[];
  readAtMs: number;
}

export interface MusicTagDbPatchRequest {
  trackId: string;
  sourceMetadata: MusicTagCanonicalMetadata;
  selectedCandidateIds?: string[];
  lockedFields?: MusicTagMetadataFieldKey[];
  lockMode?: MusicTagDbLockMode;
  tagSource?: MusicTagCandidateProvider;
  tagConfidence?: number;
  expectedMtimeMs?: number;
}

export interface MusicTagDbFieldChangeRecord {
  field: MusicTagMetadataFieldKey;
  columnName: string;
  before: unknown;
  after: unknown;
  locked: boolean;
}

export interface MusicTagDbPatchResult {
  trackId: string;
  filePath: string;
  fileMtimeMs?: number | null;
  existingLockedFields: MusicTagMetadataFieldKey[];
  lockedFields: MusicTagMetadataFieldKey[];
  changedFields: MusicTagDbFieldChangeRecord[];
  beforeDbJson: unknown;
  afterDbJson: unknown;
  selectedCandidateIds: string[];
  tagSource?: MusicTagCandidateProvider | null;
  tagConfidence?: number | null;
  tagLastAuditId?: string | null;
  tagUpdatedAtMs: number;
  applied: boolean;
  canApply: boolean;
  warnings: string[];
}

export interface MusicTagCandidateSearchRequest {
  trackId?: string;
  filePath?: string;
  quickFingerprint?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  metadata?: MusicTagCanonicalMetadata;
  embeddedLyrics?: string;
  lyricLocator?: string;
  language?: string;
  acoustidFingerprint?: string;
  acoustidApiKey?: string;
  limit?: number;
  providerIds?: string[];
  includeNetwork?: boolean;
  includeLyrics?: boolean;
}

export interface MusicTagCandidate {
  id: string;
  provider: MusicTagCandidateProvider;
  providerEntityType: string;
  providerEntityId?: string | null;
  metadata: MusicTagCanonicalMetadata;
  artworkUrl?: string | null;
  score: number;
  confidence: MusicTagCandidateConfidence;
  reasons: string[];
  warnings: string[];
  fetchedAtMs: number;
  expiresAtMs?: number | null;
}

export interface MusicTagLyricsResolutionSummary {
  selectionKey: string;
  selectedSource?: string | null;
  triedSources: string[];
  diagnostics: string[];
  hasSelected: boolean;
  format?: string | null;
  language?: string | null;
  confidence?: number | null;
  hasWordTiming: boolean;
}

export interface MusicTagCandidateSearchResult {
  candidates: MusicTagCandidate[];
  lyricsResolution?: MusicTagLyricsResolutionSummary | null;
  searchedProviders: string[];
  warnings: string[];
  fetchedAtMs: number;
}

export interface MusicTagHistoryQuery {
  trackId?: string;
  limit?: number;
  offset?: number;
}

export interface MusicTagHistoryEntry {
  id: string;
  trackId: string;
  filePath: string;
  selectedCandidateIds: string[];
  beforeDb: unknown;
  afterDb: unknown;
  beforeFile?: MusicTagCanonicalMetadata | null;
  afterFile?: MusicTagCanonicalMetadata | null;
  changedFields: MusicTagDbFieldChangeRecord[];
  writeDb: boolean;
  writeFile: boolean;
  fileMtimeBeforeMs?: number | null;
  fileMtimeAfterMs?: number | null;
  status: 'applied' | 'rollback' | 'failed' | string;
  errorMessage?: string | null;
  createdAtMs: number;
  appliedBy: string;
}

export interface MusicTagHistoryPage {
  items: MusicTagHistoryEntry[];
  total: number;
}

export interface MusicTagRollbackRequest {
  auditId: string;
}

export interface MusicTagRollbackResult {
  rolledBackAuditId: string;
  createdAuditId?: string | null;
  trackId: string;
  restoredDb: boolean;
  restoredFile: boolean;
  dbResult?: MusicTagDbPatchResult | null;
  warnings: string[];
}

export interface MusicTagWriteFileRequest {
  trackId?: string;
  filePath: string;
  metadata: MusicTagCanonicalMetadata;
  expectedMtimeMs: number;
  writeCover?: boolean;
  coverDataBase64?: string;
  coverUrl?: string;
  coverMimeType?: string;
  replaceAll?: boolean;
}

export interface MusicTagWriteFileResult {
  auditId?: string | null;
  filePath: string;
  format: string;
  fieldsWritten: number;
  mtimeBeforeMs: number;
  mtimeAfterMs: number;
  verified: boolean;
  warnings: string[];
}

export interface CoverArtSearchRequest {
  mbidRelease: string;
  trackId?: string;
}

export interface CoverArtCandidate {
  url: string;
  thumbnailUrl?: string | null;
  coverType: string;
  approved: boolean;
}

export interface CoverArtSearchResult {
  candidates: CoverArtCandidate[];
  releaseMbid: string;
  warnings: string[];
}

export interface CoverArtDownloadRequest {
  url: string;
  trackId: string;
  releaseMbid?: string;
}

export interface CoverArtDownloadResult {
  cacheKey: string;
  fileSize: number;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

export interface ChromaprintRequest {
  filePath: string;
  maxDurationSeconds?: number;
}

export interface ChromaprintResult {
  filePath: string;
  fingerprint: string;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
}

export type MusicTagBatchMode = 'apply-db' | 'write-file' | 'apply-and-write';

export interface MusicTagBatchItem {
  trackId: string;
  filePath: string;
  sourceMetadata: MusicTagCanonicalMetadata;
  lockedFields: string[];
  tagSource?: string;
  tagConfidence?: number;
  expectedMtimeMs?: number;
}

export interface MusicTagBatchRequest {
  mode: MusicTagBatchMode;
  items: MusicTagBatchItem[];
}

export interface MusicTagBatchProgressPayload {
  runId: string;
  mode: MusicTagBatchMode;
  total: number;
  current: number;
  currentTrackId?: string;
  status: string;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
  lastError?: string;
}

export interface MusicTagBatchState {
  running: boolean;
  runId?: string;
  mode?: MusicTagBatchMode;
  total: number;
  current: number;
  appliedCount: number;
  skippedCount: number;
  errorCount: number;
}
