import { describe, expect, it } from 'vitest';
import { DEFAULT_ORNAMENTS_CONFIG, normalizeOrnamentsConfig } from '../ornamentsConfig';

describe('ornamentsConfig', () => {
  it('returns default for invalid inputs', () => {
    expect(normalizeOrnamentsConfig(null)).toEqual(DEFAULT_ORNAMENTS_CONFIG);
    expect(normalizeOrnamentsConfig({})).toEqual(DEFAULT_ORNAMENTS_CONFIG);
    expect(normalizeOrnamentsConfig({ version: 2, items: [] })).toEqual(DEFAULT_ORNAMENTS_CONFIG);
  });

  it('filters invalid items and clamps transforms', () => {
    const config = normalizeOrnamentsConfig({
      version: 1,
      items: [
        null,
        {
          id: 'a',
          enabled: 'yes',
          name: 123,
          media: { type: 'image', url: '' },
          transform: {
            anchor: 'top-left',
            offsetX: 1,
            offsetY: 2,
            width: 100,
            height: 100,
            opacity: 0.5,
            layer: 'foreground',
          },
        },
        {
          id: 'b',
          enabled: true,
          name: 'ok',
          media: { type: 'image', url: 'tauri://localhost/foo.png' },
          transform: {
            anchor: 'nope',
            offsetX: 999999,
            offsetY: -999999,
            width: 1,
            height: 999999,
            opacity: 999,
            layer: 'nope',
          },
        },
      ],
    });

    expect(config.version).toBe(1);
    expect(config.items.length).toBe(1);
    expect(config.items[0].id).toBe('b');
    expect(config.items[0].name).toBe('ok');
    expect(config.items[0].enabled).toBe(true);
    expect(config.items[0].transform.anchor).toBe('bottom-left');
    expect(config.items[0].transform.offsetX).toBe(2000);
    expect(config.items[0].transform.offsetY).toBe(-2000);
    expect(config.items[0].transform.width).toBe(16);
    expect(config.items[0].transform.height).toBe(2400);
    expect(config.items[0].transform.opacity).toBe(1);
    expect(config.items[0].transform.layer).toBe('foreground');
  });
});
