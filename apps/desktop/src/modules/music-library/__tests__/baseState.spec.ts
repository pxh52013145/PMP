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
  updateMusicLibraryBaseFilterGroupOperator,
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
