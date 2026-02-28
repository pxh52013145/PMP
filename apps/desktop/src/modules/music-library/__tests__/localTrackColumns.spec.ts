import { describe, expect, it } from 'vitest';
import {
  applyBaseViewPropertiesToLocalTrackColumns,
  cloneDefaultLocalTrackColumnSettings,
  LOCAL_TRACK_COLUMN_DEFINITIONS,
  LOCAL_TRACK_COLUMN_ORDER,
  normalizeLocalTrackColumnSettings,
  normalizeLocalTrackColumnWidth,
} from '../localTrackColumns';

describe('localTrackColumns', () => {
  it('normalizes width with min/max constraints', () => {
    expect(normalizeLocalTrackColumnWidth('title', Number.NaN)).toBe(
      LOCAL_TRACK_COLUMN_DEFINITIONS.title.defaultWidthPx
    );
    expect(normalizeLocalTrackColumnWidth('title', 99999)).toBe(
      LOCAL_TRACK_COLUMN_DEFINITIONS.title.maxWidthPx
    );
    expect(normalizeLocalTrackColumnWidth('duration', 1)).toBe(
      LOCAL_TRACK_COLUMN_DEFINITIONS.duration.minWidthPx
    );
  });

  it('keeps at least one column visible after normalization', () => {
    const explicitAllHidden = LOCAL_TRACK_COLUMN_ORDER.map((id) => ({
      id,
      visible: false,
    }));

    const normalized = normalizeLocalTrackColumnSettings(explicitAllHidden);
    const titleColumn = normalized.find((column) => column.id === 'title');

    expect(titleColumn?.visible).toBe(true);
    expect(normalized.some((column) => column.visible)).toBe(true);
  });

  it('filters invalid base properties and applies width normalization', () => {
    const normalized = applyBaseViewPropertiesToLocalTrackColumns([
      { id: 'unknown', visible: true, widthPx: 100 },
      { id: 'title', visible: true, widthPx: 99999 },
      { id: 'artist', visible: false, widthPx: 12 },
    ]);

    const title = normalized.find((column) => column.id === 'title');
    const artist = normalized.find((column) => column.id === 'artist');

    expect(title?.widthPx).toBe(LOCAL_TRACK_COLUMN_DEFINITIONS.title.maxWidthPx);
    expect(artist?.widthPx).toBe(LOCAL_TRACK_COLUMN_DEFINITIONS.artist.minWidthPx);
  });

  it('clones default columns immutably', () => {
    const defaultsA = cloneDefaultLocalTrackColumnSettings();
    const defaultsB = cloneDefaultLocalTrackColumnSettings();

    defaultsA[0].visible = !defaultsA[0].visible;
    expect(defaultsB[0].visible).not.toBe(defaultsA[0].visible);
  });
});
