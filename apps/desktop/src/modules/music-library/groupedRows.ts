import { Track } from '../../services/audio';
import type { MusicLibraryBaseGroupRule, MusicLibraryBaseOrderField } from './baseQuery';

export interface BuildMusicLibraryGroupedRowsOptions {
  tracks: Track[];
  groupByRules: MusicLibraryBaseGroupRule[];
  collapsedGroupKeys?: ReadonlySet<string>;
  resolveFieldLabel?: (field: MusicLibraryBaseOrderField) => string;
  resolveFieldDisplayValue?: (field: MusicLibraryBaseOrderField, track: Track) => string;
}

export interface MusicLibraryGroupHeaderRow {
  kind: 'group-header';
  id: string;
  groupKey: string;
  parentGroupKey?: string;
  field: MusicLibraryBaseOrderField;
  fieldLabel: string;
  title: string;
  count: number;
  depth: number;
  startIndex: number;
  collapsed: boolean;
}

export interface MusicLibraryTrackRow {
  kind: 'track';
  id: string;
  trackId: string;
  trackIndex: number;
  groupKey?: string;
  parentGroupKeys: string[];
}

export type MusicLibraryGroupedRow = MusicLibraryGroupHeaderRow | MusicLibraryTrackRow;

export interface SliceMusicLibraryGroupedRowsOptions {
  rows: MusicLibraryGroupedRow[];
  start: number;
  end: number;
}

export interface SliceMusicLibraryGroupedRowsResult {
  rows: MusicLibraryGroupedRow[];
  topSpacerRowCount: number;
  bottomSpacerRowCount: number;
}

type GroupPathPart = {
  groupKey: string;
  field: MusicLibraryBaseOrderField;
  fieldLabel: string;
  title: string;
  depth: number;
  parentGroupKey?: string;
};

type GroupAggregate = GroupPathPart & {
  count: number;
  startIndex: number;
};

function normalizeGroupDisplayValue(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : '-';
}

function normalizeGroupKeyValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '__empty__';
  return encodeURIComponent(trimmed);
}

function buildGroupPathParts(
  track: Track,
  rules: MusicLibraryBaseGroupRule[],
  options: BuildMusicLibraryGroupedRowsOptions
): GroupPathPart[] {
  const parts: GroupPathPart[] = [];
  let parentGroupKey: string | undefined;

  for (let depth = 0; depth < rules.length; depth += 1) {
    const rule = rules[depth];
    const field = rule.field;
    const fieldLabel = options.resolveFieldLabel?.(field) ?? field;
    const title = normalizeGroupDisplayValue(options.resolveFieldDisplayValue?.(field, track));
    const keyPart = `${field}:${normalizeGroupKeyValue(title)}`;
    const groupKey = parentGroupKey ? `${parentGroupKey}/${keyPart}` : keyPart;

    parts.push({
      groupKey,
      parentGroupKey,
      field,
      fieldLabel,
      title,
      depth,
    });

    parentGroupKey = groupKey;
  }

  return parts;
}

function commonPrefixLength(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function getActiveContextHeadersBeforeIndex(
  rows: MusicLibraryGroupedRow[],
  start: number
): MusicLibraryGroupHeaderRow[] {
  const active: MusicLibraryGroupHeaderRow[] = [];

  for (let index = 0; index < start; index += 1) {
    const row = rows[index];
    if (row.kind !== 'group-header') continue;
    active.length = row.depth;
    active[row.depth] = row;
  }

  return active.filter(Boolean);
}

export function buildMusicLibraryGroupedRows(
  options: BuildMusicLibraryGroupedRowsOptions
): MusicLibraryGroupedRow[] {
  const { tracks, groupByRules } = options;

  if (groupByRules.length === 0) {
    return tracks.map((track, trackIndex) => ({
      kind: 'track',
      id: track.id,
      trackId: track.id,
      trackIndex,
      parentGroupKeys: [],
    }));
  }

  const collapsedGroupKeys = options.collapsedGroupKeys ?? new Set<string>();
  const aggregates = new Map<string, GroupAggregate>();
  const trackGroupParts = tracks.map((track, trackIndex) => {
    const parts = buildGroupPathParts(track, groupByRules, options);

    for (const part of parts) {
      const existing = aggregates.get(part.groupKey);
      if (existing) {
        existing.count += 1;
        continue;
      }

      aggregates.set(part.groupKey, {
        ...part,
        count: 1,
        startIndex: trackIndex,
      });
    }

    return parts;
  });

  const rows: MusicLibraryGroupedRow[] = [];
  let previousVisibleGroupKeys: string[] = [];

  tracks.forEach((track, trackIndex) => {
    const pathParts = trackGroupParts[trackIndex];
    const pathGroupKeys = pathParts.map((part) => part.groupKey);
    const collapsedDepth = pathGroupKeys.findIndex((groupKey) => collapsedGroupKeys.has(groupKey));
    const visiblePathLength = collapsedDepth >= 0 ? collapsedDepth + 1 : pathGroupKeys.length;
    const visibleGroupKeys = pathGroupKeys.slice(0, visiblePathLength);
    const firstChangedDepth = commonPrefixLength(previousVisibleGroupKeys, visibleGroupKeys);

    for (let depth = firstChangedDepth; depth < visiblePathLength; depth += 1) {
      const part = pathParts[depth];
      const aggregate = aggregates.get(part.groupKey);
      if (!aggregate) continue;

      rows.push({
        kind: 'group-header',
        id: `group-header:${aggregate.groupKey}`,
        groupKey: aggregate.groupKey,
        parentGroupKey: aggregate.parentGroupKey,
        field: aggregate.field,
        fieldLabel: aggregate.fieldLabel,
        title: aggregate.title,
        count: aggregate.count,
        depth: aggregate.depth,
        startIndex: aggregate.startIndex,
        collapsed: collapsedGroupKeys.has(aggregate.groupKey),
      });
    }

    if (collapsedDepth < 0) {
      rows.push({
        kind: 'track',
        id: track.id,
        trackId: track.id,
        trackIndex,
        groupKey: visibleGroupKeys.at(-1),
        parentGroupKeys: visibleGroupKeys,
      });
    }

    previousVisibleGroupKeys = visibleGroupKeys;
  });

  return rows;
}

export function sliceMusicLibraryGroupedRows(
  options: SliceMusicLibraryGroupedRowsOptions
): SliceMusicLibraryGroupedRowsResult {
  const total = options.rows.length;
  const start = Math.max(0, Math.min(total, Math.floor(options.start)));
  const end = Math.max(start, Math.min(total, Math.floor(options.end)));
  const windowRows = options.rows.slice(start, end);

  if (windowRows.length === 0) {
    return {
      rows: [],
      topSpacerRowCount: start,
      bottomSpacerRowCount: total - end,
    };
  }

  if (start === 0) {
    return {
      rows: windowRows,
      topSpacerRowCount: 0,
      bottomSpacerRowCount: total - end,
    };
  }

  const activeHeaders = getActiveContextHeadersBeforeIndex(options.rows, start);
  const firstRow = windowRows[0];
  const contextHeaders =
    firstRow.kind === 'group-header'
      ? activeHeaders.slice(0, firstRow.depth)
      : activeHeaders;

  return {
    rows: [...contextHeaders, ...windowRows],
    topSpacerRowCount: Math.max(0, start - contextHeaders.length),
    bottomSpacerRowCount: total - end,
  };
}
