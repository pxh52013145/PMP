import { describe, expect, it } from 'vitest';
import {
  LOCAL_TRACK_COLUMN_DEFINITIONS,
  type LocalTrackColumnConfig,
} from '../localTrackColumns';
import { deriveLocalTrackLayoutModel } from '../localTrackLayout';

function parseGridColumnWidths(template: string): number[] {
  const pattern = /minmax\(\d+px,\s*(\d+)px\)/g;
  const widths: number[] = [];
  let match = pattern.exec(template);
  while (match) {
    widths.push(Number(match[1]));
    match = pattern.exec(template);
  }
  return widths;
}

describe('localTrackLayout', () => {
  it('builds grid template with index and action columns', () => {
    const columns: LocalTrackColumnConfig[] = [
      { id: 'title', visible: true, widthPx: 360 },
      { id: 'artist', visible: true, widthPx: 220 },
    ];

    const model = deriveLocalTrackLayoutModel({
      localTrackColumnSettings: columns,
      localTrackLayoutWidth: 0,
      mainViewportClientWidth: 0,
    });

    expect(model.localTrackGridTemplate.startsWith('40px')).toBe(true);
    expect(model.localTrackGridTemplate.endsWith('72px')).toBe(true);
    expect(model.visibleLocalTrackColumnCount).toBe(2);
  });

  it('never shrinks rendered widths below each column minimum', () => {
    const columns: LocalTrackColumnConfig[] = [
      { id: 'title', visible: true, widthPx: 640 },
      { id: 'artist', visible: true, widthPx: 420 },
      { id: 'album', visible: true, widthPx: 420 },
    ];

    const model = deriveLocalTrackLayoutModel({
      localTrackColumnSettings: columns,
      localTrackLayoutWidth: 280,
      mainViewportClientWidth: 280,
    });

    const widths = parseGridColumnWidths(model.localTrackGridTemplate);
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThanOrEqual(LOCAL_TRACK_COLUMN_DEFINITIONS.title.minWidthPx);
    expect(widths[1]).toBeGreaterThanOrEqual(LOCAL_TRACK_COLUMN_DEFINITIONS.artist.minWidthPx);
    expect(widths[2]).toBeGreaterThanOrEqual(LOCAL_TRACK_COLUMN_DEFINITIONS.album.minWidthPx);
  });

  it('limits card-meta columns to non-title top 4', () => {
    const columns: LocalTrackColumnConfig[] = [
      { id: 'title', visible: true },
      { id: 'artist', visible: true },
      { id: 'album', visible: true },
      { id: 'genre', visible: true },
      { id: 'year', visible: true },
      { id: 'format', visible: true },
    ];

    const model = deriveLocalTrackLayoutModel({
      localTrackColumnSettings: columns,
      localTrackLayoutWidth: 1200,
      mainViewportClientWidth: 1200,
    });

    expect(model.localTrackCardMetaColumns).toHaveLength(4);
    expect(model.localTrackCardMetaColumns.some((column) => column.id === 'title')).toBe(false);
  });
});
