import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../services/audio/types';

const mocks = vi.hoisted(() => ({
  readPage: vi.fn(),
  getAllTracks: vi.fn(),
  persist: vi.fn(),
  loadState: vi.fn(),
  contextMenu: vi.fn(),
  audio: { onStateChange: () => () => {}, onError: () => () => {}, getPlaylists: () => [] },
  kernel: { events: { emit: () => {} } },
  navigation: { navigateTo: () => {} },
}));

vi.mock('../../utils/tauriRuntime', () => ({ isTauriRuntime: () => true }));
vi.mock('../../contexts/AudioEngineContext', () => ({ useAudioService: () => mocks.audio }));
vi.mock('../../contexts/KernelApiContext', () => ({ useKernel: () => mocks.kernel }));
vi.mock('../../contexts/NavigationContext', () => ({ useNavigation: () => mocks.navigation }));
vi.mock('../../modules/debug', () => ({ getProcessPerfTotalsSnapshot: async () => null }));
vi.mock('../../services/performance-control', () => ({ getGlobalProcessPerfService: () => null }));
vi.mock('../../services/telemetry/scenarioSnapshots', () => ({ captureTelemetryScenarioSnapshot: () => {} }));
vi.mock('../magnet/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../magnet/ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('../magnet/trackContextMenu', () => ({ buildLibraryTrackContextMenu: mocks.contextMenu }));
vi.mock('../../themes/skinSurface', () => ({
  useSkinSurfaceModel: () => ({
    root: {}, variant: 'default',
    getElementProps: ({ className, style }: { className?: string; style?: object }) => ({ className, style }),
  }),
}));
vi.mock('../../modules/music-library/basePersistence', () => ({
  loadMusicLibraryBaseState: mocks.loadState,
  persistMusicLibraryBaseState: mocks.persist,
  loadMusicLibraryBaseFieldCapabilities: () => [],
  persistMusicLibraryBaseFieldCapabilities: () => {},
}));
vi.mock('../../services/audio/MusicLibraryService', () => ({
  musicLibraryService: {
    queryLocalTracksPageByBase: mocks.readPage,
    getAllTracks: mocks.getAllTracks,
    getLibraryStats: async () => ({ totalTracks: 181, totalAlbums: 10, totalArtists: 10, totalSize: 100, totalDuration: 100 }),
    getLibraryPaths: async () => [],
    getBaseFieldFacetValues: async () => [],
    onScanProgress: () => () => {},
    loadAndRegisterNativeSchemaEnvelope: async () => null,
    releaseLibraryViewRuntimeMemory: () => {},
    applyCoverRuntimeCachePolicy: () => {},
    getCurrentCoverRuntimeCachePolicy: () => 'hidden',
    getCoverRuntimeCacheStats: () => ({}),
  },
}));

import { MusicLibrary } from './MusicLibrary';
import { applyMusicLibraryBaseQuery, createDefaultMusicLibraryBaseSchema } from '../../modules/music-library/baseQuery';
import { cloneDefaultLocalTrackColumnSettings } from '../../modules/music-library/localTrackColumns';

describe('music library loading and persisted filters', () => {
  let root: Root;
  let container: HTMLDivElement;
  const songs: Track[] = [
    { id: '1', title: 'Visible song one', album: 'Visible album', trackNumber: 1 },
    { id: '2', title: 'Visible song two', album: 'Visible album', trackNumber: 2 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.contextMenu.mockReturnValue([]);
    mocks.loadState.mockReturnValue({ schema: createDefaultMusicLibraryBaseSchema(), columns: cloneDefaultLocalTrackColumnSettings() });
    mocks.readPage.mockResolvedValue({ tracks: songs, total: songs.length });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('uses only native paging for the desktop default view and renders loaded rows', async () => {
    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
    expect(container.textContent).toContain('Visible song one');
    expect(mocks.readPage).toHaveBeenCalledTimes(1);
    expect(mocks.getAllTracks).not.toHaveBeenCalled();
  });

  it('shows a persisted no-match filter and restores songs when it is cleared', async () => {
    const schema = createDefaultMusicLibraryBaseSchema();
    schema.query.filterGroups = [{ id: 'saved-album', operator: 'and', filters: [{ id: 'album', field: 'album', operator: 'equals', value: 'Hidden album' }] }];
    mocks.loadState.mockReturnValue({ schema, columns: cloneDefaultLocalTrackColumnSettings() });
    mocks.readPage.mockImplementation(async ({ baseQuery }) => baseQuery.filterGroups.length > 0
      ? { tracks: [], total: 0 }
      : { tracks: songs, total: songs.length });

    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('没有符合当前条件');
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(0);
    expect(mocks.readPage).toHaveBeenCalledTimes(1);
    const clear = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '清空筛选');
    expect(clear).toBeDefined();
    await act(async () => clear!.click());
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
    expect(mocks.getAllTracks).not.toHaveBeenCalled();
  });

  it('shows query failure without silently invoking an unbounded fallback', async () => {
    mocks.readPage.mockResolvedValue(null);
    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('歌曲列表加载失败');
    expect(mocks.getAllTracks).not.toHaveBeenCalled();
    expect(mocks.readPage).toHaveBeenCalledTimes(1);

    mocks.readPage.mockResolvedValue({ tracks: songs, total: songs.length });
    await act(async () => (container.querySelector('[role="alert"] button') as HTMLButtonElement).click());
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores an old response after closing and reopening the same query', async () => {
    let finishOld!: (page: { tracks: Track[]; total: number }) => void;
    mocks.readPage.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    await act(async () => root.render(<MusicLibrary embedded />));
    await act(async () => root.render(<MusicLibrary embedded isOpen={false} />));
    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
    await act(async () => finishOld({ tracks: [], total: 0 }));
    expect(container.querySelectorAll('[data-track-id]')).toHaveLength(2);
    expect(mocks.getAllTracks).not.toHaveBeenCalled();
  });

  it('keeps view-album navigation out of persisted filter and sort preferences', async () => {
    mocks.readPage.mockResolvedValue({ tracks: [{ ...songs[0], trackNumber: 7 }], total: 1 });
    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelector('.music-library-track-number')?.textContent).toBe('1');
    await act(async () => container.querySelector('[data-track-id]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    const options = mocks.contextMenu.mock.calls[0][0];
    await act(async () => options.onViewAlbum());
    expect(container.querySelector('.music-library-track-number')?.textContent).toBe('7');
    const lastSaved = mocks.persist.mock.calls.at(-1)![0];
    expect(lastSaved.query.filterGroups).toEqual([]);
    expect(lastSaved.query.sortRules).toEqual([]);
    expect(mocks.readPage.mock.calls.at(-1)![0].baseQuery.sortRules.map((rule: { field: string }) => rule.field)).toEqual(['discNumber', 'trackNumber', 'title']);
  });

  it('lets header sorting replace album order, supports Shift, and clears the album label with the filter', async () => {
    const albumTracks: Track[] = [
      { id: 'first', title: 'Z', album: 'Visible album', trackNumber: 1, duration: 30 },
      { id: 'second', title: 'A', album: 'Visible album', trackNumber: 2, duration: 10 },
      { id: 'third', title: 'M', album: 'Visible album', trackNumber: 3, duration: 10 },
    ];
    mocks.readPage.mockImplementation(async ({ baseQuery }) => ({
      tracks: applyMusicLibraryBaseQuery(albumTracks, baseQuery), total: albumTracks.length,
    }));
    const rowIds = () => Array.from(container.querySelectorAll('[data-track-id]')).map(row => row.getAttribute('data-track-id'));
    const header = (field: string) => container.querySelector(`[data-local-track-column-id="${field}"] .music-library-list-header-sort-btn`) as HTMLButtonElement;
    await act(async () => root.render(<MusicLibrary embedded />));
    expect(container.querySelector('.music-library-current-album')).toBeNull();
    await act(async () => container.querySelector('[data-track-id]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    await act(async () => mocks.contextMenu.mock.calls[0][0].onViewAlbum());
    expect(rowIds()).toEqual(['first', 'second', 'third']);
    expect(container.querySelector('.music-library-local-ops .music-library-current-album')?.textContent).toBe('当前专辑：Visible album');

    await act(async () => header('title').click());
    expect(rowIds()).toEqual(['second', 'third', 'first']);
    expect(mocks.readPage.mock.calls.at(-1)![0].baseQuery.sortRules.map((rule: { field: string }) => rule.field)).toEqual(['title']);
    await act(async () => header('title').click());
    expect(rowIds()).toEqual(['first', 'third', 'second']);
    await act(async () => header('duration').click());
    await act(async () => header('title').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
    expect(mocks.readPage.mock.calls.at(-1)![0].baseQuery.sortRules.map((rule: { field: string }) => rule.field)).toEqual(['duration', 'title']);
    expect(rowIds()).toEqual(['second', 'third', 'first']);
    expect(container.querySelector('.music-library-track-number')?.textContent).toBe('2');

    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.startsWith('筛选'))!.click());
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '清空筛选')!.click());
    expect(container.querySelector('.music-library-current-album')).toBeNull();
  });
});
