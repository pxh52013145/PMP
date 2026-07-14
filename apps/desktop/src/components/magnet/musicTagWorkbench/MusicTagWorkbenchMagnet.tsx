import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  FileAudio,
  ListChecks,
  Loader2,
  Music2,
  Plus,
  Tags,
} from 'lucide-react';
import type {
  MusicTagMetadataFieldKey,
  MusicTagReadLocalResult,
} from '../../../contracts/musicTag';
import { useAudioService } from '../../../contexts/AudioEngineContext';
import { useNavigation } from '../../../contexts/NavigationContext';
import { useT } from '../../../i18n';
import { readLocalMusicTags } from '../../../modules/music-tag/nativeMusicTag';
import {
  addMusicTagWorkbenchTracks,
  readMusicTagWorkbenchQueue,
} from '../../../modules/music-tag/workbenchQueue';
import type { Track } from '../../../services/audio';
import { useCoverUrlForTrack } from '../shared/useCoverUrlForTrack';
import './MusicTagWorkbenchMagnet.css';

type LocalTagReadState = 'idle' | 'loading' | 'ready' | 'error';
type CompareState = 'same' | 'different' | 'missingDb' | 'missingFile' | 'missingBoth';

type ComparisonField = {
  key: MusicTagMetadataFieldKey;
  labelKey: string;
  readTrackValue: (track: Track | null) => unknown;
  isLongText?: boolean;
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

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMetadataValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return hasText(value);
}

function countFilledMetadataFields(track: Track | null): number {
  if (!track) return 0;
  return [
    track.title,
    track.artist,
    track.album,
    track.albumArtist,
    track.genre,
    track.year,
    track.trackNumber,
    track.discNumber,
    track.composer,
  ].filter(hasMetadataValue).length;
}

function readTrackFilePath(track: Track | null): string {
  return String(track?.filePath || track?.originalPath || track?.path || '').trim();
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

export function MusicTagWorkbenchMagnet() {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const t = useT();
  const [track, setTrack] = useState<Track | null>(() => audioService.getState().currentTrack);
  const [localTagState, setLocalTagState] = useState<LocalTagReadState>('idle');
  const [localTagResult, setLocalTagResult] = useState<MusicTagReadLocalResult | null>(null);
  const [localTagError, setLocalTagError] = useState<string | null>(null);
  const [queueSize, setQueueSize] = useState(() => readMusicTagWorkbenchQueue().length);
  const coverUrl = useCoverUrlForTrack(track, { coverSizeHint: 'small' });

  useEffect(() => {
    setTrack(audioService.getState().currentTrack);
    return audioService.onStateChange((state) => {
      setTrack(state.currentTrack);
    });
  }, [audioService]);

  const filledFieldCount = useMemo(() => countFilledMetadataFields(track), [track]);
  const filePath = useMemo(() => readTrackFilePath(track), [track]);
  const hasLocalFile = filePath.length > 0 && !/^https?:\/\//i.test(filePath);
  const empty = t('pages.musicTagWorkbench.emptyValue');
  const present = t('pages.musicTagWorkbench.value.present');
  const trackTitle = hasText(track?.title) ? track!.title : t('pages.musicTagWorkbench.noTrackTitle');
  const trackArtist = hasText(track?.artist)
    ? track!.artist
    : track
      ? t('common.unknown.artist')
      : t('pages.musicTagWorkbench.noTrackArtist');

  const metadataStatusKey =
    filledFieldCount >= 6
      ? 'magnet.musicTagWorkbench.status.metadata.rich'
      : filledFieldCount >= 3
        ? 'magnet.musicTagWorkbench.status.metadata.partial'
        : filledFieldCount > 0
          ? 'magnet.musicTagWorkbench.status.metadata.sparse'
          : 'magnet.musicTagWorkbench.status.metadata.empty';

  useEffect(() => {
    setLocalTagState('idle');
    setLocalTagResult(null);
    setLocalTagError(null);
  }, [filePath]);

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

  const openWorkbench = useCallback(() => {
    const trackIds = track?.id ? addMusicTagWorkbenchTracks([track.id]) : [];
    setQueueSize(trackIds.length);
    navigation.navigateTo(
      'music-tag-workbench',
      trackIds.length > 0 ? { trackIds } : undefined
    );
  }, [navigation, track?.id]);

  const addCurrentTrack = useCallback(() => {
    if (!track?.id) return;
    setQueueSize(addMusicTagWorkbenchTracks([track.id]).length);
  }, [track?.id]);

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
        key: 'trackNumber',
        label: t('pages.musicTagWorkbench.fields.trackNumber'),
        value: formatFieldValue(track?.trackNumber, empty),
      },
      {
        key: 'discNumber',
        label: t('pages.musicTagWorkbench.fields.discNumber'),
        value: formatFieldValue(track?.discNumber, empty),
      },
      {
        key: 'composer',
        label: t('pages.musicTagWorkbench.fields.composer'),
        value: formatFieldValue(track?.composer, empty),
      },
      {
        key: 'format',
        label: t('pages.musicTagWorkbench.fields.format'),
        value: formatFieldValue(track?.format || track?.codecName, empty),
      },
      {
        key: 'bitrate',
        label: t('pages.musicTagWorkbench.fields.bitrate'),
        value: track?.bitrate ? `${Math.round(track.bitrate / 1000)} kbps` : empty,
      },
      {
        key: 'sampleRate',
        label: t('pages.musicTagWorkbench.fields.sampleRate'),
        value: track?.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} kHz` : empty,
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

  return (
    <section className="music-tag-workbench-magnet" aria-label={t('magnet.musicTagWorkbench.ariaLabel')}>
      <div className="music-tag-workbench-magnet__header">
        <div className="music-tag-workbench-magnet__title">
          <Tags size={15} aria-hidden="true" />
          <div>
            <span>{t('magnet.musicTagWorkbench.title')}</span>
            <small>{t('magnet.musicTagWorkbench.compact.subtitle')}</small>
          </div>
        </div>
        <div className="music-tag-workbench-magnet__queueBadge">
          <ListChecks size={13} aria-hidden="true" />
          <span>{t('magnet.musicTagWorkbench.compact.queue', { count: queueSize })}</span>
        </div>
      </div>

      <div className="music-tag-workbench-magnet__compact">
        <div className="music-tag-workbench-magnet__compactTrack">
          <div className="music-tag-workbench-magnet__compactCover">
            {coverUrl ? (
              <img src={coverUrl} alt={trackTitle} />
            ) : (
              <Music2 size={28} aria-hidden="true" />
            )}
          </div>
          <div className="music-tag-workbench-magnet__compactIdentity">
            <strong title={trackTitle}>{trackTitle}</strong>
            <span title={trackArtist}>{trackArtist}</span>
            <div>
              <em>{t(metadataStatusKey, { count: filledFieldCount })}</em>
              <em className={diffFieldCount > 0 ? 'is-warning' : 'is-ready'}>
                {localDiffStateText}
              </em>
            </div>
          </div>
        </div>

        <div className="music-tag-workbench-magnet__compactFields">
          {(localTagState === 'ready' ? comparisonRows : metadataRows).slice(0, 4).map((row) => (
            <div key={row.key}>
              <span>{row.label}</span>
              <strong title={'fileValue' in row ? row.fileValue : row.value}>
                {'fileValue' in row ? row.fileValue : row.value}
              </strong>
              {'state' in row ? <i className={`is-${row.state}`} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>

        <div className={`music-tag-workbench-magnet__compactNotice is-${localTagState}`}>
          {localTagState === 'error' ? (
            <AlertCircle size={14} aria-hidden="true" />
          ) : localTagState === 'loading' ? (
            <Loader2 className="music-tag-workbench-magnet__spin" size={14} aria-hidden="true" />
          ) : (
            <FileAudio size={14} aria-hidden="true" />
          )}
          <span title={localTagError ?? undefined}>{localReadStatusText}</span>
          {localTagResult?.format ? <strong>{localTagResult.format}</strong> : null}
        </div>

        <div className="music-tag-workbench-magnet__compactActions">
          <button
            type="button"
            disabled={!hasLocalFile || localTagState === 'loading'}
            onClick={handleReadLocalTags}
            title={t('pages.musicTagWorkbench.action.readLocalTags')}
          >
            <FileAudio size={14} aria-hidden="true" />
            <span>{t('pages.musicTagWorkbench.action.readLocalTags')}</span>
          </button>
          <button
            type="button"
            disabled={!track?.id}
            onClick={addCurrentTrack}
            title={t('common.action.addToMusicTag')}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{t('common.action.addToMusicTag')}</span>
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={openWorkbench}
            title={t('common.action.openInMusicTag')}
          >
            <ExternalLink size={14} aria-hidden="true" />
            <span>{t('common.action.openInMusicTag')}</span>
          </button>
        </div>
      </div>

    </section>
  );
}
