import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioState, Track } from '../../services/audio';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { musicLibraryService } from '../../services/audio/MusicLibraryService';
import {
  getNativeLibrarySelectedLyrics,
  resolveNativeLibraryLyrics,
  type NativeLyricDocument,
  type NativeLyricResolveQuery,
} from '../../modules/music-library';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { useT } from '../../i18n';
import './TrackDetailPage.css';

interface TrackDetailPageProps {
  trackId?: string;
}

interface RenderLyricLine {
  id: string;
  startMs: number;
  endMs?: number;
  text: string;
  translation?: string;
}

type TrackDetailAudioState = Pick<AudioState, 'currentTrack' | 'currentTime' | 'queue'>;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const TrackDetailPage: React.FC<TrackDetailPageProps> = ({ trackId }) => {
  const t = useT();
  const audioService = useAudioService();
  const telemetry = useMemo(() => getTelemetryLogger('music-library', 'TrackDetailPage'), []);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [playbackTimeSec, setPlaybackTimeSec] = useState(0);
  const [activePanel, setActivePanel] = useState<'lyrics' | 'metadata'>('lyrics');
  const [resolvedLyrics, setResolvedLyrics] = useState<NativeLyricDocument | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState(false);
  const [isToggleProximityVisible, setIsToggleProximityVisible] = useState(false);
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const lyricLineRefs = useRef<Map<string, HTMLParagraphElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!trackId) return;

    setCurrentTrack((prev) => (prev && prev.id === trackId ? prev : null));
    void musicLibraryService
      .getTrackById(trackId)
      .then((track) => {
        if (cancelled || !track) return;
        setCurrentTrack(track);
      })
      .catch((error) => {
        telemetry.warn('track_detail.resolve_track.failed', {
          message: readErrorMessage(error),
          fields: {
            trackId,
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [trackId, telemetry]);

  useEffect(() => {
    const applyState = (state: TrackDetailAudioState) => {
      if (trackId) {
        if (state.currentTrack && state.currentTrack.id === trackId) {
          setCurrentTrack(state.currentTrack);
        } else {
          const queueLength = state.queue.length;
          if (!state.currentTrack && queueLength === 0) {
            setCurrentTrack(null);
          }
        }
        setPlaybackTimeSec(
          typeof state.currentTime === 'number' && Number.isFinite(state.currentTime)
            ? Math.max(0, state.currentTime)
            : 0
        );
        return;
      }

      setCurrentTrack(state.currentTrack);
      setPlaybackTimeSec(
        typeof state.currentTime === 'number' && Number.isFinite(state.currentTime)
          ? Math.max(0, state.currentTime)
          : 0
      );
    };

    const unsubscribe = audioService.onStateChange((state) => {
      applyState(state);
    });

    applyState(audioService.getState());
    return unsubscribe;
  }, [audioService, trackId]);

  useEffect(() => {
    const unsubscribe = audioService.onTimeUpdate((time) => {
      const normalized =
        typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : 0;

      if (!trackId) {
        setPlaybackTimeSec(normalized);
        return;
      }

      const state = audioService.getState();
      if (state.currentTrack?.id === trackId) {
        setPlaybackTimeSec(normalized);
      }
    });

    return unsubscribe;
  }, [audioService, trackId]);

  const togglePanel = useCallback(() => {
    setActivePanel((prev) => (prev === 'lyrics' ? 'metadata' : 'lyrics'));
  }, []);

  const handlePanelPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch') {
        setIsToggleProximityVisible(true);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const distanceToBottom = rect.bottom - event.clientY;
      const centerX = rect.left + rect.width / 2;
      const distanceToCenterX = Math.abs(event.clientX - centerX);
      const nearBottomEdge = distanceToBottom >= -4 && distanceToBottom <= 30;
      const nearCenterHandle = distanceToCenterX <= Math.min(88, rect.width * 0.2);

      setIsToggleProximityVisible(nearBottomEdge && nearCenterHandle);
    },
    []
  );

  const handlePanelPointerLeave = useCallback(() => {
    setIsToggleProximityVisible(false);
  }, []);

  const handleToggleFocus = useCallback(() => {
    setIsToggleProximityVisible(true);
  }, []);

  const handleToggleBlur = useCallback(() => {
    setIsToggleProximityVisible(false);
  }, []);

  const normalizedLyrics = useMemo(
    () => (typeof currentTrack?.lyrics === 'string' ? currentTrack.lyrics.trim() : ''),
    [currentTrack?.lyrics]
  );

  useEffect(() => {
    let cancelled = false;

    const hasLyricsContent = (document: NativeLyricDocument | null | undefined): boolean => {
      if (!document) return false;
      if (typeof document.rawText === 'string' && document.rawText.trim().length > 0) return true;
      return document.lines.some((line) => {
        if (typeof line.text === 'string' && line.text.trim().length > 0) {
          return true;
        }
        return line.tokens.some((token) => typeof token.text === 'string' && token.text.trim().length > 0);
      });
    };

    const loadLyrics = async () => {
      if (!currentTrack) {
        setResolvedLyrics(null);
        setLyricsLoading(false);
        setLyricsError(false);
        return;
      }

      const query: NativeLyricResolveQuery = {
        trackId: currentTrack.id,
        trackFilePath:
          typeof currentTrack.filePath === 'string' && currentTrack.filePath.trim().length > 0
            ? currentTrack.filePath.trim()
            : typeof currentTrack.path === 'string' && currentTrack.path.trim().length > 0
              ? currentTrack.path.trim()
              : undefined,
        quickFingerprint:
          typeof currentTrack.quickFingerprint === 'string' &&
          currentTrack.quickFingerprint.trim().length > 0
            ? currentTrack.quickFingerprint.trim()
            : undefined,
      };

      if (!query.trackId && !query.trackFilePath && !query.quickFingerprint) {
        setResolvedLyrics(null);
        setLyricsLoading(false);
        setLyricsError(false);
        return;
      }

      setLyricsLoading(true);
      setLyricsError(false);

      try {
        const selected = await getNativeLibrarySelectedLyrics(query);
        if (cancelled) return;

        if (hasLyricsContent(selected)) {
          setResolvedLyrics(selected);
          return;
        }

        const resolved = await resolveNativeLibraryLyrics({
          ...query,
          title: currentTrack.title,
          artist: currentTrack.artist,
          durationSeconds: currentTrack.duration,
          embeddedLyrics: normalizedLyrics || undefined,
          cacheKey: query.quickFingerprint || query.trackId,
          forceWebLookup: false,
        });
        if (cancelled) return;

        if (hasLyricsContent(resolved?.selected)) {
          setResolvedLyrics(resolved?.selected || null);
        } else {
          setResolvedLyrics(null);
        }
      } catch (error) {
        if (cancelled) return;
        telemetry.warn('track_detail.resolve_lyrics.failed', {
          message: readErrorMessage(error),
          fields: {
            trackId: currentTrack.id,
            filePath:
              typeof currentTrack.filePath === 'string' && currentTrack.filePath.trim().length > 0
                ? currentTrack.filePath.trim()
                : typeof currentTrack.path === 'string' && currentTrack.path.trim().length > 0
                  ? currentTrack.path.trim()
                  : null,
            quickFingerprint:
              typeof currentTrack.quickFingerprint === 'string' &&
              currentTrack.quickFingerprint.trim().length > 0
                ? currentTrack.quickFingerprint.trim()
                : null,
          },
        });
        setLyricsError(true);
        setResolvedLyrics(null);
      } finally {
        if (!cancelled) {
          setLyricsLoading(false);
        }
      }
    };

    void loadLyrics();

    return () => {
      cancelled = true;
    };
  }, [
    currentTrack,
    normalizedLyrics,
    currentTrack?.id,
    currentTrack?.filePath,
    currentTrack?.path,
    currentTrack?.quickFingerprint,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.duration,
    telemetry,
  ]);

  const resolvedLyricsText = useMemo(() => {
    if (!resolvedLyrics) return '';
    const rawText = typeof resolvedLyrics.rawText === 'string' ? resolvedLyrics.rawText.trim() : '';
    if (rawText) return rawText;

    return resolvedLyrics.lines
      .map((line) => {
        const explicit = typeof line.text === 'string' ? line.text.trim() : '';
        if (explicit) return explicit;
        return line.tokens
          .map((token) => (typeof token.text === 'string' ? token.text.trim() : ''))
          .filter((token) => token.length > 0)
          .join('')
          .trim();
      })
      .filter((line) => line.length > 0)
      .join('\n')
      .trim();
  }, [resolvedLyrics]);

  const displayLyrics = resolvedLyricsText || normalizedLyrics;

  const lyricLines = useMemo<RenderLyricLine[]>(() => {
    if (resolvedLyrics?.lines.length) {
      const normalized: RenderLyricLine[] = [];
      resolvedLyrics.lines.forEach((line, index) => {
        const explicit = typeof line.text === 'string' ? line.text.trim() : '';
        const tokenText = line.tokens
          .map((token) => (typeof token.text === 'string' ? token.text.trim() : ''))
          .filter((token) => token.length > 0)
          .join('')
          .trim();
        const text = explicit || tokenText;
        if (!text) {
          return;
        }

        normalized.push({
          id: `${resolvedLyrics.id}-line-${index}-${line.startMs}`,
          startMs: typeof line.startMs === 'number' ? Math.max(0, Math.floor(line.startMs)) : index * 3000,
          endMs:
            typeof line.endMs === 'number' && Number.isFinite(line.endMs)
              ? Math.max(0, Math.floor(line.endMs))
              : undefined,
          text,
          translation:
            typeof line.translation === 'string' && line.translation.trim().length > 0
              ? line.translation.trim()
              : undefined,
        });
      });

      return normalized;
    }

    if (!displayLyrics) {
      return [];
    }

    return displayLyrics
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text, index) => ({
        id: `plain-line-${index}`,
        startMs: index * 3000,
        endMs: (index + 1) * 3000,
        text,
      }));
  }, [resolvedLyrics, displayLyrics]);

  const activeLyricLineIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1;

    const currentMs = Math.max(0, Math.floor(playbackTimeSec * 1000));
    for (let index = 0; index < lyricLines.length; index += 1) {
      const line = lyricLines[index];
      const nextStart = lyricLines[index + 1]?.startMs;
      const endMs =
        typeof line.endMs === 'number' && Number.isFinite(line.endMs)
          ? line.endMs
          : typeof nextStart === 'number'
            ? nextStart
            : line.startMs + 4000;
      if (currentMs >= line.startMs && currentMs < endMs) {
        return index;
      }
      if (currentMs < line.startMs) {
        return Math.max(0, index - 1);
      }
    }

    return lyricLines.length - 1;
  }, [lyricLines, playbackTimeSec]);

  useEffect(() => {
    const container = lyricsScrollRef.current;
    if (!container) return;
    container.scrollTop = 0;
    container.dataset.autoFollowReady = '0';
  }, [currentTrack?.id]);

  useEffect(() => {
    if (activePanel !== 'lyrics' || activeLyricLineIndex < 0) return;

    const container = lyricsScrollRef.current;
    if (!container) return;

    const line = lyricLines[activeLyricLineIndex];
    if (!line) return;

    const lineElement = lyricLineRefs.current.get(line.id);
    if (!lineElement) return;

    const lineTop = lineElement.offsetTop;
    const lineHeight = lineElement.offsetHeight;
    const targetTop = Math.max(0, lineTop - container.clientHeight / 2 + lineHeight / 2);
    const behavior: ScrollBehavior = container.dataset.autoFollowReady === '1' ? 'smooth' : 'auto';

    container.scrollTo({ top: targetTop, behavior });
    container.dataset.autoFollowReady = '1';
  }, [activePanel, activeLyricLineIndex, lyricLines]);

  const lyricsSourceLabel = useMemo(() => {
    if (!resolvedLyrics?.sourceKind) return '';
    switch (resolvedLyrics.sourceKind) {
      case 'embedded':
        return t('pages.track.lyrics.source.embedded');
      case 'sidecar':
        return t('pages.track.lyrics.source.sidecar');
      case 'cache':
        return t('pages.track.lyrics.source.cache');
      case 'web':
        return t('pages.track.lyrics.source.web');
      default:
        return '';
    }
  }, [resolvedLyrics?.sourceKind, t]);

  const panelToggleLabel =
    activePanel === 'lyrics'
      ? t('pages.track.toggle.showMetadata')
      : t('pages.track.toggle.showLyrics');

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!currentTrack) {
    return (
      <div className="track-detail-page">
        <div className="track-detail-empty">
          <div className="track-detail-empty-icon">♪</div>
          <div className="track-detail-empty-text">{t('pages.track.empty.noTrack')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="track-detail-page">
      <div className="track-detail-background" />

      <div className="track-detail-shell">
        <div
          className={`track-detail-panel-shell ${isToggleProximityVisible ? 'near-toggle-zone' : ''}`}
          onPointerMove={handlePanelPointerMove}
          onPointerLeave={handlePanelPointerLeave}
        >
          {activePanel === 'lyrics' ? (
            <section className="track-detail-panel" aria-label={t('pages.track.panel.lyrics')}>
              <div className="track-detail-lyrics" ref={lyricsScrollRef}>
                <header className="track-detail-lyrics-header">
                  <h1 className="track-detail-lyrics-title">{currentTrack.title}</h1>
                  <p className="track-detail-lyrics-artist">
                    {currentTrack.artist || t('common.unknown.artist')}
                  </p>
                  {lyricsSourceLabel ? (
                    <p className="track-detail-lyrics-source">{lyricsSourceLabel}</p>
                  ) : null}
                </header>
                {lyricLines.length > 0 ? (
                  <div className="track-detail-lyrics-content" role="list">
                    {lyricLines.map((line, index) => (
                      <p
                        key={line.id}
                        ref={(node) => {
                          if (node) {
                            lyricLineRefs.current.set(line.id, node);
                          } else {
                            lyricLineRefs.current.delete(line.id);
                          }
                        }}
                        className={`track-detail-lyrics-line ${index === activeLyricLineIndex ? 'active' : ''}`}
                        role="listitem"
                      >
                        <span>{line.text}</span>
                        {line.translation ? (
                          <span className="track-detail-lyrics-line-translation">{line.translation}</span>
                        ) : null}
                      </p>
                    ))}
                  </div>
                ) : lyricsLoading ? (
                  <div className="lyrics-placeholder">
                    <span>{t('pages.track.lyrics.loading')}</span>
                  </div>
                ) : lyricsError ? (
                  <div className="lyrics-placeholder">
                    <span>{t('pages.track.lyrics.error')}</span>
                  </div>
                ) : (
                  <div className="lyrics-placeholder">
                    <span>{t('pages.track.lyrics.placeholder')}</span>
                  </div>
                )}
              </div>
            </section>
          ) : (
            <section className="track-detail-panel" aria-label={t('pages.track.panel.metadata')}>
              <div className="track-detail-metadata">
                <div className="track-detail-meta-item">
                  <span className="meta-label">{t('pages.track.meta.title')}</span>
                  <span className="meta-value">{currentTrack.title}</span>
                </div>
                <div className="track-detail-meta-item">
                  <span className="meta-label">{t('pages.track.meta.artist')}</span>
                  <span className="meta-value">{currentTrack.artist || t('common.unknown.artist')}</span>
                </div>
                <div className="track-detail-meta-item">
                  <span className="meta-label">{t('pages.track.meta.album')}</span>
                  <span className="meta-value">{currentTrack.album || t('common.unknown.album')}</span>
                </div>
                {currentTrack.year && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.year')}</span>
                    <span className="meta-value">{currentTrack.year}</span>
                  </div>
                )}
                {currentTrack.genre && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.genre')}</span>
                    <span className="meta-value">{currentTrack.genre}</span>
                  </div>
                )}
                {currentTrack.duration && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.duration')}</span>
                    <span className="meta-value">{formatDuration(currentTrack.duration)}</span>
                  </div>
                )}
                {currentTrack.bitrate && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.bitrate')}</span>
                    <span className="meta-value">{currentTrack.bitrate} kbps</span>
                  </div>
                )}
                {currentTrack.sampleRate && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.sampleRate')}</span>
                    <span className="meta-value">{(currentTrack.sampleRate / 1000).toFixed(1)} kHz</span>
                  </div>
                )}
                {currentTrack.format && (
                  <div className="track-detail-meta-item">
                    <span className="meta-label">{t('pages.track.meta.format')}</span>
                    <span className="meta-value">{currentTrack.format.toUpperCase()}</span>
                  </div>
                )}
              </div>
            </section>
          )}
          <button
            type="button"
            className={`track-detail-panel-toggle ${activePanel === 'metadata' ? 'expanded' : ''} ${isToggleProximityVisible ? 'visible' : ''}`}
            aria-label={panelToggleLabel}
            title={panelToggleLabel}
            onClick={togglePanel}
            onFocus={handleToggleFocus}
            onBlur={handleToggleBlur}
          >
            <span className="track-detail-panel-toggle-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
