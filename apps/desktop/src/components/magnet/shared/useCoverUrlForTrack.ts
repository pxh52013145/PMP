import { useEffect, useMemo, useState } from 'react';

import type { Track } from '../../../services/audio';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import { trackKey } from './trackKey';

type CoverUrlState = { key: string; url?: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function useCoverUrlForTrack(track: Track | null): string | undefined {
  const key = useMemo(() => trackKey(track), [track]);
  const embeddedCoverUrl = isNonEmptyString(track?.coverUrl) ? track.coverUrl : undefined;

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

  if (embeddedCoverUrl && (embeddedCoverUrl.startsWith('blob:') || embeddedCoverUrl.startsWith('data:'))) {
    return embeddedCoverUrl;
  }

  return resolvedUrl ?? embeddedCoverUrl;
}

