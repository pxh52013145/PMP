import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOrnamentItem,
  readOrnamentsConfig,
  updateOrnamentsConfig,
} from './store';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

describe('ornament persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('serializes functional updates without dropping an earlier imported item', async () => {
    const first = createOrnamentItem({
      path: 'C:/ornaments/first.png',
      mime: 'image/png',
      sourceWidth: 100,
      sourceHeight: 100,
      order: 1,
    });
    const second = createOrnamentItem({
      path: 'C:/ornaments/second.png',
      mime: 'image/png',
      sourceWidth: 100,
      sourceHeight: 100,
      order: 2,
    });

    await Promise.all([
      updateOrnamentsConfig((current) => ({
        ...current,
        items: [...current.items, first],
      })),
      updateOrnamentsConfig((current) => ({
        ...current,
        items: [...current.items, second],
      })),
    ]);

    const stored = readOrnamentsConfig();
    expect(stored.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(stored.updatedAt).toBeGreaterThan(0);
    expect(localStorage.getItem(STORAGE_KEYS.ORNAMENTS_V2)).toContain(first.media.path);
    expect(localStorage.getItem(STORAGE_KEYS.ORNAMENTS_V2)).toContain(second.media.path);
  });
});
