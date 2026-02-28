import {
  createDefaultMusicLibraryBaseFilterGroup,
  type MusicLibraryBaseField,
  type MusicLibraryBaseFilter,
  type MusicLibraryBaseFilterGroup,
  type MusicLibraryBaseGroupRule,
  type MusicLibraryBaseLogicalOperator,
  type MusicLibraryBaseOperator,
  type MusicLibraryBaseSortRule,
} from './baseQuery';

const OPERATORS_REQUIRING_VALUE = new Set<MusicLibraryBaseOperator>([
  'contains',
  'equals',
  'not_equals',
  'gte',
  'lte',
]);

function moveRuleById<T extends { id: string }>(rules: T[], id: string, offset: -1 | 1): T[] {
  const from = rules.findIndex((item) => item.id === id);
  if (from < 0) return rules;

  const to = from + offset;
  if (to < 0 || to >= rules.length) return rules;

  const next = [...rules];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function createFilterValue(
  operator: MusicLibraryBaseOperator,
  value: string
): { valid: boolean; value: string } {
  const normalizedValue = value.trim();
  if (OPERATORS_REQUIRING_VALUE.has(operator) && normalizedValue.length === 0) {
    return { valid: false, value: normalizedValue };
  }
  return { valid: true, value: normalizedValue };
}

export type MusicLibraryBaseFilterGroupState = {
  filterGroups: MusicLibraryBaseFilterGroup[];
  activeFilterGroupId: string | null;
};

export function createMusicLibraryBaseEntityId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendMusicLibraryBaseSortRule(
  rules: MusicLibraryBaseSortRule[]
): MusicLibraryBaseSortRule[] {
  return [
    ...rules,
    {
      id: createMusicLibraryBaseEntityId('sort'),
      field: 'title',
      order: 'asc',
    },
  ];
}

export function appendMusicLibraryBaseGroupByRule(
  rules: MusicLibraryBaseGroupRule[]
): MusicLibraryBaseGroupRule[] {
  return [
    ...rules,
    {
      id: createMusicLibraryBaseEntityId('group'),
      field: 'artist',
      order: 'asc',
    },
  ];
}

export function updateMusicLibraryBaseSortRule(
  rules: MusicLibraryBaseSortRule[],
  id: string,
  patch: Partial<Pick<MusicLibraryBaseSortRule, 'field' | 'order'>>
): MusicLibraryBaseSortRule[] {
  return rules.map((rule) =>
    rule.id === id
      ? {
          ...rule,
          ...(patch.field ? { field: patch.field } : {}),
          ...(patch.order ? { order: patch.order } : {}),
        }
      : rule
  );
}

export function updateMusicLibraryBaseGroupByRule(
  rules: MusicLibraryBaseGroupRule[],
  id: string,
  patch: Partial<Pick<MusicLibraryBaseGroupRule, 'field' | 'order'>>
): MusicLibraryBaseGroupRule[] {
  return rules.map((rule) =>
    rule.id === id
      ? {
          ...rule,
          ...(patch.field ? { field: patch.field } : {}),
          ...(patch.order ? { order: patch.order } : {}),
        }
      : rule
  );
}

export function removeMusicLibraryBaseSortRule(
  rules: MusicLibraryBaseSortRule[],
  id: string
): MusicLibraryBaseSortRule[] {
  return rules.filter((rule) => rule.id !== id);
}

export function removeMusicLibraryBaseGroupByRule(
  rules: MusicLibraryBaseGroupRule[],
  id: string
): MusicLibraryBaseGroupRule[] {
  return rules.filter((rule) => rule.id !== id);
}

export function moveMusicLibraryBaseSortRule(
  rules: MusicLibraryBaseSortRule[],
  id: string,
  offset: -1 | 1
): MusicLibraryBaseSortRule[] {
  return moveRuleById(rules, id, offset);
}

export function moveMusicLibraryBaseGroupByRule(
  rules: MusicLibraryBaseGroupRule[],
  id: string,
  offset: -1 | 1
): MusicLibraryBaseGroupRule[] {
  return moveRuleById(rules, id, offset);
}

export function appendMusicLibraryBaseFilterGroup(
  state: MusicLibraryBaseFilterGroupState
): MusicLibraryBaseFilterGroupState {
  const groupId = createMusicLibraryBaseEntityId('filter-group');
  return {
    filterGroups: [...state.filterGroups, createDefaultMusicLibraryBaseFilterGroup(groupId)],
    activeFilterGroupId: groupId,
  };
}

export function updateMusicLibraryBaseFilterGroupOperator(
  groups: MusicLibraryBaseFilterGroup[],
  groupId: string,
  operator: MusicLibraryBaseLogicalOperator
): MusicLibraryBaseFilterGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, operator } : group));
}

export function removeMusicLibraryBaseFilterGroup(
  state: MusicLibraryBaseFilterGroupState,
  groupId: string
): MusicLibraryBaseFilterGroupState {
  const nextGroups = state.filterGroups.filter((group) => group.id !== groupId);
  return {
    filterGroups: nextGroups,
    activeFilterGroupId:
      state.activeFilterGroupId === groupId ? (nextGroups[0]?.id ?? null) : state.activeFilterGroupId,
  };
}

export function appendMusicLibraryBaseFilter(
  state: MusicLibraryBaseFilterGroupState,
  field: MusicLibraryBaseField,
  operator: MusicLibraryBaseOperator,
  rawValue: string
): MusicLibraryBaseFilterGroupState & { added: boolean } {
  const valueResult = createFilterValue(operator, rawValue);
  if (!valueResult.valid) {
    return {
      ...state,
      added: false,
    };
  }

  const nextFilter: MusicLibraryBaseFilter = {
    id: createMusicLibraryBaseEntityId('filter'),
    field,
    operator,
    value: valueResult.value,
  };

  const fallbackGroupId = state.filterGroups[0]?.id ?? null;
  const targetGroupId =
    state.activeFilterGroupId && state.filterGroups.some((group) => group.id === state.activeFilterGroupId)
      ? state.activeFilterGroupId
      : fallbackGroupId;

  if (!targetGroupId) {
    const createdGroupId = createMusicLibraryBaseEntityId('filter-group');
    return {
      filterGroups: [
        {
          ...createDefaultMusicLibraryBaseFilterGroup(createdGroupId),
          filters: [nextFilter],
        },
      ],
      activeFilterGroupId: createdGroupId,
      added: true,
    };
  }

  return {
    filterGroups: state.filterGroups.map((group) =>
      group.id === targetGroupId ? { ...group, filters: [...group.filters, nextFilter] } : group
    ),
    activeFilterGroupId: targetGroupId,
    added: true,
  };
}

export function removeMusicLibraryBaseFilter(
  groups: MusicLibraryBaseFilterGroup[],
  groupId: string,
  filterId: string
): MusicLibraryBaseFilterGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          filters: group.filters.filter((filter) => filter.id !== filterId),
        }
      : group
  );
}

export function createMusicLibraryBaseEmptyFilterState(): {
  filterJoinOperator: MusicLibraryBaseLogicalOperator;
  filterGroups: MusicLibraryBaseFilterGroup[];
  activeFilterGroupId: string | null;
} {
  return {
    filterJoinOperator: 'and',
    filterGroups: [],
    activeFilterGroupId: null,
  };
}

export function createMusicLibraryBaseQuickFilterState(
  field: MusicLibraryBaseField,
  rawValue: string
): {
  filterJoinOperator: MusicLibraryBaseLogicalOperator;
  filterGroups: MusicLibraryBaseFilterGroup[];
  activeFilterGroupId: string | null;
} | null {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) return null;

  const quickFilter: MusicLibraryBaseFilter = {
    id: createMusicLibraryBaseEntityId('filter'),
    field,
    operator: 'equals',
    value: normalizedValue,
  };

  const quickGroupId = createMusicLibraryBaseEntityId('filter-group');
  return {
    filterJoinOperator: 'and',
    filterGroups: [
      {
        ...createDefaultMusicLibraryBaseFilterGroup(quickGroupId),
        filters: [quickFilter],
      },
    ],
    activeFilterGroupId: quickGroupId,
  };
}
