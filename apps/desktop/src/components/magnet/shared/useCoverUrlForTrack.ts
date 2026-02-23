import { useEffect, useMemo, useRef, useState } from 'react';

import type { Track } from '../../../services/audio';
import type { CoverSizeHint } from '../../../services/audio/MusicLibraryService';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { trackKey } from './trackKey';

type CoverUrlState = { key: string; url?: string };

const COVER_RELEASE_DELAY_MS = 3000;
const COVER_KEEP_HOT_COUNT = 2;

type UseCoverUrlOptions = {
  coverSizeHint?: CoverSizeHint;
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

export function useCoverUrlForTrack(track: Track | null, options?: UseCoverUrlOptions): string | undefined {
  const coverSizeHint = options?.coverSizeHint;
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
  const recentCoverUrlsRef = useRef<string[]>([]);
  const pendingReleaseUrlsRef = useRef<Set<string>>(new Set());
  const releaseTimerRef = useRef<number | null>(null);

  const lookupTrack = useMemo(() => {
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
    ].join('|');
  }, [coverSignature, coverSizeHint, key, lookupTrack]);

  useEffect(() => {
    if (!lookupTrack) return;

    let cancelled = false;
    const currentKey = key;

    void musicLibraryService
      .getCoverUrlForTrack(lookupTrack, { coverSizeHint, bypassRuntimePolicy: true })
      .then((url) => {
      if (cancelled) return;
      if (!isNonEmptyString(url)) return;
      setResolved({ key: currentKey, url });
    });

    return () => {
      cancelled = true;
    };
  }, [coverSizeHint, fetchKey, key, lookupTrack]);

  const resolvedUrl = resolved.key === key ? resolved.url : undefined;

  const embeddedIsEphemeral =
    embeddedCoverUrl && (embeddedCoverUrl.startsWith('blob:') || embeddedCoverUrl.startsWith('data:'));

  const preferredCoverUrl = (() => {
    if (!embeddedIsEphemeral) return resolvedUrl ?? embeddedCoverUrl;

    // Desktop/Tauri: avoid keeping large embedded cover payloads in memory for absolute-path tracks.
    // Prefer resolving via Rust cover cache (`pmp://cover/...`) instead.
    if (isTauriRuntime() && isAbsolutePath) {
      return resolvedUrl;
    }
    return embeddedCoverUrl;
  })();

  const releaseTrackedCoverUrls = () => {
    if (releaseTimerRef.current != null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }

    const toRelease = new Set<string>();
    for (const url of recentCoverUrlsRef.current) {
      if (typeof url === 'string' && url.trim()) {
        toRelease.add(url.trim());
      }
    }
    for (const url of pendingReleaseUrlsRef.current) {
      if (typeof url === 'string' && url.trim()) {
        toRelease.add(url.trim());
      }
    }

    recentCoverUrlsRef.current = [];
    pendingReleaseUrlsRef.current.clear();

    if (toRelease.size > 0) {
      musicLibraryService.releaseCoverUrls(Array.from(toRelease));
    }
  };

  useEffect(() => {
    const currentUrl =
      typeof preferredCoverUrl === 'string' && preferredCoverUrl.trim().length > 0
        ? preferredCoverUrl.trim()
        : undefined;

    const previousRecent = recentCoverUrlsRef.current;
    const nextRecent = currentUrl
      ? [currentUrl, ...previousRecent.filter((url) => url !== currentUrl)].slice(0, COVER_KEEP_HOT_COUNT)
      : [];

    for (const staleUrl of previousRecent) {
      if (!nextRecent.includes(staleUrl)) {
        pendingReleaseUrlsRef.current.add(staleUrl);
      }
    }

    recentCoverUrlsRef.current = nextRecent;

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

      if (toRelease.length > 0) {
        musicLibraryService.releaseCoverUrls(toRelease);
      }
    }, COVER_RELEASE_DELAY_MS);

    return () => {
      if (releaseTimerRef.current != null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };
  }, [preferredCoverUrl]);

  useEffect(() => {
    return () => {
      releaseTrackedCoverUrls();
    };
  }, []);

  return preferredCoverUrl;
}

