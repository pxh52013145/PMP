import { useEffect, useMemo, useState } from 'react';

import type { Track } from '../../../services/audio';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import { isTauriRuntime } from '../../../utils/tauriRuntime';
import { trackKey } from './trackKey';

type CoverUrlState = { key: string; url?: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function useCoverUrlForTrack(track: Track | null): string | undefined {
  const key = useMemo(() => trackKey(track), [track]);
  const embeddedCoverUrl = isNonEmptyString(track?.coverUrl) ? track.coverUrl : undefined;
  const isAbsolutePath = useMemo(() => {
    const candidate = String(track?.filePath || track?.path || '');
    if (!candidate) return false;
    if (candidate.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(candidate);
  }, [track?.filePath, track?.path]);

  const [resolved, setResolved] = useState<CoverUrlState>({ key: 'none' });

  const fetchKey = useMemo(() => {
    if (!track) return 'none';
    return [
      key,
      track.filePath || '',
      track.path || '',
      track.coverKey || '',
      track.coverUrl || '',
    ].join('|');
  }, [key, track]);

  useEffect(() => {
    if (!track) return;

    let cancelled = false;
    const currentKey = key;

    void musicLibraryService.getCoverUrlForTrack(track).then((url) => {
      if (cancelled) return;
      if (!isNonEmptyString(url)) return;
      setResolved({ key: currentKey, url });
    });

    return () => {
      cancelled = true;
    };
  }, [fetchKey, key, track]);

  const resolvedUrl = resolved.key === key ? resolved.url : undefined;

  const embeddedIsEphemeral =
    embeddedCoverUrl && (embeddedCoverUrl.startsWith('blob:') || embeddedCoverUrl.startsWith('data:'));

  if (embeddedIsEphemeral) {
    // Desktop/Tauri: avoid keeping large embedded cover payloads in memory for absolute-path tracks.
    // Prefer resolving via Rust cover cache (asset protocol) instead.
    if (isTauriRuntime() && isAbsolutePath) {
      return resolvedUrl;
    }
    return embeddedCoverUrl;
  }

  return resolvedUrl ?? embeddedCoverUrl;
}

