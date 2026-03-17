import type {
  MusicLibraryGroupHeaderRow,
  MusicLibraryGroupedRow,
  MusicLibraryTrackRow,
} from './groupedRows';

const CARD_GRID_MIN_COLUMN_WIDTH_PX = 320;
const CARD_GRID_GAP_PX = 10;
const CARD_BLOCK_GAP_PX = 10;
const CARD_TRACK_ROW_HEIGHT_PX = 72;
const CARD_GROUP_HEADER_HEIGHT_PX = 42;
const CARD_WINDOW_OVERSCAN_PX = 180;
const CARD_GROUP_INDENT_TOTAL_PX = 26;

export const MUSIC_LIBRARY_CARD_GROUP_INDENT_MARGIN_PX = 14;
export const MUSIC_LIBRARY_CARD_GROUP_INDENT_PADDING_PX = 12;

type MusicLibraryCardVirtualBlockBase = {
  key: string;
  depth: number;
  topPx: number;
  heightPx: number;
};

export type MusicLibraryCardTrackRowBlock = MusicLibraryCardVirtualBlockBase & {
  kind: 'track-row';
  rows: MusicLibraryTrackRow[];
};

export type MusicLibraryCardGroupHeaderBlock = MusicLibraryCardVirtualBlockBase & {
  kind: 'group-header';
  row: MusicLibraryGroupHeaderRow;
};

export type MusicLibraryCardVirtualBlock =
  | MusicLibraryCardTrackRowBlock
  | MusicLibraryCardGroupHeaderBlock;

export interface MusicLibraryCardVirtualLayout {
  blocks: MusicLibraryCardVirtualBlock[];
  totalHeightPx: number;
}

export interface MusicLibraryCardVirtualWindow {
  blocks: MusicLibraryCardVirtualBlock[];
  topSpacerPx: number;
  bottomSpacerPx: number;
}

export function resolveMusicLibraryCardGridColumns(
  containerWidthPx: number,
  depth: number = 0
): number {
  const safeWidth = Number.isFinite(containerWidthPx) ? containerWidthPx : 0;
  const effectiveWidth = Math.max(0, safeWidth - depth * CARD_GROUP_INDENT_TOTAL_PX);
  if (effectiveWidth <= 0) return 1;
  return Math.max(
    1,
    Math.floor((effectiveWidth + CARD_GRID_GAP_PX) / (CARD_GRID_MIN_COLUMN_WIDTH_PX + CARD_GRID_GAP_PX))
  );
}

function buildTrackRowBlockKey(rows: MusicLibraryTrackRow[]): string {
  const first = rows[0];
  const last = rows[rows.length - 1];
  return `track-row:${first?.id ?? 'empty'}:${last?.id ?? 'empty'}`;
}

export function buildMusicLibraryCardVirtualLayout(
  rows: MusicLibraryGroupedRow[],
  containerWidthPx: number
): MusicLibraryCardVirtualLayout {
  if (rows.length === 0) {
    return { blocks: [], totalHeightPx: 0 };
  }

  const blocks: MusicLibraryCardVirtualBlock[] = [];
  let offsetTopPx = 0;
  let pendingTrackRows: MusicLibraryTrackRow[] = [];
  let pendingTrackDepth = 0;
  let pendingTrackSignature = '';

  const appendBlock = (
    block:
      | Omit<MusicLibraryCardTrackRowBlock, 'topPx'>
      | Omit<MusicLibraryCardGroupHeaderBlock, 'topPx'>
  ) => {
    blocks.push({
      ...block,
      topPx: offsetTopPx,
    });
    offsetTopPx += block.heightPx + CARD_BLOCK_GAP_PX;
  };

  const flushTrackRows = () => {
    if (pendingTrackRows.length === 0) return;
    const columns = resolveMusicLibraryCardGridColumns(containerWidthPx, pendingTrackDepth);

    for (let index = 0; index < pendingTrackRows.length; index += columns) {
      const chunk = pendingTrackRows.slice(index, index + columns);
      appendBlock({
        kind: 'track-row',
        key: buildTrackRowBlockKey(chunk),
        depth: pendingTrackDepth,
        heightPx: CARD_TRACK_ROW_HEIGHT_PX,
        rows: chunk,
      });
    }

    pendingTrackRows = [];
    pendingTrackDepth = 0;
    pendingTrackSignature = '';
  };

  for (const row of rows) {
    if (row.kind === 'group-header') {
      flushTrackRows();
      appendBlock({
        kind: 'group-header',
        key: row.id,
        depth: row.depth,
        heightPx: CARD_GROUP_HEADER_HEIGHT_PX,
        row,
      });
      continue;
    }

    const nextDepth = row.parentGroupKeys.length;
    const nextSignature = row.parentGroupKeys.join('|');
    if (
      pendingTrackRows.length > 0 &&
      (pendingTrackDepth !== nextDepth || pendingTrackSignature !== nextSignature)
    ) {
      flushTrackRows();
    }

    pendingTrackRows.push(row);
    pendingTrackDepth = nextDepth;
    pendingTrackSignature = nextSignature;
  }

  flushTrackRows();

  return {
    blocks,
    totalHeightPx: Math.max(0, offsetTopPx - CARD_BLOCK_GAP_PX),
  };
}

function findFirstVisibleBlockIndex(
  blocks: MusicLibraryCardVirtualBlock[],
  startPx: number
): number {
  let low = 0;
  let high = blocks.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = blocks[mid];
    if (candidate.topPx + candidate.heightPx <= startPx) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findLastVisibleBlockIndexExclusive(
  blocks: MusicLibraryCardVirtualBlock[],
  endPx: number
): number {
  let low = 0;
  let high = blocks.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = blocks[mid];
    if (candidate.topPx < endPx) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export function sliceMusicLibraryCardVirtualLayout(
  layout: MusicLibraryCardVirtualLayout,
  scrollTopPx: number,
  viewportHeightPx: number
): MusicLibraryCardVirtualWindow {
  if (layout.blocks.length === 0 || layout.totalHeightPx <= 0) {
    return {
      blocks: [],
      topSpacerPx: 0,
      bottomSpacerPx: 0,
    };
  }

  const safeScrollTopPx = Math.max(0, Number.isFinite(scrollTopPx) ? scrollTopPx : 0);
  const safeViewportHeightPx = Math.max(
    CARD_TRACK_ROW_HEIGHT_PX,
    Number.isFinite(viewportHeightPx) ? viewportHeightPx : CARD_TRACK_ROW_HEIGHT_PX
  );
  const startPx = Math.max(0, safeScrollTopPx - CARD_WINDOW_OVERSCAN_PX);
  const endPx = safeScrollTopPx + safeViewportHeightPx + CARD_WINDOW_OVERSCAN_PX;

  const startIndex = findFirstVisibleBlockIndex(layout.blocks, startPx);
  const endIndex = Math.max(startIndex, findLastVisibleBlockIndexExclusive(layout.blocks, endPx));
  const visibleBlocks = layout.blocks.slice(startIndex, endIndex);

  if (visibleBlocks.length === 0) {
    return {
      blocks: [],
      topSpacerPx: Math.min(layout.totalHeightPx, startPx),
      bottomSpacerPx: Math.max(0, layout.totalHeightPx - Math.min(layout.totalHeightPx, startPx)),
    };
  }

  const firstVisible = visibleBlocks[0];
  const lastVisible = visibleBlocks[visibleBlocks.length - 1];
  const bottomEdgePx = lastVisible.topPx + lastVisible.heightPx;

  return {
    blocks: visibleBlocks,
    topSpacerPx: firstVisible.topPx,
    bottomSpacerPx: Math.max(0, layout.totalHeightPx - bottomEdgePx),
  };
}
