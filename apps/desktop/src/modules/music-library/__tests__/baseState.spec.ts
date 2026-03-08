import { describe, expect, it } from 'vitest';
import {
  appendMusicLibraryBaseFilter,
  appendMusicLibraryBaseFilterGroup,
  appendMusicLibraryBaseGroupByRule,
  appendMusicLibraryBaseSortRule,
  createMusicLibraryBaseEmptyFilterState,
  createMusicLibraryBaseQuickFilterState,
  moveMusicLibraryBaseSortRule,
  removeMusicLibraryBaseFilter,
  removeMusicLibraryBaseFilterGroup,
  toggleMusicLibraryBaseSortField,
  updateMusicLibraryBaseGroupByRule,
  updateMusicLibraryBaseFilterGroupOperator,
  updateMusicLibraryBaseSortRule,
} from '../baseState';

describe('baseState helpers', () => {
  it('appends default group-by and sort rules', () => {
    const nextSort = appendMusicLibraryBaseSortRule([]);
    const nextGroup = appendMusicLibraryBaseGroupByRule([]);

    expect(nextSort).toHaveLength(1);
    expect(nextSort[0].field).toBe('title');
    expect(nextSort[0].order).toBe('asc');

    expect(nextGroup).toHaveLength(1);
    expect(nextGroup[0].field).toBe('artist');
    expect(nextGroup[0].order).toBe('asc');
  });

  it('appends the next available rule field instead of duplicating existing rules', () => {
    const nextSort = appendMusicLibraryBaseSortRule([
      { id: 'sort-1', field: 'title', order: 'asc' },
      { id: 'sort-2', field: 'artist', order: 'asc' },
    ]);
    const nextGroup = appendMusicLibraryBaseGroupByRule([
      { id: 'group-1', field: 'artist', order: 'asc' },
      { id: 'group-2', field: 'album', order: 'asc' },
    ]);

    expect(nextSort.at(-1)?.field).toBe('album');
    expect(nextGroup.at(-1)?.field).toBe('genre');
  });

  it('skips excluded fields when appending sort rules for grouped views', () => {
    const nextSort = appendMusicLibraryBaseSortRule(
      [{ id: 'sort-1', field: 'title', order: 'asc' }],
      { excludedFields: ['artist', 'album'] }
    );

    expect(nextSort.at(-1)?.field).toBe('genre');
  });

  it('moves sort rules by offset', () => {
    const moved = moveMusicLibraryBaseSortRule(
      [
        { id: 'rule-1', field: 'title', order: 'asc' },
        { id: 'rule-2', field: 'artist', order: 'asc' },
      ],
      'rule-2',
      -1
    );

    expect(moved.map((item) => item.id)).toEqual(['rule-2', 'rule-1']);
  });

  it('cycles primary sort field through asc desc default', () => {
    const asc = toggleMusicLibraryBaseSortField([], 'title');
    expect(asc).toHaveLength(1);
    expect(asc[0].field).toBe('title');
    expect(asc[0].order).toBe('asc');

    const desc = toggleMusicLibraryBaseSortField(asc, 'title');
    expect(desc[0].order).toBe('desc');

    const cleared = toggleMusicLibraryBaseSortField(desc, 'title');
    expect(cleared).toEqual([]);
  });

  it('keeps first clicked field at highest priority in multi-sort mode', () => {
    const base = toggleMusicLibraryBaseSortField([], 'artist');
    const multi = toggleMusicLibraryBaseSortField(base, 'album', { multi: true });

    expect(multi.map((item) => item.field)).toEqual(['artist', 'album']);
    expect(multi[1].order).toBe('asc');

    const toggled = toggleMusicLibraryBaseSortField(multi, 'album', { multi: true });
    expect(toggled[1].order).toBe('desc');

    const removed = toggleMusicLibraryBaseSortField(toggled, 'album', { multi: true });
    expect(removed.map((item) => item.field)).toEqual(['artist']);
  });

  it('appends newly clicked fields after existing priorities', () => {
    const step1 = toggleMusicLibraryBaseSortField([], 'title');
    const step2 = toggleMusicLibraryBaseSortField(step1, 'artist', { multi: true });
    const step3 = toggleMusicLibraryBaseSortField(step2, 'album', { multi: true });

    expect(step3.map((item) => item.field)).toEqual(['title', 'artist', 'album']);
    expect(step3[0].order).toBe('asc');
  });

  it('does not change priority when toggling an existing field order', () => {
    const initial: Parameters<typeof toggleMusicLibraryBaseSortField>[0] = [
      { id: 'sort-1', field: 'title', order: 'asc' as const },
      { id: 'sort-2', field: 'artist', order: 'asc' as const },
      { id: 'sort-3', field: 'album', order: 'asc' as const },
    ];

    const toggled = toggleMusicLibraryBaseSortField(initial, 'artist');

    expect(toggled.map((item) => item.field)).toEqual(['title', 'artist', 'album']);
    expect(toggled[1].order).toBe('desc');
  });

  it('deduplicates sort and group rules when changing a field to an existing one', () => {
    const nextSort = updateMusicLibraryBaseSortRule(
      [
        { id: 'sort-1', field: 'title', order: 'asc' },
        { id: 'sort-2', field: 'artist', order: 'desc' },
      ],
      'sort-2',
      { field: 'title' }
    );

    const nextGroup = updateMusicLibraryBaseGroupByRule(
      [
        { id: 'group-1', field: 'artist', order: 'asc' },
        { id: 'group-2', field: 'album', order: 'desc' },
      ],
      'group-2',
      { field: 'artist' }
    );

    expect(nextSort).toHaveLength(1);
    expect(nextSort[0]).toMatchObject({ id: 'sort-2', field: 'title', order: 'desc' });

    expect(nextGroup).toHaveLength(1);
    expect(nextGroup[0]).toMatchObject({ id: 'group-2', field: 'artist', order: 'desc' });
  });

  it('adds filter into an existing selected group', () => {
    const added = appendMusicLibraryBaseFilter(
      {
        filterGroups: [
          {
            id: 'group-1',
            operator: 'and',
            filters: [],
          },
        ],
        activeFilterGroupId: 'group-1',
      },
      'artist',
      'contains',
      '  test artist  '
    );

    expect(added.added).toBe(true);
    expect(added.filterGroups[0].filters).toHaveLength(1);
    expect(added.filterGroups[0].filters[0].value).toBe('test artist');
  });

  it('rejects value-required filter when value is empty', () => {
    const rejected = appendMusicLibraryBaseFilter(
      {
        filterGroups: [],
        activeFilterGroupId: null,
      },
      'artist',
      'contains',
      '   '
    );

    expect(rejected.added).toBe(false);
    expect(rejected.filterGroups).toHaveLength(0);
  });

  it('creates a new group when adding filter without existing groups', () => {
    const added = appendMusicLibraryBaseFilter(
      {
        filterGroups: [],
        activeFilterGroupId: null,
      },
      'album',
      'equals',
      'Album A'
    );

    expect(added.added).toBe(true);
    expect(added.filterGroups).toHaveLength(1);
    expect(added.activeFilterGroupId).toBeTruthy();
    expect(added.filterGroups[0].filters[0].field).toBe('album');
  });

  it('updates and removes filter groups with active-group fallback', () => {
    const created = appendMusicLibraryBaseFilterGroup({
      filterGroups: [],
      activeFilterGroupId: null,
    });
    const groupA = created.filterGroups[0];

    const created2 = appendMusicLibraryBaseFilterGroup(created);
    const groupB = created2.filterGroups[1];

    const updated = updateMusicLibraryBaseFilterGroupOperator(created2.filterGroups, groupA.id, 'or');
    expect(updated[0].operator).toBe('or');

    const removed = removeMusicLibraryBaseFilterGroup(
      {
        filterGroups: created2.filterGroups,
        activeFilterGroupId: groupB.id,
      },
      groupB.id
    );
    expect(removed.filterGroups).toHaveLength(1);
    expect(removed.activeFilterGroupId).toBe(groupA.id);
  });

  it('removes filter entries from a group', () => {
    const removed = removeMusicLibraryBaseFilter(
      [
        {
          id: 'group-1',
          operator: 'and',
          filters: [
            { id: 'f-1', field: 'artist', operator: 'contains', value: 'a' },
            { id: 'f-2', field: 'album', operator: 'equals', value: 'b' },
          ],
        },
      ],
      'group-1',
      'f-1'
    );

    expect(removed[0].filters).toHaveLength(1);
    expect(removed[0].filters[0].id).toBe('f-2');
  });

  it('builds quick-filter state and empty-filter defaults', () => {
    const quick = createMusicLibraryBaseQuickFilterState('genre', '  Rock  ');
    expect(quick).not.toBeNull();
    expect(quick?.filterJoinOperator).toBe('and');
    expect(quick?.filterGroups).toHaveLength(1);
    expect(quick?.filterGroups[0].filters[0].value).toBe('Rock');

    const empty = createMusicLibraryBaseQuickFilterState('genre', '    ');
    expect(empty).toBeNull();

    const defaults = createMusicLibraryBaseEmptyFilterState();
    expect(defaults.filterJoinOperator).toBe('and');
    expect(defaults.filterGroups).toEqual([]);
    expect(defaults.activeFilterGroupId).toBeNull();
  });
});
