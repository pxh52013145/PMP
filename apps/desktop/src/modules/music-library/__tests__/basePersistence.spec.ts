import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import {
  loadMusicLibraryBaseFieldCapabilities,
  loadMusicLibraryBaseState,
  persistMusicLibraryBaseFieldCapabilities,
  persistMusicLibraryBaseState,
} from '../basePersistence';

const storageMocks = vi.hoisted(() => ({
  readJson: vi.fn(),
  writeJson: vi.fn(),
}));

vi.mock('../../storage', () => storageMocks);

type TestColumn = {
  id: string;
  visible: boolean;
  widthPx?: number;
};

describe('basePersistence', () => {
  beforeEach(() => {
    storageMocks.readJson.mockReset();
    storageMocks.writeJson.mockReset();
  });

  it('loads normalized schema when base schema exists', () => {
    storageMocks.readJson.mockImplementation((key: string, fallback: unknown) => {
      if (key === STORAGE_KEYS.MUSIC_LIBRARY_BASE_SCHEMA_V1) {
        return {
          version: 1,
          query: {
            filterOperator: 'or',
            filterGroups: [
              {
                id: 'group-1',
                operator: 'and',
                filters: [{ id: 'filter-1', field: 'artist', operator: 'contains', value: 'abc' }],
              },
            ],
            groupByRules: [],
            sortRules: [],
          },
          view: {
            mode: 'card',
            properties: [{ id: 'title', visible: true, widthPx: 320 }],
          },
        };
      }
      return fallback;
    });

    const applyViewPropertiesToColumns = vi.fn((properties: unknown[]) => {
      void properties;
      return [{ id: 'title', visible: true, widthPx: 320 }];
    });

    const result = loadMusicLibraryBaseState<TestColumn>({
      createDefaultColumns: () => [{ id: 'title', visible: true, widthPx: 240 }],
      normalizeColumns: vi.fn((input: unknown) => input as TestColumn[]),
      applyBaseViewPropertiesToColumns: applyViewPropertiesToColumns,
    });

    expect(result.schema.view.mode).toBe('card');
    expect(result.schema.query.filterOperator).toBe('or');
    expect(result.columns).toEqual([{ id: 'title', visible: true, widthPx: 320 }]);
    expect(applyViewPropertiesToColumns).toHaveBeenCalledTimes(1);
  });

  it('falls back to legacy columns when schema is absent', () => {
    storageMocks.readJson.mockImplementation((key: string, fallback: unknown) => {
      if (key === STORAGE_KEYS.MUSIC_LIBRARY_BASE_SCHEMA_V1) return null;
      if (key === STORAGE_KEYS.MUSIC_LIBRARY_TRACK_COLUMNS_V1) {
        return [{ id: 'artist', visible: true, widthPx: 180 }];
      }
      return fallback;
    });

    const normalizeColumns = vi.fn((input: unknown) => {
      void input;
      return [{ id: 'artist', visible: true, widthPx: 180 }];
    });

    const result = loadMusicLibraryBaseState<TestColumn>({
      createDefaultColumns: () => [{ id: 'title', visible: true, widthPx: 240 }],
      normalizeColumns,
      applyBaseViewPropertiesToColumns: vi.fn((properties: unknown[]) => properties as TestColumn[]),
    });

    expect(result.schema.view.mode).toBe('table');
    expect(result.schema.query.filterOperator).toBe('and');
    expect(result.columns).toEqual([{ id: 'artist', visible: true, widthPx: 180 }]);
    expect(normalizeColumns).toHaveBeenCalledTimes(1);
  });

  it('persists unified base schema payload', () => {
    persistMusicLibraryBaseState<TestColumn>({
      query: {
        filterOperator: 'and',
        filterGroups: [],
        groupByRules: [],
        sortRules: [],
      },
      viewMode: 'table',
      columns: [{ id: 'title', visible: true, widthPx: 260 }],
      debounceMs: 220,
    });

    expect(storageMocks.writeJson).toHaveBeenCalledTimes(1);
    expect(storageMocks.writeJson).toHaveBeenCalledWith(
      STORAGE_KEYS.MUSIC_LIBRARY_BASE_SCHEMA_V1,
      {
        version: 1,
        query: {
          filterOperator: 'and',
          filterGroups: [],
          groupByRules: [],
          sortRules: [],
        },
        view: {
          mode: 'table',
          properties: [{ id: 'title', visible: true, widthPx: 260 }],
        },
      },
      {
        mode: 'idle',
        debounceMs: 220,
      }
    );
  });

  it('loads persisted extension field capabilities', () => {
    storageMocks.readJson.mockImplementation((key: string, fallback: unknown) => {
      if (key === STORAGE_KEYS.MUSIC_LIBRARY_FIELD_CAPABILITIES_V1) {
        return [
          {
            id: 'composerTag',
            label: 'Composer Tag',
            trackKey: 'composer',
            filterable: true,
            sortable: true,
            groupable: true,
          },
          {
            id: '',
            label: '',
          },
        ];
      }
      return fallback;
    });

    expect(loadMusicLibraryBaseFieldCapabilities()).toEqual([
      {
        id: 'composerTag',
        label: 'Composer Tag',
        kind: 'text',
        trackKey: 'composer',
        filterable: true,
        sortable: true,
        groupable: true,
        headerKey: undefined,
        nativeFilterField: undefined,
        nativeSortField: undefined,
      },
    ]);
  });

  it('persists normalized extension field capabilities payload', () => {
    persistMusicLibraryBaseFieldCapabilities(
      [
        {
          id: ' composerTag ',
          label: ' Composer Tag ',
          trackKey: ' composer ',
          filterable: true,
          sortable: true,
          groupable: false,
        },
      ],
      { debounceMs: 90 }
    );

    expect(storageMocks.writeJson).toHaveBeenCalledWith(
      STORAGE_KEYS.MUSIC_LIBRARY_FIELD_CAPABILITIES_V1,
      [
        {
          id: 'composerTag',
          label: 'Composer Tag',
          kind: 'text',
          trackKey: 'composer',
          filterable: true,
          sortable: true,
          groupable: false,
          headerKey: undefined,
          nativeFilterField: undefined,
          nativeSortField: undefined,
        },
      ],
      {
        mode: 'idle',
        debounceMs: 90,
      }
    );
  });
});
