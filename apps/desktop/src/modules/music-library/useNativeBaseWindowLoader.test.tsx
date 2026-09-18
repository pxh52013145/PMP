import { act, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeBaseWindowLoader } from './useNativeBaseWindowLoader';
import type { NativeBaseWindowRequest } from './nativeBaseWindow';

type Page = { tracks: string[]; total: number };
type PendingPage = {
  key: string;
  offset: number;
  resolve: (page: Page) => void;
};

describe('native base window loading', () => {
  let container: HTMLDivElement;
  let root: Root;
  let pending: PendingPage[];

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    pending = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  // Exercise React's effect ordering: query reset changes refs immediately,
  // but the loading state in that render still belongs to the previous query.
  function LibraryWindow({ queryKey, offset = 0 }: { queryKey: string; offset?: number }) {
    const keyRef = useRef('');
    const tracksRef = useRef<string[]>([]);
    const offsetRef = useRef(0);
    const loadingRef = useRef(false);
    const [isLoading, setIsLoading] = useState(false);
    const [tracks, setTracks] = useState<string[]>([]);
    const [total, setTotal] = useState<number | null>(null);

    useEffect(() => {
      keyRef.current = queryKey;
      tracksRef.current = [];
      offsetRef.current = 0;
      loadingRef.current = false;
      setTracks([]);
      setTotal(null);
    }, [queryKey]);

    const load = useCallback(async (request: NativeBaseWindowRequest) => {
      if (loadingRef.current) return false;
      loadingRef.current = true;
      setIsLoading(true);
      try {
        const page = await new Promise<Page>((resolve) => {
          pending.push({ key: queryKey, offset: request.offset, resolve });
        });
        if (keyRef.current !== queryKey) return false;
        tracksRef.current = page.tracks;
        offsetRef.current = request.offset;
        setTracks(page.tracks);
        setTotal(page.total);
        return page.tracks.length > 0;
      } finally {
        if (keyRef.current === queryKey) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    }, [queryKey]);

    useNativeBaseWindowLoader({
      enabled: true,
      queryKey,
      request: { offset, limit: 2 },
      total,
      tracksRef,
      offsetRef,
      loadingRef,
      isLoading,
      load,
    });

    return <div aria-busy={isLoading}>{tracks.map((track) => <span key={track}>{track}</span>)}</div>;
  }

  it('starts the replacement query while a cancelled query still has rendered loading state', async () => {
    act(() => root.render(<LibraryWindow queryKey="title" />));
    expect(pending.map((page) => page.key)).toEqual(['title']);

    act(() => root.render(<LibraryWindow queryKey="album" />));
    expect(pending.map((page) => page.key)).toEqual(['title', 'album']);

    await act(async () => pending[1].resolve({ tracks: ['Album song 1', 'Album song 2'], total: 2 }));
    expect(container.textContent).toBe('Album song 1Album song 2');
    await act(async () => pending[0].resolve({ tracks: ['Obsolete result'], total: 1 }));
    expect(container.textContent).toBe('Album song 1Album song 2');
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('false');
    expect(pending).toHaveLength(2);
  });

  it('loads the latest scrolled window when the in-flight page finishes', async () => {
    act(() => root.render(<LibraryWindow queryKey="album" />));
    act(() => root.render(<LibraryWindow queryKey="album" offset={2} />));
    expect(pending).toHaveLength(1);

    await act(async () => pending[0].resolve({ tracks: ['Song 1', 'Song 2'], total: 4 }));
    expect(pending.map((page) => page.offset)).toEqual([0, 2]);
    await act(async () => pending[1].resolve({ tracks: ['Song 3', 'Song 4'], total: 4 }));
    expect(container.textContent).toBe('Song 3Song 4');
    expect(pending).toHaveLength(2);
  });

  it('keeps a successful empty result empty without repeatedly fetching it', async () => {
    act(() => root.render(<LibraryWindow queryKey="empty-filter" />));
    await act(async () => pending[0].resolve({ tracks: [], total: 0 }));
    expect(container.textContent).toBe('');
    expect(container.firstElementChild?.getAttribute('aria-busy')).toBe('false');
    expect(pending).toHaveLength(1);
  });
});
