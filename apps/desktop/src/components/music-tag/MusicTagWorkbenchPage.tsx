import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  ArrowRight,
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Database,
  Eye,
  FileAudio,
  FileDown,
  Image,
  Library,
  ListChecks,
  Loader2,
  LockKeyhole,
  Music2,
  Network,
  Pencil,
  Save,
  Search,
  ShieldCheck,
  Tags,
  TextQuote,
} from 'lucide-react';
import type {
  CoverArtCandidate,
  CoverArtSearchResult,
  MusicTagBatchProgressPayload,
  MusicTagCandidateSearchResult,
  MusicTagCanonicalMetadata,
  MusicTagDbPatchRequest,
  MusicTagDbPatchResult,
  MusicTagMetadataFieldKey,
  MusicTagReadLocalResult,
  MusicTagWriteFileResult,
} from '../../contracts/musicTag';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import {
  queryNativeLibraryTracksPage,
  resolveNativeLibraryLyrics,
  type NativeLibraryTrackRecord,
  type NativeLyricResolveResult,
} from '../../modules/music-library/nativeLibraryDb';
import {
  applyMusicTagDbPatch,
  cancelMusicTagBatch,
  generateChromaprint,
  previewMusicTagDbPatch,
  readLocalMusicTags,
  searchCoverArtCandidates,
  searchMusicTagCandidates,
  startMusicTagBatch,
  writeMusicTagFileTags,
} from '../../modules/music-tag/nativeMusicTag';
import type { Track } from '../../services/audio';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from '../../services/commands';
import { broadcastDataUpdate } from '../../utils/windowCommunication';
import './MusicTagWorkbenchPage.css';

type LocalTagReadState = 'idle' | 'loading' | 'ready' | 'error';
type CompareState = 'same' | 'different' | 'missingDb' | 'missingFile' | 'missingBoth';
type BatchPreviewState = 'idle' | 'loading' | 'ready' | 'running' | 'done' | 'error';
type BatchTrackState = 'pending' | 'reading' | 'ready' | 'error' | 'skipped';
type DbPatchState = 'idle' | 'previewing' | 'ready' | 'applying' | 'applied' | 'error';
type CandidateState = 'idle' | 'searching' | 'ready' | 'error';
type WriteFileState = 'idle' | 'writing' | 'done' | 'error';
type CoverArtState = 'idle' | 'searching' | 'ready' | 'error';

interface MusicTagWorkbenchPageProps {
  trackIds?: string[];
}

type WorkbenchStage = {
  id: string;
  labelKey: string;
  stateKey: string;
  Icon: typeof Tags;
  isReady?: boolean;
};

type ComparisonField = {
  key: MusicTagMetadataFieldKey;
  labelKey: string;
  readTrackValue: (track: Track | null) => unknown;
  isLongText?: boolean;
};

type BatchComparisonField = {
  key: MusicTagMetadataFieldKey;
  labelKey: string;
  readTrackValue: (track: NativeLibraryTrackRecord) => unknown;
};

type BatchPreviewRow = {
  track: NativeLibraryTrackRecord;
  state: BatchTrackState;
  diffCount: number | null;
  fieldCount: number | null;
  localTagResult?: MusicTagReadLocalResult | null;
  format?: string | null;
  error?: string | null;
};

type LockFieldOption = {
  key: MusicTagMetadataFieldKey;
  labelKey: string;
};

const COMPARISON_FIELDS: ComparisonField[] = [
  {
    key: 'title',
    labelKey: 'pages.musicTagWorkbench.fields.title',
    readTrackValue: (track) => track?.title,
  },
  {
    key: 'artist',
    labelKey: 'pages.musicTagWorkbench.fields.artist',
    readTrackValue: (track) => track?.artist,
  },
  {
    key: 'album',
    labelKey: 'pages.musicTagWorkbench.fields.album',
    readTrackValue: (track) => track?.album,
  },
  {
    key: 'albumArtist',
    labelKey: 'pages.musicTagWorkbench.fields.albumArtist',
    readTrackValue: (track) => track?.albumArtist,
  },
  {
    key: 'genre',
    labelKey: 'pages.musicTagWorkbench.fields.genre',
    readTrackValue: (track) => track?.genre,
  },
  {
    key: 'year',
    labelKey: 'pages.musicTagWorkbench.fields.year',
    readTrackValue: (track) => track?.year,
  },
  {
    key: 'trackNumber',
    labelKey: 'pages.musicTagWorkbench.fields.trackNumber',
    readTrackValue: (track) => track?.trackNumber,
  },
  {
    key: 'discNumber',
    labelKey: 'pages.musicTagWorkbench.fields.discNumber',
    readTrackValue: (track) => track?.discNumber,
  },
  {
    key: 'composer',
    labelKey: 'pages.musicTagWorkbench.fields.composer',
    readTrackValue: (track) => track?.composer,
  },
  {
    key: 'lyrics',
    labelKey: 'pages.musicTagWorkbench.fields.lyrics',
    readTrackValue: (track) => track?.lyrics,
    isLongText: true,
  },
  {
    key: 'comment',
    labelKey: 'pages.musicTagWorkbench.fields.comment',
    readTrackValue: (track) => track?.comment,
    isLongText: true,
  },
];

const BATCH_COMPARISON_FIELDS: BatchComparisonField[] = [
  {
    key: 'title',
    labelKey: 'pages.musicTagWorkbench.fields.title',
    readTrackValue: (track) => track.title,
  },
  {
    key: 'artist',
    labelKey: 'pages.musicTagWorkbench.fields.artist',
    readTrackValue: (track) => track.artist,
  },
  {
    key: 'album',
    labelKey: 'pages.musicTagWorkbench.fields.album',
    readTrackValue: (track) => track.album,
  },
  {
    key: 'genre',
    labelKey: 'pages.musicTagWorkbench.fields.genre',
    readTrackValue: (track) => track.genre,
  },
  {
    key: 'year',
    labelKey: 'pages.musicTagWorkbench.fields.year',
    readTrackValue: (track) => track.year,
  },
];

const LOCK_FIELD_OPTIONS: LockFieldOption[] = [
  {
    key: 'title',
    labelKey: 'pages.musicTagWorkbench.fields.title',
  },
  {
    key: 'artist',
    labelKey: 'pages.musicTagWorkbench.fields.artist',
  },
  {
    key: 'album',
    labelKey: 'pages.musicTagWorkbench.fields.album',
  },
  {
    key: 'albumArtist',
    labelKey: 'pages.musicTagWorkbench.fields.albumArtist',
  },
  {
    key: 'genre',
    labelKey: 'pages.musicTagWorkbench.fields.genre',
  },
  {
    key: 'year',
    labelKey: 'pages.musicTagWorkbench.fields.year',
  },
  {
    key: 'trackNumber',
    labelKey: 'pages.musicTagWorkbench.fields.trackNumber',
  },
  {
    key: 'discNumber',
    labelKey: 'pages.musicTagWorkbench.fields.discNumber',
  },
  {
    key: 'composer',
    labelKey: 'pages.musicTagWorkbench.fields.composer',
  },
  {
    key: 'isrc',
    labelKey: 'pages.musicTagWorkbench.fields.isrc',
  },
  {
    key: 'lyrics',
    labelKey: 'pages.musicTagWorkbench.fields.lyrics',
  },
  {
    key: 'mbidRecording',
    labelKey: 'pages.musicTagWorkbench.fields.mbidRecording',
  },
  {
    key: 'acoustid',
    labelKey: 'pages.musicTagWorkbench.fields.acoustid',
  },
];

const BATCH_PREVIEW_LIMIT = 50;

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMetadataValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return hasText(value);
}

function readTrackFilePath(track: Track | null): string {
  return String(track?.filePath || track?.originalPath || track?.path || '').trim();
}

function readNativeTrackFilePath(track: NativeLibraryTrackRecord): string {
  return String(track.filePath || '').trim();
}

function isLocalFilePath(filePath: string): boolean {
  return filePath.length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function normalizeCompareValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function compareValues(dbValue: unknown, fileValue: unknown): CompareState {
  const normalizedDbValue = normalizeCompareValue(dbValue);
  const normalizedFileValue = normalizeCompareValue(fileValue);
  if (!normalizedDbValue && !normalizedFileValue) return 'missingBoth';
  if (!normalizedDbValue) return 'missingDb';
  if (!normalizedFileValue) return 'missingFile';
  return normalizedDbValue === normalizedFileValue ? 'same' : 'different';
}

function formatFieldValue(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return fallback;
}

function countBatchDiffs(
  track: NativeLibraryTrackRecord,
  localTagResult: MusicTagReadLocalResult
): number {
  return BATCH_COMPARISON_FIELDS.filter((field) => {
    const state = compareValues(field.readTrackValue(track), localTagResult.metadata[field.key]);
    return state === 'different' || state === 'missingDb' || state === 'missingFile';
  }).length;
}

function normalizeLockFields(fields: readonly string[] | undefined): MusicTagMetadataFieldKey[] {
  if (!fields || fields.length === 0) return [];
  const allowed = new Set(LOCK_FIELD_OPTIONS.map((field) => field.key));
  const normalized: MusicTagMetadataFieldKey[] = [];
  for (const field of fields) {
    if (!allowed.has(field as MusicTagMetadataFieldKey)) continue;
    if (normalized.includes(field as MusicTagMetadataFieldKey)) continue;
    normalized.push(field as MusicTagMetadataFieldKey);
  }
  return normalized;
}

function metadataFromNativeTrack(
  track: NativeLibraryTrackRecord | null | undefined
): MusicTagCanonicalMetadata {
  if (!track) return {};
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    genre: track.genre,
    year: track.year,
    date: track.date,
    originalDate: track.originalDate,
    trackNumber: track.trackNumber,
    trackTotal: track.trackTotal,
    discNumber: track.discNumber,
    discTotal: track.discTotal,
    composer: track.composer,
    lyricist: track.lyricist,
    conductor: track.conductor,
    arranger: track.arranger,
    label: track.label,
    catalogNumber: track.catalogNumber,
    barcode: track.barcode,
    isrc: track.isrc,
    bpm: track.bpm,
    musicalKey: track.musicalKey,
    language: track.language,
    comment: track.comment,
    lyrics: track.lyrics,
    mbidRecording: track.mbidRecording,
    mbidRelease: track.mbidRelease,
    mbidReleaseGroup: track.mbidReleaseGroup,
    mbidArtist: track.mbidArtist,
    mbidAlbumArtist: track.mbidAlbumArtist,
    acoustid: track.acoustid,
  };
}

function metadataFromPlaybackTrack(track: Track | null): MusicTagCanonicalMetadata {
  if (!track) return {};
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    genre: track.genre,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    composer: track.composer,
    comment: track.comment,
    lyrics: track.lyrics,
  };
}

function mergeMetadata(
  primary: MusicTagCanonicalMetadata | null | undefined,
  fallback: MusicTagCanonicalMetadata
): MusicTagCanonicalMetadata {
  const merged: MusicTagCanonicalMetadata = { ...fallback };
  if (!primary) return merged;
  for (const [key, value] of Object.entries(primary) as [
    MusicTagMetadataFieldKey,
    MusicTagCanonicalMetadata[MusicTagMetadataFieldKey],
  ][]) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim().length === 0) continue;
    merged[key] = value as never;
  }
  return merged;
}

function hasAnyMetadata(metadata: MusicTagCanonicalMetadata | null | undefined): boolean {
  if (!metadata) return false;
  return Object.values(metadata).some((value) => hasMetadataValue(value));
}

function patchResultToTrack(
  track: NativeLibraryTrackRecord,
  result: MusicTagDbPatchResult
): NativeLibraryTrackRecord {
  const next: NativeLibraryTrackRecord = {
    ...track,
    tagSource: result.tagSource ?? undefined,
    tagConfidence: result.tagConfidence ?? undefined,
    tagUpdatedAtMs: result.tagUpdatedAtMs,
    tagLockedFields: result.lockedFields,
    tagLastAuditId: result.tagLastAuditId ?? undefined,
    updatedAtMs: result.tagUpdatedAtMs,
  };
  for (const change of result.changedFields) {
    const value = change.after;
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'undefined'
    ) {
      (next as unknown as Record<string, unknown>)[change.field] = value ?? undefined;
    }
  }
  return next;
}

export function MusicTagWorkbenchPage({ trackIds }: MusicTagWorkbenchPageProps) {
  const audioService = useAudioService();
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const navigation = useNavigation();
  const t = useT();
  const [track, setTrack] = useState<Track | null>(() => audioService.getState().currentTrack);
  const [localTagState, setLocalTagState] = useState<LocalTagReadState>('idle');
  const [localTagResult, setLocalTagResult] = useState<MusicTagReadLocalResult | null>(null);
  const [localTagError, setLocalTagError] = useState<string | null>(null);
  const [currentDbTrack, setCurrentDbTrack] = useState<NativeLibraryTrackRecord | null>(null);
  const [batchState, setBatchState] = useState<BatchPreviewState>('idle');
  const [batchRows, setBatchRows] = useState<BatchPreviewRow[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [selectedBatchTrackId, setSelectedBatchTrackId] = useState<string | null>(null);
  const [lockedFields, setLockedFields] = useState<MusicTagMetadataFieldKey[]>([]);
  const [dbPatchState, setDbPatchState] = useState<DbPatchState>('idle');
  const [dbPatchResult, setDbPatchResult] = useState<MusicTagDbPatchResult | null>(null);
  const [dbPatchError, setDbPatchError] = useState<string | null>(null);
  const [candidateState, setCandidateState] = useState<CandidateState>('idle');
  const [candidateResult, setCandidateResult] = useState<MusicTagCandidateSearchResult | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [includeNetworkCandidates, setIncludeNetworkCandidates] = useState(true);
  const [includeLyricsCandidates, setIncludeLyricsCandidates] = useState(true);
  const [acoustidFingerprint, setAcoustidFingerprint] = useState('');
  const [acoustidApiKey, setAcoustidApiKey] = useState('');
  const [chromaprintState, setChromaprintState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');

  const [manualEdits, setManualEdits] = useState<Partial<MusicTagCanonicalMetadata>>({});
  const [editingField, setEditingField] = useState<MusicTagMetadataFieldKey | null>(null);
  const [selectedPatchFields, setSelectedPatchFields] = useState<Set<MusicTagMetadataFieldKey>>(
    () => new Set(COMPARISON_FIELDS.map((f) => f.key))
  );
  const [writeFileState, setWriteFileState] = useState<WriteFileState>('idle');
  const [writeFileResult, setWriteFileResult] = useState<MusicTagWriteFileResult | null>(null);
  const [writeFileError, setWriteFileError] = useState<string | null>(null);
  const [coverArtState, setCoverArtState] = useState<CoverArtState>('idle');
  const [coverArtResult, setCoverArtResult] = useState<CoverArtSearchResult | null>(null);
  const [coverArtError, setCoverArtError] = useState<string | null>(null);
  const [selectedCoverArt, setSelectedCoverArt] = useState<CoverArtCandidate | null>(null);
  const [lyricsResolveResult, setLyricsResolveResult] = useState<NativeLyricResolveResult | null>(null);
  const [lyricsResolveState, setLyricsResolveState] = useState<'idle' | 'resolving' | 'ready' | 'error'>('idle');
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [batchApplyState, setBatchApplyState] = useState<'idle' | 'running' | 'done' | 'cancelled' | 'error'>('idle');
  const [batchApplyProgress, setBatchApplyProgress] = useState<MusicTagBatchProgressPayload | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (trackIds && trackIds.length > 0) return;
    setTrack(audioService.getState().currentTrack);
    return audioService.onStateChange((state) => {
      setTrack(state.currentTrack);
    });
  }, [audioService, trackIds]);

  useEffect(() => {
    if (!trackIds || trackIds.length === 0) return;
    let cancelled = false;
    void queryNativeLibraryTracksPage({
      limit: 1,
      offset: 0,
      includeMissing: true,
      visibleOnly: false,
      projection: 'full',
      trackId: trackIds[0],
    })
      .then((result) => {
        if (cancelled) return;
        const dbTrack = result.items[0] ?? null;
        setCurrentDbTrack(dbTrack);
        if (dbTrack) {
          setTrack({
            id: dbTrack.id,
            title: dbTrack.title,
            artist: dbTrack.artist,
            album: dbTrack.album,
            albumArtist: dbTrack.albumArtist,
            genre: dbTrack.genre,
            year: dbTrack.year,
            trackNumber: dbTrack.trackNumber,
            discNumber: dbTrack.discNumber,
            composer: dbTrack.composer,
            comment: dbTrack.comment,
            lyrics: dbTrack.lyrics,
            filePath: dbTrack.filePath,
            duration: dbTrack.durationSeconds,
          } as Track);
        }
      })
      .catch(() => {
        if (!cancelled) setCurrentDbTrack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trackIds]);

  const filePath = useMemo(() => readTrackFilePath(track), [track]);
  const hasLocalFile = isLocalFilePath(filePath);
  const hasLyrics = hasText(track?.lyrics);
  const empty = t('pages.musicTagWorkbench.emptyValue');
  const present = t('pages.musicTagWorkbench.value.present');

  useEffect(() => {
    setLocalTagState('idle');
    setLocalTagResult(null);
    setLocalTagError(null);
    setSelectedBatchTrackId(null);
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    const trackId = typeof track?.id === 'string' ? track.id.trim() : '';
    if (!trackId) {
      setCurrentDbTrack(null);
      return () => {
        cancelled = true;
      };
    }

    void queryNativeLibraryTracksPage({
      limit: 1,
      offset: 0,
      includeMissing: true,
      visibleOnly: false,
      projection: 'full',
      trackId,
    })
      .then((result) => {
        if (cancelled) return;
        setCurrentDbTrack(result.items[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setCurrentDbTrack(null);
      });

    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  const handleReadLocalTags = useCallback(async () => {
    if (!hasLocalFile || localTagState === 'loading') return;

    setLocalTagState('loading');
    setLocalTagError(null);
    try {
      const result = await readLocalMusicTags(filePath);
      if (!result) {
        setLocalTagResult(null);
        setLocalTagState('error');
        setLocalTagError('native-unavailable');
        return;
      }
      setLocalTagResult(result);
      setLocalTagState('ready');
    } catch (error) {
      setLocalTagResult(null);
      setLocalTagState('error');
      setLocalTagError(readErrorMessage(error));
    }
  }, [filePath, hasLocalFile, localTagState]);

  const loadBatchCandidates = useCallback(async (): Promise<BatchPreviewRow[]> => {
    if (batchState === 'loading' || batchState === 'running') return batchRows;

    setBatchState('loading');
    setBatchError(null);
    try {
      const result = await queryNativeLibraryTracksPage({
        limit: BATCH_PREVIEW_LIMIT,
        offset: 0,
        includeMissing: false,
        visibleOnly: true,
        projection: 'full',
        sort: [
          {
            field: 'updatedAtMs',
            order: 'desc',
          },
        ],
      });
      const rows = result.items
        .filter((item) => isLocalFilePath(readNativeTrackFilePath(item)))
        .map<BatchPreviewRow>((item) => ({
          track: item,
          state: 'pending',
          diffCount: null,
          fieldCount: null,
        }));

      setBatchRows(rows);
      setBatchTotal(result.total);
      setBatchState(rows.length > 0 ? 'ready' : 'idle');
      return rows;
    } catch (error) {
      setBatchRows([]);
      setBatchTotal(0);
      setBatchState('error');
      setBatchError(readErrorMessage(error));
      return [];
    }
  }, [batchRows, batchState]);

  const handleRunBatchPreview = useCallback(async () => {
    if (batchState === 'loading' || batchState === 'running') return;

    let rows = batchRows;
    if (rows.length === 0) {
      rows = await loadBatchCandidates();
    }
    if (rows.length === 0) return;

    const workingRows: BatchPreviewRow[] = rows.map((row) => ({
      ...row,
      state: 'pending' as BatchTrackState,
      diffCount: null,
      fieldCount: null,
      localTagResult: null,
      error: null,
    }));

    setBatchRows(workingRows);
    setBatchState('running');
    setBatchError(null);

    for (let index = 0; index < workingRows.length; index += 1) {
      const row = workingRows[index];
      const rowFilePath = readNativeTrackFilePath(row.track);
      if (!isLocalFilePath(rowFilePath)) {
        workingRows[index] = {
          ...row,
          state: 'skipped',
          error: 'not-local-file',
        };
        setBatchRows([...workingRows]);
        continue;
      }

      workingRows[index] = {
        ...row,
        state: 'reading',
      };
      setBatchRows([...workingRows]);

      try {
        const result = await readLocalMusicTags(rowFilePath);
        if (!result) {
          workingRows[index] = {
            ...row,
            state: 'error',
            diffCount: null,
            fieldCount: null,
            localTagResult: null,
            error: 'native-unavailable',
          };
        } else {
          workingRows[index] = {
            ...row,
            state: 'ready',
            diffCount: countBatchDiffs(row.track, result),
            fieldCount: result.fieldCount,
            localTagResult: result,
            format: result.format,
            error: null,
          };
        }
      } catch (error) {
        workingRows[index] = {
          ...row,
          state: 'error',
          diffCount: null,
          fieldCount: null,
          localTagResult: null,
          error: readErrorMessage(error),
        };
      }
      setBatchRows([...workingRows]);
    }

    setBatchState('done');
  }, [batchRows, batchState, loadBatchCandidates]);

  const selectedBatchRow = useMemo(
    () => batchRows.find((row) => row.track.id === selectedBatchTrackId) ?? null,
    [batchRows, selectedBatchTrackId]
  );
  const activeDbTrack = selectedBatchRow?.track ?? currentDbTrack;
  const activeLocalTagResult = selectedBatchRow ? selectedBatchRow.localTagResult ?? null : localTagResult;
  const activeSeedMetadata = useMemo(
    () =>
      mergeMetadata(
        activeLocalTagResult?.metadata,
        mergeMetadata(metadataFromNativeTrack(activeDbTrack), metadataFromPlaybackTrack(track))
      ),
    [activeDbTrack, activeLocalTagResult, track]
  );
  const selectedCandidate = useMemo(
    () =>
      candidateResult?.candidates.find((candidate) => candidate.id === selectedCandidateId) ??
      null,
    [candidateResult, selectedCandidateId]
  );
  const activeSourceMetadata = useMemo(() => {
    const base = selectedCandidate?.metadata ?? activeLocalTagResult?.metadata ?? null;
    if (!base && !Object.keys(manualEdits).length) return null;
    return mergeMetadata(manualEdits as MusicTagCanonicalMetadata, base ?? {});
  }, [activeLocalTagResult?.metadata, manualEdits, selectedCandidate?.metadata]);
  const canPreviewDbPatch = Boolean(activeDbTrack?.id && activeSourceMetadata && hasAnyMetadata(activeSourceMetadata));
  const canSearchCandidates = Boolean(activeDbTrack?.id && hasAnyMetadata(activeSeedMetadata));
  const activeDbTrackLockedFieldsKey = activeDbTrack?.tagLockedFields?.join('|') ?? '';
  const lockedFieldsKey = lockedFields.join('|');
  const activeDbTrackLockedFields = useMemo(
    () =>
      normalizeLockFields(
        activeDbTrackLockedFieldsKey ? activeDbTrackLockedFieldsKey.split('|') : []
      ),
    [activeDbTrackLockedFieldsKey]
  );

  useEffect(() => {
    setLockedFields(activeDbTrackLockedFields);
    setDbPatchState('idle');
    setDbPatchResult(null);
    setDbPatchError(null);
    setCandidateState('idle');
    setCandidateResult(null);
    setCandidateError(null);
    setSelectedCandidateId(null);
  }, [activeDbTrack?.id, activeDbTrackLockedFields]);

  useEffect(() => {
    setDbPatchState('idle');
    setDbPatchResult(null);
    setDbPatchError(null);
  }, [activeLocalTagResult?.readAtMs, selectedCandidateId, lockedFieldsKey]);

  const buildDbPatchRequest = useCallback((): MusicTagDbPatchRequest | null => {
    if (!activeDbTrack?.id || !activeSourceMetadata || !hasAnyMetadata(activeSourceMetadata)) {
      return null;
    }
    const filteredMetadata: MusicTagCanonicalMetadata = {};
    for (const field of selectedPatchFields) {
      const value = activeSourceMetadata[field];
      if (value !== undefined && value !== null) {
        (filteredMetadata as Record<string, unknown>)[field] = value;
      }
    }
    if (!hasAnyMetadata(filteredMetadata)) return null;
    return {
      trackId: activeDbTrack.id,
      sourceMetadata: filteredMetadata,
      selectedCandidateIds: selectedCandidate ? [selectedCandidate.id] : [],
      lockedFields,
      lockMode: 'replace',
      tagSource: Object.keys(manualEdits).length > 0 ? 'manual' : (selectedCandidate?.provider ?? 'local-tags'),
      tagConfidence: selectedCandidate?.score ?? 0.78,
      expectedMtimeMs: activeLocalTagResult?.mtimeMs ?? activeDbTrack.mtimeMs,
    };
  }, [activeDbTrack, activeLocalTagResult, activeSourceMetadata, lockedFields, manualEdits, selectedCandidate, selectedPatchFields]);

  const handlePreviewDbPatch = useCallback(async () => {
    const request = buildDbPatchRequest();
    if (!request || dbPatchState === 'previewing' || dbPatchState === 'applying') return;
    setDbPatchState('previewing');
    setDbPatchError(null);
    try {
      const result = await previewMusicTagDbPatch(request);
      if (!result) {
        setDbPatchResult(null);
        setDbPatchState('error');
        setDbPatchError('native-unavailable');
        return;
      }
      setDbPatchResult(result);
      setDbPatchState('ready');
    } catch (error) {
      setDbPatchResult(null);
      setDbPatchState('error');
      setDbPatchError(readErrorMessage(error));
    }
  }, [buildDbPatchRequest, dbPatchState]);

  const handleApplyDbPatch = useCallback(async () => {
    const request = buildDbPatchRequest();
    if (!request || dbPatchState === 'previewing' || dbPatchState === 'applying') return;
    setDbPatchState('applying');
    setDbPatchError(null);
    try {
      const result = await applyMusicTagDbPatch(request);
      if (!result) {
        setDbPatchResult(null);
        setDbPatchState('error');
        setDbPatchError('native-unavailable');
        return;
      }
      setDbPatchResult(result);
      setDbPatchState(result.applied ? 'applied' : 'ready');
      if (result.applied && activeDbTrack) {
        const updatedTrack = patchResultToTrack(activeDbTrack, result);
        if (selectedBatchRow) {
          setBatchRows((rows) =>
            rows.map((row) =>
              row.track.id === updatedTrack.id
                ? {
                    ...row,
                    track: updatedTrack,
                  }
                : row
            )
          );
        } else {
          setCurrentDbTrack(updatedTrack);
        }
        void broadcastDataUpdate('music-tag-workbench:track-updated', {
          trackId: activeDbTrack.id,
          changedFields: result.changedFields.map((c) => c.field),
        });
      }
    } catch (error) {
      setDbPatchState('error');
      setDbPatchError(readErrorMessage(error));
    }
  }, [activeDbTrack, buildDbPatchRequest, dbPatchState, selectedBatchRow]);

  const handleGenerateChromaprint = useCallback(async () => {
    if (!activeDbTrack || chromaprintState === 'generating') return;
    const filePath = readNativeTrackFilePath(activeDbTrack);
    if (!filePath) return;
    setChromaprintState('generating');
    try {
      const result = await generateChromaprint(filePath);
      if (result) {
        setAcoustidFingerprint(result.fingerprint);
        setChromaprintState('ready');
      } else {
        setChromaprintState('error');
      }
    } catch {
      setChromaprintState('error');
    }
  }, [activeDbTrack, chromaprintState]);

  const handleResolveLyrics = useCallback(async () => {
    if (!activeDbTrack || lyricsResolveState === 'resolving') return;
    setLyricsResolveState('resolving');
    setLyricsExpanded(false);
    try {
      const result = await resolveNativeLibraryLyrics({
        trackId: activeDbTrack.id,
        trackFilePath: readNativeTrackFilePath(activeDbTrack),
        quickFingerprint: activeDbTrack.quickFingerprint,
        title: activeDbTrack.title ?? undefined,
        artist: activeDbTrack.artist ?? undefined,
        durationSeconds: activeDbTrack.durationSeconds ?? undefined,
        embeddedLyrics: activeLocalTagResult?.metadata.lyrics ?? activeDbTrack.lyrics ?? undefined,
      });
      if (result) {
        setLyricsResolveResult(result);
        setLyricsResolveState('ready');
      } else {
        setLyricsResolveState('error');
      }
    } catch {
      setLyricsResolveState('error');
    }
  }, [activeDbTrack, activeLocalTagResult, lyricsResolveState]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<MusicTagBatchProgressPayload>('music-tag-batch-progress', (event) => {
      setBatchApplyProgress(event.payload);
      if (event.payload.status === 'done') {
        setBatchApplyState('done');
        broadcastDataUpdate('music-library', 'batch-apply');
      } else if (event.payload.status === 'cancelled') {
        setBatchApplyState('cancelled');
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleBatchApplyDb = useCallback(async () => {
    if (batchApplyState === 'running') return;
    const readyRows = batchRows.filter((r) => r.state === 'ready' && (r.diffCount ?? 0) > 0);
    if (readyRows.length === 0) return;
    setBatchApplyState('running');
    setBatchApplyProgress(null);
    try {
      await startMusicTagBatch({
        mode: 'apply-db',
        items: readyRows.map((row) => ({
          trackId: row.track.id,
          filePath: readNativeTrackFilePath(row.track),
          sourceMetadata: row.localTagResult!.metadata,
          lockedFields: [],
          tagSource: 'local-tags',
          tagConfidence: 0.78,
          expectedMtimeMs: row.track.mtimeMs ?? 0,
        })),
      });
    } catch {
      setBatchApplyState('error');
    }
  }, [batchApplyState, batchRows]);

  const handleBatchWriteFiles = useCallback(async () => {
    if (batchApplyState === 'running') return;
    const readyRows = batchRows.filter((r) => r.state === 'ready' && (r.diffCount ?? 0) > 0);
    if (readyRows.length === 0) return;
    setBatchApplyState('running');
    setBatchApplyProgress(null);
    try {
      await startMusicTagBatch({
        mode: 'write-file',
        items: readyRows.map((row) => ({
          trackId: row.track.id,
          filePath: readNativeTrackFilePath(row.track),
          sourceMetadata: row.localTagResult!.metadata,
          lockedFields: [],
          tagSource: 'local-tags',
          tagConfidence: 0.78,
          expectedMtimeMs: row.track.mtimeMs ?? 0,
        })),
      });
    } catch {
      setBatchApplyState('error');
    }
  }, [batchApplyState, batchRows]);

  const handleBatchCancel = useCallback(async () => {
    await cancelMusicTagBatch();
  }, []);

  const handleSearchCandidates = useCallback(async () => {
    if (!activeDbTrack || candidateState === 'searching') return;
    setCandidateState('searching');
    setCandidateError(null);
    setSelectedCandidateId(null);
    try {
      const result = await searchMusicTagCandidates({
        trackId: activeDbTrack.id,
        filePath: readNativeTrackFilePath(activeDbTrack),
        quickFingerprint: activeDbTrack.quickFingerprint,
        title: activeSeedMetadata.title ?? activeDbTrack.title ?? track?.title,
        artist: activeSeedMetadata.artist ?? activeDbTrack.artist ?? track?.artist,
        album: activeSeedMetadata.album ?? activeDbTrack.album ?? track?.album,
        durationSeconds: activeDbTrack.durationSeconds ?? track?.duration,
        metadata: activeSeedMetadata,
        embeddedLyrics: activeLocalTagResult?.metadata.lyrics ?? activeDbTrack.lyrics ?? track?.lyrics,
        language: activeSeedMetadata.language ?? undefined,
        acoustidFingerprint: acoustidFingerprint.trim() || undefined,
        acoustidApiKey: acoustidApiKey.trim() || undefined,
        limit: 8,
        includeNetwork: includeNetworkCandidates,
        includeLyrics: includeLyricsCandidates,
      });
      if (!result) {
        setCandidateResult(null);
        setCandidateState('error');
        setCandidateError('native-unavailable');
        return;
      }
      setCandidateResult(result);
      setSelectedCandidateId(result.candidates[0]?.id ?? null);
      setCandidateState('ready');
    } catch (error) {
      setCandidateResult(null);
      setCandidateState('error');
      setCandidateError(readErrorMessage(error));
    }
  }, [
    activeDbTrack,
    activeLocalTagResult,
    activeSeedMetadata,
    acoustidApiKey,
    acoustidFingerprint,
    candidateState,
    includeLyricsCandidates,
    includeNetworkCandidates,
    track,
  ]);

  const toggleLockedField = useCallback((field: MusicTagMetadataFieldKey) => {
    setLockedFields((fields) =>
      fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field]
    );
  }, []);

  const handleManualEdit = useCallback((field: MusicTagMetadataFieldKey, value: string) => {
    setManualEdits((prev) => ({ ...prev, [field]: value.trim() || undefined }));
    setEditingField(null);
  }, []);

  const handleStartEdit = useCallback((field: MusicTagMetadataFieldKey) => {
    setEditingField(field);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, []);

  const togglePatchField = useCallback((field: MusicTagMetadataFieldKey) => {
    setSelectedPatchFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }
      return next;
    });
  }, []);

  const selectAllPatchFields = useCallback(() => {
    setSelectedPatchFields(new Set(COMPARISON_FIELDS.map((f) => f.key)));
  }, []);

  const deselectAllPatchFields = useCallback(() => {
    setSelectedPatchFields(new Set());
  }, []);

  const handleSearchCoverArt = useCallback(async () => {
    const mbidRelease = activeSourceMetadata?.mbidRelease ?? activeDbTrack?.mbidRelease;
    if (!mbidRelease || coverArtState === 'searching') return;
    setCoverArtState('searching');
    setCoverArtError(null);
    setSelectedCoverArt(null);
    try {
      const result = await searchCoverArtCandidates({
        mbidRelease,
        trackId: activeDbTrack?.id,
      });
      if (!result) {
        setCoverArtResult(null);
        setCoverArtState('error');
        setCoverArtError('native-unavailable');
        return;
      }
      setCoverArtResult(result);
      setCoverArtState('ready');
      if (result.candidates.length > 0) {
        setSelectedCoverArt(result.candidates[0]);
      }
    } catch (error) {
      setCoverArtResult(null);
      setCoverArtState('error');
      setCoverArtError(readErrorMessage(error));
    }
  }, [activeDbTrack, activeSourceMetadata?.mbidRelease, coverArtState]);

  const handleWriteFileTags = useCallback(async () => {
    if (!activeDbTrack || !activeSourceMetadata || writeFileState === 'writing') return;
    const activeFilePath = readNativeTrackFilePath(activeDbTrack);
    if (!isLocalFilePath(activeFilePath)) return;

    const filteredMetadata: MusicTagCanonicalMetadata = {};
    for (const field of selectedPatchFields) {
      const value = activeSourceMetadata[field];
      if (value !== undefined && value !== null) {
        (filteredMetadata as Record<string, unknown>)[field] = value;
      }
    }
    if (!hasAnyMetadata(filteredMetadata)) return;

    setWriteFileState('writing');
    setWriteFileError(null);
    try {
      const result = await writeMusicTagFileTags({
        filePath: activeFilePath,
        metadata: filteredMetadata,
        expectedMtimeMs: activeLocalTagResult?.mtimeMs ?? activeDbTrack.mtimeMs ?? 0,
        writeCover: Boolean(selectedCoverArt),
        coverDataBase64: selectedCoverArt?.thumbnailUrl ?? undefined,
        coverMimeType: 'image/jpeg',
      });
      if (!result) {
        setWriteFileState('error');
        setWriteFileError('native-unavailable');
        return;
      }
      setWriteFileResult(result);
      setWriteFileState('done');
      void broadcastDataUpdate('music-tag-workbench:file-written', {
        trackId: activeDbTrack.id,
        filePath: activeFilePath,
        fieldsWritten: result.fieldsWritten,
      });
      if (result.verified) {
        const refreshed = await readLocalMusicTags(activeFilePath);
        if (refreshed) {
          setLocalTagResult(refreshed);
          setLocalTagState('ready');
        }
      }
    } catch (error) {
      setWriteFileState('error');
      setWriteFileError(readErrorMessage(error));
    }
  }, [activeDbTrack, activeLocalTagResult, activeSourceMetadata, selectedCoverArt, selectedPatchFields, writeFileState]);

  const metadataRows = useMemo(
    () => [
      {
        key: 'title',
        label: t('pages.musicTagWorkbench.fields.title'),
        value: formatFieldValue(track?.title, empty),
      },
      {
        key: 'artist',
        label: t('pages.musicTagWorkbench.fields.artist'),
        value: formatFieldValue(track?.artist, t('common.unknown.artist')),
      },
      {
        key: 'album',
        label: t('pages.musicTagWorkbench.fields.album'),
        value: formatFieldValue(track?.album, t('common.unknown.album')),
      },
      {
        key: 'albumArtist',
        label: t('pages.musicTagWorkbench.fields.albumArtist'),
        value: formatFieldValue(track?.albumArtist, empty),
      },
      {
        key: 'genre',
        label: t('pages.musicTagWorkbench.fields.genre'),
        value: formatFieldValue(track?.genre, empty),
      },
      {
        key: 'year',
        label: t('pages.musicTagWorkbench.fields.year'),
        value: formatFieldValue(track?.year, empty),
      },
      {
        key: 'file',
        label: t('pages.musicTagWorkbench.fields.file'),
        value: formatFieldValue(filePath, empty),
      },
    ],
    [empty, filePath, t, track]
  );

  const comparisonRows = useMemo(
    () =>
      COMPARISON_FIELDS.map((field) => {
        const dbRawValue = field.readTrackValue(track);
        const fileRawValue = localTagResult?.metadata[field.key];
        const state = compareValues(dbRawValue, fileRawValue);
        const dbValue =
          field.isLongText && hasMetadataValue(dbRawValue)
            ? present
            : formatFieldValue(dbRawValue, empty);
        const fileValue =
          field.isLongText && hasMetadataValue(fileRawValue)
            ? present
            : formatFieldValue(fileRawValue, empty);

        return {
          key: field.key,
          label: t(field.labelKey),
          dbValue,
          fileValue,
          state,
          stateLabel: t(`pages.musicTagWorkbench.diff.${state}`),
        };
      }),
    [empty, localTagResult, present, t, track]
  );

  const diffFieldCount = useMemo(
    () =>
      comparisonRows.filter(
        (row) =>
          row.state === 'different' || row.state === 'missingDb' || row.state === 'missingFile'
      ).length,
    [comparisonRows]
  );

  const batchSummary = useMemo(() => {
    const readyCount = batchRows.filter((row) => row.state === 'ready').length;
    const errorCount = batchRows.filter((row) => row.state === 'error').length;
    const pendingCount = batchRows.filter((row) => row.state === 'pending').length;
    const diffTrackCount = batchRows.filter((row) => (row.diffCount ?? 0) > 0).length;
    const diffFieldCount = batchRows.reduce((sum, row) => sum + (row.diffCount ?? 0), 0);
    return {
      readyCount,
      errorCount,
      pendingCount,
      diffTrackCount,
      diffFieldCount,
    };
  }, [batchRows]);

  const localTagStageStateKey =
    localTagState === 'loading'
      ? 'pages.musicTagWorkbench.stageState.reading'
      : localTagState === 'ready'
        ? 'pages.musicTagWorkbench.stageState.read'
        : localTagState === 'error'
          ? 'pages.musicTagWorkbench.stageState.failed'
          : hasLocalFile
            ? 'pages.musicTagWorkbench.stageState.ready'
            : 'pages.musicTagWorkbench.stageState.waitingForTrack';

  const stages: WorkbenchStage[] = useMemo(
    () => [
      {
        id: 'local-tags',
        labelKey: 'pages.musicTagWorkbench.stage.localTags',
        stateKey: localTagStageStateKey,
        Icon: FileAudio,
        isReady: hasLocalFile || localTagState === 'ready',
      },
      {
        id: 'library-db',
        labelKey: 'pages.musicTagWorkbench.stage.libraryDb',
        stateKey: track?.id
          ? 'pages.musicTagWorkbench.stageState.ready'
          : 'pages.musicTagWorkbench.stageState.waitingForTrack',
        Icon: Database,
        isReady: Boolean(track?.id),
      },
      {
        id: 'candidates',
        labelKey: 'pages.musicTagWorkbench.stage.candidates',
        stateKey:
          candidateState === 'searching'
            ? 'pages.musicTagWorkbench.stageState.searching'
            : candidateState === 'ready'
              ? 'pages.musicTagWorkbench.stageState.ready'
              : candidateState === 'error'
                ? 'pages.musicTagWorkbench.stageState.failed'
                : 'pages.musicTagWorkbench.stageState.pending',
        Icon: Search,
        isReady: candidateState === 'ready' && (candidateResult?.candidates.length ?? 0) > 0,
      },
      {
        id: 'lyrics',
        labelKey: 'pages.musicTagWorkbench.stage.lyrics',
        stateKey:
          candidateResult?.lyricsResolution?.hasSelected || hasLyrics
            ? 'pages.musicTagWorkbench.stageState.ready'
            : 'pages.musicTagWorkbench.stageState.pending',
        Icon: TextQuote,
        isReady: Boolean(candidateResult?.lyricsResolution?.hasSelected || hasLyrics),
      },
    ],
    [
      candidateResult?.candidates.length,
      candidateResult?.lyricsResolution?.hasSelected,
      candidateState,
      hasLocalFile,
      hasLyrics,
      localTagStageStateKey,
      localTagState,
      track?.id,
    ]
  );

  const openMusicLibrary = useCallback(() => {
    void dispatchCommandOrFallback(commands, 'app:navigate-music-library', () =>
      navigation.navigateTo('music-library')
    );
  }, [commands, navigation]);

  const localReadStatusText =
    localTagState === 'loading'
      ? t('pages.musicTagWorkbench.localRead.loading')
      : localTagState === 'ready'
        ? t('pages.musicTagWorkbench.localRead.ready', {
            count: localTagResult?.fieldCount ?? 0,
          })
        : localTagState === 'error'
          ? t('pages.musicTagWorkbench.localRead.failed')
          : hasLocalFile
            ? t('pages.musicTagWorkbench.localRead.idle')
            : t('pages.musicTagWorkbench.localRead.requiresLocalFile');

  const localDiffStateText =
    localTagState === 'ready'
      ? t('pages.musicTagWorkbench.diff.ready', { count: diffFieldCount })
      : localTagState === 'loading'
        ? t('pages.musicTagWorkbench.stageState.reading')
        : localTagState === 'error'
          ? t('pages.musicTagWorkbench.stageState.failed')
        : t('pages.musicTagWorkbench.stageState.pending');

  const batchStatusText =
    batchState === 'loading'
      ? t('pages.musicTagWorkbench.batch.loading')
      : batchState === 'running'
        ? t('pages.musicTagWorkbench.batch.running', {
            current: batchSummary.readyCount + batchSummary.errorCount,
            total: batchRows.length,
          })
        : batchState === 'done'
          ? t('pages.musicTagWorkbench.batch.done', {
              tracks: batchSummary.diffTrackCount,
              fields: batchSummary.diffFieldCount,
            })
          : batchState === 'error'
            ? t('pages.musicTagWorkbench.batch.failed')
            : batchRows.length > 0
              ? t('pages.musicTagWorkbench.batch.ready', {
                  count: batchRows.length,
                })
              : t('pages.musicTagWorkbench.batch.empty');

  const activeTargetTitle = formatFieldValue(
    activeDbTrack?.title ?? track?.title,
    t('pages.musicTagWorkbench.noTrackTitle')
  );
  const activeTargetArtist = formatFieldValue(
    activeDbTrack?.artist ?? track?.artist,
    activeDbTrack || track ? t('common.unknown.artist') : t('pages.musicTagWorkbench.noTrackArtist')
  );
  const candidateStatusText =
    candidateState === 'searching'
      ? t('pages.musicTagWorkbench.candidates.searching')
      : candidateState === 'ready'
        ? t('pages.musicTagWorkbench.candidates.ready', {
            count: candidateResult?.candidates.length ?? 0,
          })
        : candidateState === 'error'
          ? t('pages.musicTagWorkbench.candidates.failed')
          : t('pages.musicTagWorkbench.candidates.idle');
  const dbPatchStatusText =
    dbPatchState === 'previewing'
      ? t('pages.musicTagWorkbench.dbPatch.previewing')
      : dbPatchState === 'applying'
        ? t('pages.musicTagWorkbench.dbPatch.applying')
        : dbPatchState === 'applied'
          ? t('pages.musicTagWorkbench.dbPatch.applied', {
              count: dbPatchResult?.changedFields.length ?? 0,
            })
          : dbPatchState === 'ready'
            ? t('pages.musicTagWorkbench.dbPatch.ready', {
                count: dbPatchResult?.changedFields.length ?? 0,
              })
            : dbPatchState === 'error'
              ? t('pages.musicTagWorkbench.dbPatch.failed')
              : t('pages.musicTagWorkbench.dbPatch.idle');

  const title = hasText(track?.title) ? track!.title : t('pages.musicTagWorkbench.noTrackTitle');
  const artist = hasText(track?.artist)
    ? track!.artist
    : track
      ? t('common.unknown.artist')
      : t('pages.musicTagWorkbench.noTrackArtist');

  return (
    <main className="music-tag-workbench-page">
      <header className="music-tag-workbench-page__header">
        <div className="music-tag-workbench-page__heading">
          <span className="music-tag-workbench-page__icon" aria-hidden="true">
            <Tags size={22} />
          </span>
          <div>
            <h1>{t('pages.musicTagWorkbench.title')}</h1>
            <span>{t('pages.musicTagWorkbench.phase')}</span>
          </div>
        </div>
        <button type="button" className="music-tag-workbench-page__libraryButton" onClick={openMusicLibrary}>
          <Library size={16} aria-hidden="true" />
          <span>{t('pages.musicTagWorkbench.action.openLibrary')}</span>
        </button>
      </header>

      <section className="music-tag-workbench-page__trackBand" aria-label={t('pages.musicTagWorkbench.currentTrack')}>
        <Music2 size={24} aria-hidden="true" />
        <div className="music-tag-workbench-page__trackText">
          <span className="music-tag-workbench-page__trackTitle" title={title}>
            {title}
          </span>
          <span className="music-tag-workbench-page__trackArtist" title={artist}>
            {artist}
          </span>
        </div>
        <div className="music-tag-workbench-page__trackState">
          <BadgeCheck size={16} aria-hidden="true" />
          <span>
            {track
              ? t('pages.musicTagWorkbench.trackState.selected')
              : t('pages.musicTagWorkbench.trackState.empty')}
          </span>
        </div>
      </section>

      <section className="music-tag-workbench-page__stageGrid" aria-label={t('pages.musicTagWorkbench.stageGrid')}>
        {stages.map(({ id, labelKey, stateKey, Icon, isReady }) => (
          <div key={id} className={`music-tag-workbench-page__stage ${isReady ? 'is-ready' : ''}`}>
            <Icon size={18} aria-hidden="true" />
            <span className="music-tag-workbench-page__stageLabel">{t(labelKey)}</span>
            <span className="music-tag-workbench-page__stageState">{t(stateKey)}</span>
          </div>
        ))}
      </section>

      <div className="music-tag-workbench-page__body">
        <section className="music-tag-workbench-page__panel" aria-label={t('pages.musicTagWorkbench.metadataPanel')}>
          <div className="music-tag-workbench-page__panelHeader">
            <h2>{t('pages.musicTagWorkbench.metadataPanel')}</h2>
            <button
              type="button"
              disabled={!hasLocalFile || localTagState === 'loading'}
              title={
                hasLocalFile
                  ? t('pages.musicTagWorkbench.action.readLocalTags')
                  : t('pages.musicTagWorkbench.localRead.requiresLocalFile')
              }
              onClick={handleReadLocalTags}
            >
              {localTagState === 'loading' ? (
                <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
              ) : (
                <FileAudio size={15} aria-hidden="true" />
              )}
              <span>
                {localTagState === 'ready'
                  ? t('pages.musicTagWorkbench.action.refreshLocalTags')
                  : t('pages.musicTagWorkbench.action.readLocalTags')}
              </span>
            </button>
          </div>
          <div className={`music-tag-workbench-page__readNotice is-${localTagState}`}>
            {localTagState === 'error' ? (
              <AlertCircle size={15} aria-hidden="true" />
            ) : (
              <FileAudio size={15} aria-hidden="true" />
            )}
            <span title={localTagError ?? undefined}>{localReadStatusText}</span>
            {localTagResult?.format ? <strong>{localTagResult.format}</strong> : null}
          </div>
          {localTagState === 'ready' && localTagResult ? (
            <div className="music-tag-workbench-page__comparisonTable">
              <div className="music-tag-workbench-page__comparisonHead">
                <span>{t('pages.musicTagWorkbench.compare.field')}</span>
                <span>{t('pages.musicTagWorkbench.compare.library')}</span>
                <span>{t('pages.musicTagWorkbench.compare.file')}</span>
                <span>{t('pages.musicTagWorkbench.compare.status')}</span>
              </div>
              {comparisonRows.map((row) => (
                <div key={row.key} className={`music-tag-workbench-page__comparisonRow is-${row.state}`}>
                  <span>{row.label}</span>
                  <strong title={row.dbValue}>{row.dbValue}</strong>
                  {editingField === row.key ? (
                    <input
                      ref={editInputRef}
                      className="music-tag-workbench-page__inlineEdit"
                      defaultValue={
                        (manualEdits[row.key] as string | undefined) ?? row.fileValue === empty ? '' : row.fileValue
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleManualEdit(row.key, e.currentTarget.value);
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                      onBlur={(e) => handleManualEdit(row.key, e.currentTarget.value)}
                    />
                  ) : (
                    <strong
                      className="music-tag-workbench-page__editableField"
                      title={`${row.fileValue} — ${t('pages.musicTagWorkbench.edit.clickToEdit')}`}
                      onClick={() => handleStartEdit(row.key)}
                    >
                      {manualEdits[row.key] != null
                        ? formatFieldValue(manualEdits[row.key], empty)
                        : row.fileValue}
                      <Pencil size={12} aria-hidden="true" />
                    </strong>
                  )}
                  <em>{row.stateLabel}</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="music-tag-workbench-page__fieldTable">
              {metadataRows.map((row) => (
                <div key={row.key} className="music-tag-workbench-page__fieldRow">
                  <span>{row.label}</span>
                  {row.key !== 'file' && editingField === row.key ? (
                    <input
                      ref={editInputRef}
                      className="music-tag-workbench-page__inlineEdit"
                      defaultValue={
                        (manualEdits[row.key as MusicTagMetadataFieldKey] as string | undefined) ?? (row.value === empty ? '' : row.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleManualEdit(row.key as MusicTagMetadataFieldKey, e.currentTarget.value);
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                      onBlur={(e) => handleManualEdit(row.key as MusicTagMetadataFieldKey, e.currentTarget.value)}
                    />
                  ) : row.key !== 'file' ? (
                    <strong
                      className="music-tag-workbench-page__editableField"
                      title={`${row.value} — ${t('pages.musicTagWorkbench.edit.clickToEdit')}`}
                      onClick={() => handleStartEdit(row.key as MusicTagMetadataFieldKey)}
                    >
                      {manualEdits[row.key as MusicTagMetadataFieldKey] != null
                        ? formatFieldValue(manualEdits[row.key as MusicTagMetadataFieldKey], empty)
                        : row.value}
                      <Pencil size={12} aria-hidden="true" />
                    </strong>
                  ) : (
                    <strong title={row.value}>{row.value}</strong>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="music-tag-workbench-page__panel" aria-label={t('pages.musicTagWorkbench.queuePanel')}>
          <div className="music-tag-workbench-page__panelHeader">
            <h2>{t('pages.musicTagWorkbench.queuePanel')}</h2>
            <div className="music-tag-workbench-page__panelActions">
              <button
                type="button"
                disabled={!canSearchCandidates || candidateState === 'searching'}
                title={
                  canSearchCandidates
                    ? t('pages.musicTagWorkbench.action.searchCandidates')
                    : t('pages.musicTagWorkbench.candidates.requiresTarget')
                }
                onClick={() => {
                  void handleSearchCandidates();
                }}
              >
                {candidateState === 'searching' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Search size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.searchCandidates')}</span>
              </button>
              <button
                type="button"
                disabled={batchState === 'loading' || batchState === 'running'}
                title={t('pages.musicTagWorkbench.action.loadBatch')}
                onClick={() => {
                  void loadBatchCandidates();
                }}
              >
                {batchState === 'loading' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Database size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.loadBatch')}</span>
              </button>
              <button
                type="button"
                disabled={batchState === 'loading' || batchState === 'running'}
                title={t('pages.musicTagWorkbench.action.runBatchPreview')}
                onClick={() => {
                  void handleRunBatchPreview();
                }}
              >
                {batchState === 'running' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <ListChecks size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.runBatchPreview')}</span>
              </button>
            </div>
          </div>
          <div className="music-tag-workbench-page__targetStrip">
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <span>{t('pages.musicTagWorkbench.target.label')}</span>
              <strong title={`${activeTargetTitle} - ${activeTargetArtist}`}>
                {selectedBatchRow
                  ? t('pages.musicTagWorkbench.target.batch', {
                      title: activeTargetTitle,
                      artist: activeTargetArtist,
                    })
                  : t('pages.musicTagWorkbench.target.current', {
                      title: activeTargetTitle,
                      artist: activeTargetArtist,
                    })}
              </strong>
            </div>
          </div>
          <div className="music-tag-workbench-page__candidateControls">
            <label>
              <input
                type="checkbox"
                checked={includeNetworkCandidates}
                onChange={(event) => setIncludeNetworkCandidates(event.currentTarget.checked)}
              />
              <span>{t('pages.musicTagWorkbench.candidates.includeNetwork')}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeLyricsCandidates}
                onChange={(event) => setIncludeLyricsCandidates(event.currentTarget.checked)}
              />
              <span>{t('pages.musicTagWorkbench.candidates.includeLyrics')}</span>
            </label>
          </div>
          <div className="music-tag-workbench-page__candidateInputs">
            <label>
              <span>{t('pages.musicTagWorkbench.candidates.chromaprint')}</span>
              <div className="music-tag-workbench-page__chromaprintRow">
                <input
                  value={acoustidFingerprint}
                  placeholder={t('pages.musicTagWorkbench.candidates.chromaprintPlaceholder')}
                  onChange={(event) => setAcoustidFingerprint(event.currentTarget.value)}
                />
                <button
                  type="button"
                  className="music-tag-workbench-page__chromaprintGenerate"
                  disabled={!activeDbTrack || chromaprintState === 'generating'}
                  onClick={handleGenerateChromaprint}
                  title={t('pages.musicTagWorkbench.chromaprint.generate')}
                >
                  {chromaprintState === 'generating' ? (
                    <Loader2 size={14} className="music-tag-workbench-page__spinner" aria-hidden="true" />
                  ) : (
                    <Music2 size={14} aria-hidden="true" />
                  )}
                  {t('pages.musicTagWorkbench.chromaprint.generate')}
                </button>
              </div>
            </label>
            <label>
              <span>{t('pages.musicTagWorkbench.candidates.acoustidApiKey')}</span>
              <input
                type="password"
                value={acoustidApiKey}
                placeholder={t('pages.musicTagWorkbench.candidates.apiKeyPlaceholder')}
                onChange={(event) => setAcoustidApiKey(event.currentTarget.value)}
              />
            </label>
          </div>
          <div className="music-tag-workbench-page__queue">
            <div className="music-tag-workbench-page__queueItem">
              <ListChecks size={18} aria-hidden="true" />
              <span>{t('pages.musicTagWorkbench.queue.batchDiff')}</span>
              <strong title={batchError ?? undefined}>{batchStatusText}</strong>
            </div>
            <div className="music-tag-workbench-page__queueItem">
              <Network size={18} aria-hidden="true" />
              <span>{t('pages.musicTagWorkbench.queue.networkCandidates')}</span>
              <strong title={candidateError ?? undefined}>{candidateStatusText}</strong>
            </div>
            <div className="music-tag-workbench-page__queueItem">
              <Database size={18} aria-hidden="true" />
              <span>{t('pages.musicTagWorkbench.queue.applyAudit')}</span>
              <strong title={dbPatchError ?? undefined}>{dbPatchStatusText}</strong>
            </div>
          </div>
          {candidateResult?.warnings.length ? (
            <div className="music-tag-workbench-page__warningList">
              {candidateResult.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
          {candidateResult?.candidates.length ? (
            <div className="music-tag-workbench-page__candidateList">
              {candidateResult.candidates.slice(0, 6).map((candidate) => {
                const candidateTitle = formatFieldValue(
                  candidate.metadata.title,
                  t('pages.musicTagWorkbench.noTrackTitle')
                );
                const candidateArtist = formatFieldValue(
                  candidate.metadata.artist,
                  t('common.unknown.artist')
                );
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`music-tag-workbench-page__candidateRow ${
                      selectedCandidateId === candidate.id ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedCandidateId(candidate.id)}
                  >
                    <span>{t(`pages.musicTagWorkbench.candidates.provider.${candidate.provider}`)}</span>
                    <strong title={`${candidateTitle} - ${candidateArtist}`}>
                      {candidateTitle}
                    </strong>
                    <em>{Math.round(candidate.score * 100)}%</em>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="music-tag-workbench-page__lockPanel">
            <div className="music-tag-workbench-page__subhead">
              <LockKeyhole size={15} aria-hidden="true" />
              <strong>{t('pages.musicTagWorkbench.lock.title')}</strong>
              <span>{t('pages.musicTagWorkbench.lock.count', { count: lockedFields.length })}</span>
            </div>
            <div className="music-tag-workbench-page__lockGrid">
              {LOCK_FIELD_OPTIONS.map((field) => (
                <label key={field.key}>
                  <input
                    type="checkbox"
                    checked={lockedFields.includes(field.key)}
                    onChange={() => toggleLockedField(field.key)}
                  />
                  <span>{t(field.labelKey)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="music-tag-workbench-page__patchPanel">
            <div className="music-tag-workbench-page__subhead">
              <Database size={15} aria-hidden="true" />
              <strong>{t('pages.musicTagWorkbench.dbPatch.title')}</strong>
              <span>
                {dbPatchResult
                  ? t('pages.musicTagWorkbench.dbPatch.changeCount', {
                      count: dbPatchResult.changedFields.length,
                    })
                  : t('pages.musicTagWorkbench.dbPatch.noPreview')}
              </span>
            </div>
            <div className="music-tag-workbench-page__fieldSelection">
              <div className="music-tag-workbench-page__fieldSelectionHead">
                <strong>{t('pages.musicTagWorkbench.patchFields.title')}</strong>
                <button type="button" onClick={selectAllPatchFields}>
                  {t('pages.musicTagWorkbench.patchFields.selectAll')}
                </button>
                <button type="button" onClick={deselectAllPatchFields}>
                  {t('pages.musicTagWorkbench.patchFields.deselectAll')}
                </button>
              </div>
              <div className="music-tag-workbench-page__fieldSelectionGrid">
                {COMPARISON_FIELDS.map((field) => (
                  <label key={field.key}>
                    <input
                      type="checkbox"
                      checked={selectedPatchFields.has(field.key)}
                      onChange={() => togglePatchField(field.key)}
                    />
                    <span>{t(field.labelKey)}</span>
                  </label>
                ))}
              </div>
            </div>
            {dbPatchResult?.changedFields.length ? (
              <div className="music-tag-workbench-page__patchList">
                {dbPatchResult.changedFields.slice(0, 6).map((change) => (
                  <div key={change.field} className="music-tag-workbench-page__patchRow">
                    <span>{t(`pages.musicTagWorkbench.fields.${change.field}`)}</span>
                    <strong title={formatFieldValue(change.after, empty)}>
                      {formatFieldValue(change.after, empty)}
                    </strong>
                    {change.locked ? <em>{t('pages.musicTagWorkbench.lock.locked')}</em> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {dbPatchResult?.warnings.length ? (
              <div className="music-tag-workbench-page__warningList">
                {dbPatchResult.warnings.map((warning) => (
                  <span key={warning}>{t(`pages.musicTagWorkbench.warning.${warning}`)}</span>
                ))}
              </div>
            ) : null}
            <div className="music-tag-workbench-page__patchActions">
              <button
                type="button"
                disabled={!canPreviewDbPatch || dbPatchState === 'previewing' || dbPatchState === 'applying'}
                title={
                  canPreviewDbPatch
                    ? t('pages.musicTagWorkbench.action.previewDbPatch')
                    : t('pages.musicTagWorkbench.dbPatch.requiresSource')
                }
                onClick={() => {
                  void handlePreviewDbPatch();
                }}
              >
                {dbPatchState === 'previewing' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Eye size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.previewDbPatch')}</span>
              </button>
              <button
                type="button"
                disabled={
                  !canPreviewDbPatch ||
                  dbPatchState === 'previewing' ||
                  dbPatchState === 'applying' ||
                  dbPatchResult?.canApply === false
                }
                title={t('pages.musicTagWorkbench.action.applyDbPatch')}
                onClick={() => {
                  void handleApplyDbPatch();
                }}
              >
                {dbPatchState === 'applying' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Save size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.applyDbPatch')}</span>
              </button>
              <button
                type="button"
                disabled={
                  !activeDbTrack ||
                  !activeSourceMetadata ||
                  writeFileState === 'writing' ||
                  !isLocalFilePath(readNativeTrackFilePath(activeDbTrack))
                }
                title={t('pages.musicTagWorkbench.action.writeFileTags')}
                onClick={() => {
                  void handleWriteFileTags();
                }}
              >
                {writeFileState === 'writing' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <FileDown size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.action.writeFileTags')}</span>
              </button>
            </div>
            {writeFileState !== 'idle' && (
              <div className={`music-tag-workbench-page__readNotice is-${writeFileState === 'error' ? 'error' : 'ready'}`}>
                {writeFileState === 'error' ? (
                  <AlertCircle size={15} aria-hidden="true" />
                ) : writeFileState === 'done' ? (
                  <CheckCircle2 size={15} aria-hidden="true" />
                ) : (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                )}
                <span title={writeFileError ?? undefined}>
                  {writeFileState === 'writing'
                    ? t('pages.musicTagWorkbench.writeFile.writing')
                    : writeFileState === 'done'
                      ? t('pages.musicTagWorkbench.writeFile.done', { count: writeFileResult?.fieldsWritten ?? 0 })
                      : t('pages.musicTagWorkbench.writeFile.failed')}
                </span>
              </div>
            )}
          </div>
          <div className="music-tag-workbench-page__coverArtPanel">
            <div className="music-tag-workbench-page__subhead">
              <Image size={15} aria-hidden="true" />
              <strong>{t('pages.musicTagWorkbench.coverArt.title')}</strong>
              <button
                type="button"
                disabled={
                  coverArtState === 'searching' ||
                  !(activeSourceMetadata?.mbidRelease ?? activeDbTrack?.mbidRelease)
                }
                onClick={() => {
                  void handleSearchCoverArt();
                }}
              >
                {coverArtState === 'searching' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Search size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.coverArt.search')}</span>
              </button>
            </div>
            {coverArtState === 'error' && (
              <div className="music-tag-workbench-page__readNotice is-error">
                <AlertCircle size={15} aria-hidden="true" />
                <span title={coverArtError ?? undefined}>{t('pages.musicTagWorkbench.coverArt.failed')}</span>
              </div>
            )}
            {coverArtResult?.candidates.length ? (
              <div className="music-tag-workbench-page__coverArtGrid">
                {coverArtResult.candidates.slice(0, 6).map((candidate) => (
                  <button
                    key={candidate.url}
                    type="button"
                    className={`music-tag-workbench-page__coverArtItem ${
                      selectedCoverArt?.url === candidate.url ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedCoverArt(candidate)}
                    title={candidate.coverType}
                  >
                    <img
                      src={candidate.thumbnailUrl ?? candidate.url}
                      alt={candidate.coverType}
                      loading="lazy"
                    />
                    <span>{candidate.coverType}</span>
                  </button>
                ))}
              </div>
            ) : coverArtState === 'ready' ? (
              <div className="music-tag-workbench-page__readNotice is-idle">
                <Image size={15} aria-hidden="true" />
                <span>{t('pages.musicTagWorkbench.coverArt.none')}</span>
              </div>
            ) : null}
          </div>
          <div className="music-tag-workbench-page__lyricsPanel">
            <div className="music-tag-workbench-page__subhead">
              <TextQuote size={15} aria-hidden="true" />
              <strong>{t('pages.musicTagWorkbench.lyrics.title')}</strong>
              <button
                type="button"
                disabled={!activeDbTrack || lyricsResolveState === 'resolving'}
                onClick={() => { void handleResolveLyrics(); }}
              >
                {lyricsResolveState === 'resolving' ? (
                  <Loader2 className="music-tag-workbench-page__spin" size={15} aria-hidden="true" />
                ) : (
                  <Search size={15} aria-hidden="true" />
                )}
                <span>{t('pages.musicTagWorkbench.lyrics.resolve')}</span>
              </button>
            </div>
            <div className="music-tag-workbench-page__lyricsColumns">
              <div className="music-tag-workbench-page__lyricsColumn">
                <div className="music-tag-workbench-page__lyricsColumnHead">
                  {t('pages.musicTagWorkbench.lyrics.embedded')}
                </div>
                {activeLocalTagResult?.metadata.lyrics ? (
                  <pre className="music-tag-workbench-page__lyricsText">
                    {lyricsExpanded
                      ? activeLocalTagResult.metadata.lyrics
                      : activeLocalTagResult.metadata.lyrics.split('\n').slice(0, 8).join('\n')}
                  </pre>
                ) : (
                  <span className="music-tag-workbench-page__lyricsEmpty">
                    {t('pages.musicTagWorkbench.lyrics.noEmbedded')}
                  </span>
                )}
              </div>
              <div className="music-tag-workbench-page__lyricsColumn">
                <div className="music-tag-workbench-page__lyricsColumnHead">
                  {t('pages.musicTagWorkbench.lyrics.resolved')}
                  {lyricsResolveResult?.selectedSource && (
                    <span className="music-tag-workbench-page__lyricsSource">
                      {lyricsResolveResult.selectedSource}
                    </span>
                  )}
                </div>
                {lyricsResolveResult?.selected ? (
                  <>
                    <pre className="music-tag-workbench-page__lyricsText">
                      {lyricsExpanded
                        ? lyricsResolveResult.selected.rawText ?? lyricsResolveResult.selected.lines.map((l) => l.text ?? '').join('\n')
                        : (lyricsResolveResult.selected.rawText ?? lyricsResolveResult.selected.lines.map((l) => l.text ?? '').join('\n')).split('\n').slice(0, 8).join('\n')}
                    </pre>
                    <div className="music-tag-workbench-page__lyricsMeta">
                      <span>{t('pages.musicTagWorkbench.lyrics.format')}: {lyricsResolveResult.selected.format}</span>
                      {lyricsResolveResult.selected.isDynamic && <span>{t('pages.musicTagWorkbench.lyrics.synced')}</span>}
                      {lyricsResolveResult.selected.hasWordTiming && <span>{t('pages.musicTagWorkbench.lyrics.hasWordTiming')}</span>}
                      <span>{t('pages.musicTagWorkbench.lyrics.confidence')}: {(lyricsResolveResult.selected.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </>
                ) : lyricsResolveState === 'ready' ? (
                  <span className="music-tag-workbench-page__lyricsEmpty">
                    {t('pages.musicTagWorkbench.lyrics.noResolved')}
                  </span>
                ) : null}
              </div>
            </div>
            {(activeLocalTagResult?.metadata.lyrics || lyricsResolveResult?.selected) && (
              <button
                type="button"
                className="music-tag-workbench-page__lyricsToggle"
                onClick={() => setLyricsExpanded((prev) => !prev)}
              >
                {lyricsExpanded
                  ? t('pages.musicTagWorkbench.lyrics.showLess')
                  : t('pages.musicTagWorkbench.lyrics.showMore')}
              </button>
            )}
            <div className="music-tag-workbench-page__lyricsPriority">
              {t('pages.musicTagWorkbench.lyrics.priority')}
            </div>
          </div>
          {batchRows.length > 0 ? (
            <div className="music-tag-workbench-page__batchList">
              {batchRows.slice(0, 10).map((row) => {
                const rowTitle = formatFieldValue(row.track.title, t('pages.musicTagWorkbench.noTrackTitle'));
                const rowArtist = formatFieldValue(row.track.artist, t('common.unknown.artist'));
                const rowStateLabel =
                  row.state === 'ready'
                    ? t('pages.musicTagWorkbench.batch.rowReady', {
                        count: row.diffCount ?? 0,
                      })
                    : row.state === 'reading'
                      ? t('pages.musicTagWorkbench.stageState.reading')
                      : row.state === 'error'
                        ? t('pages.musicTagWorkbench.stageState.failed')
                        : row.state === 'skipped'
                          ? t('pages.musicTagWorkbench.batch.rowSkipped')
                          : t('pages.musicTagWorkbench.stageState.pending');
                return (
                  <button
                    key={row.track.id}
                    type="button"
                    className={`music-tag-workbench-page__batchRow is-${row.state} ${
                      selectedBatchTrackId === row.track.id ? 'is-selected' : ''
                    }`}
                    onClick={() => setSelectedBatchTrackId(row.track.id)}
                    title={t('pages.musicTagWorkbench.batch.selectRow')}
                  >
                    <div className="music-tag-workbench-page__batchRowMain">
                      {row.state === 'reading' ? (
                        <Loader2 className="music-tag-workbench-page__spin" size={16} aria-hidden="true" />
                      ) : row.state === 'ready' ? (
                        <CheckCircle2 size={16} aria-hidden="true" />
                      ) : row.state === 'error' ? (
                        <AlertCircle size={16} aria-hidden="true" />
                      ) : (
                        <FileAudio size={16} aria-hidden="true" />
                      )}
                      <div>
                        <strong title={rowTitle}>{rowTitle}</strong>
                        <span title={rowArtist}>{rowArtist}</span>
                      </div>
                    </div>
                    <div className="music-tag-workbench-page__batchMeta">
                      <span>{row.format || row.track.format || t('pages.musicTagWorkbench.emptyValue')}</span>
                      <em title={row.error ?? undefined}>{rowStateLabel}</em>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
          {batchRows.some((r) => r.state === 'ready' && (r.diffCount ?? 0) > 0) && (
            <div className="music-tag-workbench-page__batchActions">
              <button
                type="button"
                disabled={batchApplyState === 'running'}
                onClick={() => { void handleBatchApplyDb(); }}
              >
                <Database size={14} aria-hidden="true" />
                {t('pages.musicTagWorkbench.batch.applyAll')}
              </button>
              <button
                type="button"
                disabled={batchApplyState === 'running'}
                onClick={() => { void handleBatchWriteFiles(); }}
              >
                <FileDown size={14} aria-hidden="true" />
                {t('pages.musicTagWorkbench.batch.writeAll')}
              </button>
              {batchApplyState === 'running' && (
                <button
                  type="button"
                  className="is-cancel"
                  onClick={() => { void handleBatchCancel(); }}
                >
                  {t('pages.musicTagWorkbench.batch.cancel')}
                </button>
              )}
              {batchApplyProgress && (
                <div className="music-tag-workbench-page__batchProgress">
                  <span>
                    {batchApplyProgress.current}/{batchApplyProgress.total}
                  </span>
                  <span>
                    {t('pages.musicTagWorkbench.batch.applied')}: {batchApplyProgress.appliedCount}
                  </span>
                  {batchApplyProgress.errorCount > 0 && (
                    <span className="is-error">
                      {t('pages.musicTagWorkbench.batch.errors')}: {batchApplyProgress.errorCount}
                    </span>
                  )}
                  {(batchApplyState === 'done' || batchApplyState === 'cancelled') && (
                    <span className="is-status">
                      {batchApplyState === 'done'
                        ? t('pages.musicTagWorkbench.batch.done')
                        : t('pages.musicTagWorkbench.batch.cancelled')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="music-tag-workbench-page__queue">
            <div className="music-tag-workbench-page__queueItem">
              <ListChecks size={18} aria-hidden="true" />
              <span>{t('pages.musicTagWorkbench.queue.localDiff')}</span>
              <strong>{localDiffStateText}</strong>
            </div>
            <div className="music-tag-workbench-page__queueItem">
              <ArrowRight size={18} aria-hidden="true" />
              <span>{t('pages.musicTagWorkbench.queue.batchScope')}</span>
              <strong>
                {t('pages.musicTagWorkbench.batch.scope', {
                  count: batchRows.length,
                  total: batchTotal,
                })}
              </strong>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
