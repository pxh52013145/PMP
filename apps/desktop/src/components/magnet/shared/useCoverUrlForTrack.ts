import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Track } from '../../../services/audio';
import type { CoverSizeHint } from '../../../services/audio/MusicLibraryService';
import {
  PMP_STORAGE_CHANGE_EVENT,
  type PmpStorageChangeDetail,
} from '../../../modules/storage/localStorage';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { trackKey } from './trackKey';

type CoverUrlState = { key: string; url?: string };

const COVER_RELEASE_DELAY_MS = 450;
const COVER_KEEP_HOT_COUNT = 1;
const SMALL_COVER_RELEASE_DELAY_MS = 120;
const SMALL_COVER_KEEP_HOT_COUNT = 1;

type UseCoverUrlOptions = {
  coverSizeHint?: CoverSizeHint;
  bypassRuntimePolicy?: boolean;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildCoverSignature(coverUrl: string | undefined): string {
  if (!coverUrl) return '';
  const trimmed = coverUrl.trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  const scheme =
    lower.startsWith('data:')
      ? 'data'
      : lower.startsWith('blob:')
        ? 'blob'
        : lower.startsWith('http:')
          ? 'http'
          : lower.startsWith('https:')
            ? 'https'
            : lower.startsWith('asset:')
              ? 'asset'
              : lower.startsWith('tauri:')
                ? 'tauri'
                : 'other';

  return `${scheme}:${trimmed.length}`;
}

async function loadMusicLibraryService() {
  const { getMusicLibraryService } = await import('../../../services/audio/MusicLibraryService');
  return getMusicLibraryService();
}

export function useCoverUrlForTrack(track: Track | null, options?: UseCoverUrlOptions): string | undefined {
  const coverSizeHint = options?.coverSizeHint;
  const bypassRuntimePolicy = options?.bypassRuntimePolicy === true;
  const coverReleaseDelayMs =
    coverSizeHint === 'small' ? SMALL_COVER_RELEASE_DELAY_MS : COVER_RELEASE_DELAY_MS;
  const coverKeepHotCount = coverSizeHint === 'small' ? SMALL_COVER_KEEP_HOT_COUNT : COVER_KEEP_HOT_COUNT;
  const key = useMemo(() => trackKey(track), [track]);
  const trackId = track?.id;
  const trackTitle = track?.title;
  const trackArtist = track?.artist;
  const trackAlbum = track?.album;
  const trackFilePath = track?.filePath;
  const trackPath = track?.path;
  const trackCoverKey = track?.coverKey;
  const embeddedCoverUrl = useMemo(() => {
    if (!isNonEmptyString(track?.coverUrl)) return undefined;
    const trimmed = track.coverUrl.trim();
    return trimmed || undefined;
  }, [track?.coverUrl]);
  const coverSignature = useMemo(() => buildCoverSignature(embeddedCoverUrl), [embeddedCoverUrl]);
  const isAbsolutePath = useMemo(() => {
    const candidate = String(track?.filePath || track?.path || '');
    if (!candidate) return false;
    if (candidate.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(candidate);
  }, [track?.filePath, track?.path]);

  const [resolved, setResolved] = useState<CoverUrlState>({ key: 'none' });
  const [coverSettingsRevision, setCoverSettingsRevision] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden
  );
  const recentCoverUrlsRef = useRef<string[]>([]);
  const retainedCoverUrlsRef = useRef<Set<string>>(new Set());
  const pendingReleaseUrlsRef = useRef<Set<string>>(new Set());
  const releaseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const nextVisible = !document.hidden;
      setDocumentVisible((previous) => (previous === nextVisible ? previous : nextVisible));
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
      if (!detail || detail.key !== STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX) {
        return;
      }

      setResolved({ key: 'none' });
      setCoverSettingsRevision((previous) => previous + 1);
    };

    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, handleStorageChange as EventListener);
    return () => {
      window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, handleStorageChange as EventListener);
    };
  }, []);

  const lookupTrack = useMemo(() => {
    if (!documentVisible && !bypassRuntimePolicy) return null;
    if (!trackId && !trackTitle && !trackFilePath && !trackPath) return null;
    return {
      id: trackId || 'unknown',
      title: trackTitle || 'Unknown',
      artist: trackArtist,
      album: trackAlbum,
      filePath: trackFilePath,
      path: trackPath,
      coverKey: trackCoverKey,
      coverUrl: embeddedCoverUrl,
    } as Track;
  }, [
    bypassRuntimePolicy,
    documentVisible,
    embeddedCoverUrl,
    trackAlbum,
    trackArtist,
    trackCoverKey,
    trackFilePath,
    trackId,
    trackPath,
    trackTitle,
  ]);

  const fetchKey = useMemo(() => {
    if (!lookupTrack) return 'none';
    return [
      key,
      lookupTrack.filePath || '',
      lookupTrack.path || '',
      lookupTrack.coverKey || '',
      coverSignature,
      coverSizeHint || '',
      coverSettingsRevision,
    ].join('|');
  }, [coverSettingsRevision, coverSignature, coverSizeHint, key, lookupTrack]);

  useEffect(() => {
    if (!lookupTrack) return;

    let cancelled = false;
    const currentKey = key;

    void loadMusicLibraryService()
      .then(async (service) => {
        if (cancelled) return;
        const url = await service.getCoverUrlForTrack(lookupTrack, {
          coverSizeHint,
          bypassRuntimePolicy,
        });
        if (!isNonEmptyString(url)) return;
        if (cancelled) {
          service.discardCoverUrls([url]);
          return;
        }
        setResolved({ key: currentKey, url });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [bypassRuntimePolicy, coverSizeHint, fetchKey, key, lookupTrack]);

  const resolvedUrl = resolved.key === key ? resolved.url : undefined;

  const embeddedIsEphemeral =
    embeddedCoverUrl && (embeddedCoverUrl.startsWith('blob:') || embeddedCoverUrl.startsWith('data:'));

  const preferredCoverUrl = (() => {
    if (!documentVisible && !bypassRuntimePolicy) return undefined;
    if (!embeddedIsEphemeral) return resolvedUrl ?? embeddedCoverUrl;

    // Desktop/Tauri: avoid keeping large embedded cover payloads in memory for absolute-path tracks.
    // Prefer resolving via Rust cover cache (`pmp://cover/...`) instead.
    if (isTauriRuntime() && isAbsolutePath) {
      return resolvedUrl;
    }
    return embeddedCoverUrl;
  })();

  const releaseTrackedCoverUrls = useCallback((immediate: boolean = false) => {
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }

    const toRelease = new Set<string>();
    for (const url of retainedCoverUrlsRef.current) {
      if (typeof url === 'string' && url.trim()) toRelease.add(url.trim());
    }

    recentCoverUrlsRef.current = [];
    retainedCoverUrlsRef.current.clear();
    pendingReleaseUrlsRef.current.clear();

    if (toRelease.size > 0) {
      const release = () => {
        void loadMusicLibraryService()
          .then((service) => service.releaseCoverUrls(Array.from(toRelease)))
          .catch(() => undefined);
      };
      if (immediate) {
        release();
        return;
      }
      window.setTimeout(release, 0);
    }
  }, []);

  useEffect(() => {
    if (lookupTrack) return;
    releaseTrackedCoverUrls(true);
    setResolved((previous) =>
      previous.key === 'none' && previous.url === undefined ? previous : { key: 'none' }
    );
  }, [lookupTrack, releaseTrackedCoverUrls]);

  useEffect(() => {
    if (documentVisible || bypassRuntimePolicy) return;
    releaseTrackedCoverUrls(true);
    setResolved({ key: 'none' });
  }, [bypassRuntimePolicy, documentVisible, releaseTrackedCoverUrls]);

  useEffect(() => {
    const currentUrl =
      typeof preferredCoverUrl === 'string' && preferredCoverUrl.trim().length > 0
        ? preferredCoverUrl.trim()
        : undefined;

    const previousRecent = recentCoverUrlsRef.current;
    const nextRecent = currentUrl
      ? [currentUrl, ...previousRecent.filter((url) => url !== currentUrl)].slice(0, coverKeepHotCount)
      : [];

    for (const staleUrl of previousRecent) {
      if (!nextRecent.includes(staleUrl)) {
        pendingReleaseUrlsRef.current.add(staleUrl);
      }
    }

    recentCoverUrlsRef.current = nextRecent;

    if (currentUrl && !retainedCoverUrlsRef.current.has(currentUrl)) {
      void loadMusicLibraryService()
        .then((service) => {
          if (!recentCoverUrlsRef.current.includes(currentUrl)) return;
          if (retainedCoverUrlsRef.current.has(currentUrl)) return;
          service.retainCoverUrls([currentUrl]);
          retainedCoverUrlsRef.current.add(currentUrl);
        })
        .catch(() => undefined);
    }

    if (pendingReleaseUrlsRef.current.size === 0) return;

    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current);
    }

    releaseTimerRef.current = window.setTimeout(() => {
      releaseTimerRef.current = null;
      const toRelease = Array.from(pendingReleaseUrlsRef.current).filter(
        (url) => !recentCoverUrlsRef.current.includes(url)
      );
      pendingReleaseUrlsRef.current.clear();
      const retainedToRelease = toRelease.filter((url) => retainedCoverUrlsRef.current.delete(url));

      if (retainedToRelease.length > 0) {
        void loadMusicLibraryService()
          .then((service) => service.releaseCoverUrls(retainedToRelease))
          .catch(() => undefined);
      }
    }, coverReleaseDelayMs);

    return () => {
      if (releaseTimerRef.current != null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };
  }, [coverKeepHotCount, coverReleaseDelayMs, preferredCoverUrl]);

  useEffect(() => {
    return () => {
      releaseTrackedCoverUrls(true);
    };
  }, [releaseTrackedCoverUrls]);

  return preferredCoverUrl;
}
