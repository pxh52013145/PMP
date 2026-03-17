import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Track } from '../../../../services/audio';
import {
  PMP_STORAGE_CHANGE_EVENT,
  type PmpStorageChangeDetail,
} from '../../../../modules/storage/localStorage';
import { musicLibraryService } from '../../../../services/audio/MusicLibraryService';
import { STORAGE_KEYS } from '../../../../utils/windowCommunication';
import { useCoverUrlForTrack } from '../useCoverUrlForTrack';

function HookProbe(props: {
  track: Track | null;
  onRender: (value: string | undefined) => void;
}) {
  const coverUrl = useCoverUrlForTrack(props.track, { coverSizeHint: 'small' });
  props.onRender(coverUrl);
  return null;
}

describe('useCoverUrlForTrack', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('re-resolves when the cover thumbnail quality setting changes', async () => {
    const track = {
      id: 'track-cover-1',
      title: 'Cover Test',
      filePath: 'C:\\Music\\cover-test.mp3',
    } as Track;

    let requestCount = 0;
    const getCoverUrlSpy = vi
      .spyOn(musicLibraryService, 'getCoverUrlForTrack')
      .mockImplementation(async () => `pmp://cover/mock-${++requestCount}`);

    const renders: Array<string | undefined> = [];

    await act(async () => {
      root?.render(<HookProbe track={track} onRender={(value) => renders.push(value)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCoverUrlSpy).toHaveBeenCalledTimes(1);
    expect(renders.at(-1)).toBe('pmp://cover/mock-1');

    await act(async () => {
      localStorage.setItem(STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX, JSON.stringify(128));
      window.dispatchEvent(
        new CustomEvent<PmpStorageChangeDetail>(PMP_STORAGE_CHANGE_EVENT, {
          detail: {
            key: STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
            value: JSON.stringify(128),
          },
        })
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getCoverUrlSpy).toHaveBeenCalledTimes(2);
    expect(renders.at(-1)).toBe('pmp://cover/mock-2');
  });

  it('releases the current cover immediately when the track becomes inactive', async () => {
    const track = {
      id: 'track-cover-release',
      title: 'Cover Release Test',
      filePath: 'C:\\Music\\cover-release.mp3',
    } as Track;

    vi.spyOn(musicLibraryService, 'getCoverUrlForTrack').mockResolvedValue('blob:cover-release');
    const releaseSpy = vi
      .spyOn(musicLibraryService, 'releaseCoverUrls')
      .mockImplementation(() => undefined);

    await act(async () => {
      root?.render(<HookProbe track={track} onRender={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      root?.render(<HookProbe track={null} onRender={() => undefined} />);
      await Promise.resolve();
    });

    expect(releaseSpy).toHaveBeenCalledWith(['blob:cover-release']);
  });

  it('releases the previous small cover shortly after switching tracks', async () => {
    vi.useFakeTimers();

    const firstTrack = {
      id: 'track-cover-a',
      title: 'Cover A',
      filePath: 'C:\\Music\\cover-a.mp3',
    } as Track;
    const secondTrack = {
      id: 'track-cover-b',
      title: 'Cover B',
      filePath: 'C:\\Music\\cover-b.mp3',
    } as Track;

    vi.spyOn(musicLibraryService, 'getCoverUrlForTrack').mockImplementation(async (track) => {
      if (track.id === firstTrack.id) return 'blob:cover-a';
      if (track.id === secondTrack.id) return 'blob:cover-b';
      return undefined;
    });
    const releaseSpy = vi
      .spyOn(musicLibraryService, 'releaseCoverUrls')
      .mockImplementation(() => undefined);

    await act(async () => {
      root?.render(<HookProbe track={firstTrack} onRender={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    releaseSpy.mockClear();

    await act(async () => {
      root?.render(<HookProbe track={secondTrack} onRender={() => undefined} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(releaseSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(119);
    });
    expect(releaseSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(releaseSpy).toHaveBeenCalledWith(['blob:cover-a']);

  });
});
