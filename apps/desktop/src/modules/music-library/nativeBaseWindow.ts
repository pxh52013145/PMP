import type { MusicLibraryBaseView } from './baseQuery';
import {
  MUSIC_LIBRARY_CARD_BLOCK_GAP_PX,
  MUSIC_LIBRARY_CARD_TRACK_ROW_HEIGHT_PX,
  resolveMusicLibraryCardGridColumns,
} from './cardVirtualWindow';

export type NativeBaseWindowRequest = {
  offset: number;
  limit: number;
};

function normalizeOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function clampNativeBaseWindowRequestToTotal(
  request: NativeBaseWindowRequest,
  total: number | null
): NativeBaseWindowRequest {
  const offset = normalizeOffset(request.offset);
  const limit = normalizeLimit(request.limit);

  if (total == null) {
    return { offset, limit };
  }

  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  if (safeTotal === 0) {
    return { offset: 0, limit };
  }

  if (offset >= safeTotal) {
    return { offset: Math.max(0, safeTotal - limit), limit };
  }

  return { offset, limit };
}

export function buildNativeBaseWindowRequest(options: {
  baseView: MusicLibraryBaseView;
  viewportHeightPx: number;
  scrollTopPx: number;
  cardViewportWidthPx: number;
  listHeaderHeightPx: number;
  trackRowHeightPx: number;
  overscanRows: number;
  pageSize: number;
  minPages: number;
}): NativeBaseWindowRequest {
  const viewportHeightPx = Math.max(
    1,
    Number.isFinite(options.viewportHeightPx) ? Math.floor(options.viewportHeightPx) : 0
  );
  const scrollTopPx = Math.max(0, Number.isFinite(options.scrollTopPx) ? options.scrollTopPx : 0);
  const overscanRows = Math.max(0, Math.floor(options.overscanRows));
  const minPageSize = Math.max(1, Math.floor(options.pageSize)) * Math.max(1, Math.floor(options.minPages));

  if (options.baseView === 'card') {
    const columns = Math.max(1, resolveMusicLibraryCardGridColumns(options.cardViewportWidthPx));
    const rowStridePx = MUSIC_LIBRARY_CARD_TRACK_ROW_HEIGHT_PX + MUSIC_LIBRARY_CARD_BLOCK_GAP_PX;
    const visibleRows = Math.max(1, Math.ceil(viewportHeightPx / rowStridePx));
    const startRow = Math.max(0, Math.floor(scrollTopPx / rowStridePx) - overscanRows);

    return {
      offset: startRow * columns,
      limit: Math.max(minPageSize, (visibleRows + overscanRows * 2) * columns),
    };
  }

  const headerHeight = normalizeOffset(options.listHeaderHeightPx);
  const trackRowHeightPx = Math.max(
    1,
    Number.isFinite(options.trackRowHeightPx) ? Math.floor(options.trackRowHeightPx) : 1
  );

  const effectiveScrollTop = Math.max(0, scrollTopPx - headerHeight);
  const visibleRows = Math.max(1, Math.ceil(viewportHeightPx / trackRowHeightPx));
  const startRow = Math.max(0, Math.floor(effectiveScrollTop / trackRowHeightPx) - overscanRows);

  return {
    offset: startRow,
    limit: Math.max(minPageSize, visibleRows + overscanRows * 2),
  };
}

export function nativeBaseTrackWindowCoversRequest(options: {
  currentOffset: number;
  currentLength: number;
  request: NativeBaseWindowRequest;
  total: number | null;
}): boolean {
  const total = options.total == null ? null : Math.max(0, Math.floor(options.total));
  if (total === 0) {
    return true;
  }

  const currentOffset = normalizeOffset(options.currentOffset);
  const currentLength = normalizeOffset(options.currentLength);
  if (currentLength <= 0) {
    return false;
  }

  const requestOffset = normalizeOffset(options.request.offset);
  const requestLimit = normalizeLimit(options.request.limit);
  const desiredEnd = total != null ? Math.min(requestOffset + requestLimit, total) : requestOffset + requestLimit;
  const currentEnd = currentOffset + currentLength;

  return requestOffset >= currentOffset && desiredEnd <= currentEnd;
}

