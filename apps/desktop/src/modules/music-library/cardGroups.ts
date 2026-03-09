import type {
  MusicLibraryGroupHeaderRow,
  MusicLibraryGroupedRow,
  MusicLibraryTrackRow,
} from './groupedRows';

export type MusicLibraryCardGroupEntry =
  | {
      kind: 'group';
      node: MusicLibraryCardGroupNode;
    }
  | {
      kind: 'track';
      row: MusicLibraryTrackRow;
    };

export interface MusicLibraryCardGroupNode {
  header: MusicLibraryGroupHeaderRow;
  entries: MusicLibraryCardGroupEntry[];
}

export interface MusicLibraryCardGroupLayout {
  entries: MusicLibraryCardGroupEntry[];
}

export function buildMusicLibraryCardGroupLayout(
  rows: MusicLibraryGroupedRow[]
): MusicLibraryCardGroupLayout {
  if (rows.length === 0) {
    return { entries: [] };
  }

  const entries: MusicLibraryCardGroupEntry[] = [];
  const groupNodes = new Map<string, MusicLibraryCardGroupNode>();
  const depthStack: MusicLibraryCardGroupNode[] = [];

  for (const row of rows) {
    if (row.kind === 'group-header') {
      const node: MusicLibraryCardGroupNode = {
        header: row,
        entries: [],
      };

      groupNodes.set(row.groupKey, node);
      depthStack.length = row.depth;

      const parent =
        row.depth > 0
          ? depthStack[row.depth - 1] ??
            (row.parentGroupKey ? groupNodes.get(row.parentGroupKey) : undefined)
          : undefined;

      const entry: MusicLibraryCardGroupEntry = {
        kind: 'group',
        node,
      };

      if (parent) {
        parent.entries.push(entry);
      } else {
        entries.push(entry);
      }

      depthStack[row.depth] = node;
      continue;
    }

    const parentGroupKey = row.groupKey ?? row.parentGroupKeys.at(-1);
    const parent = parentGroupKey ? groupNodes.get(parentGroupKey) : undefined;
    const entry: MusicLibraryCardGroupEntry = {
      kind: 'track',
      row,
    };

    if (parent) {
      parent.entries.push(entry);
    } else {
      entries.push(entry);
    }
  }

  return { entries };
}
