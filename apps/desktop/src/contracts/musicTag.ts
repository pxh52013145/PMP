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
export type MusicTagCandidateProvider = 'local-tags' | 'musicbrainz' | 'acoustid' | 'lyrics' | string;
export type MusicTagCandidateConfidence = 'exact' | 'high' | 'medium' | 'low' | string;
export type MusicTagDbLockMode = 'merge' | 'replace' | string;

export interface MusicTagReadLocalRequest {
  filePath: string;
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
  includeNetwork?: boolean;
  includeLyrics?: boolean;
}

export interface MusicTagCandidate {
  id: string;
  provider: MusicTagCandidateProvider;
  providerEntityType: string;
  providerEntityId?: string | null;
  metadata: MusicTagCanonicalMetadata;
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
