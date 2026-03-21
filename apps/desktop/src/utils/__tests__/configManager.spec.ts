import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyConfig, loadConfig, saveConfig } from '../configManager';
import { Magnet } from '../../types/pixel';

const createMockMagnet = (): Magnet => ({
  id: 'test-magnet',
  type: 'custom',
  name: 'Test Magnet',
  renderer: 'test-renderer',
  previewText: 'Preview',
  anchors: [
    {
      id: 'anchor-1',
      gridX: 0,
      gridY: 0,
      role: 'anchor',
    },
  ],
  anchorType: 'single',
  boundsMode: 'docked',
  boundsDock: { x: 'start' },
  boundsInset: { top: 6, left: 2 },
  boundsOutset: { top: 9 },
  content: 'Test Content' as unknown as React.ReactNode,
  style: {},
  chrome: {
    enabled: true,
    inset: { top: 4, right: 3, bottom: 2, left: 1 },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
  },
});

beforeEach(() => {
  localStorage.clear();
});

describe('configManager baseline', () => {
  it('saves and loads config without throwing', () => {
    const magnetLibrary = [createMockMagnet()];
    const active = new Set<string>(['test-magnet']);

    expect(() =>
      saveConfig(magnetLibrary, active, { columns: 27, rows: 20 })
    ).not.toThrow();

    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
  });

  it('supports multiple storage keys (space isolation)', () => {
    const magnetLibrary = [createMockMagnet()];

    const activeA = new Set<string>(['test-magnet']);
    saveConfig(magnetLibrary, activeA, { columns: 27, rows: 20 }, undefined, 'pixel-matrix-player-config');

    const activeB = new Set<string>();
    saveConfig(
      magnetLibrary,
      activeB,
      { columns: 27, rows: 20 },
      undefined,
      'pixel-matrix-player-config:space2'
    );

    const loadedA = loadConfig('pixel-matrix-player-config');
    const loadedB = loadConfig('pixel-matrix-player-config:space2');

    expect(loadedA?.magnets['test-magnet']?.isActive).toBe(true);
    expect(loadedB?.magnets['test-magnet']?.isActive).toBe(false);
  });

  it('persists layout and chrome inset fields across save and load', () => {
    const magnetLibrary = [createMockMagnet()];
    const active = new Set<string>(['test-magnet']);

    saveConfig(magnetLibrary, active, { columns: 27, rows: 20 });

    const loaded = loadConfig();
    const state = loaded?.magnets['test-magnet'];

    expect(state?.boundsMode).toBe('docked');
    expect(state?.boundsDock).toEqual({ x: 'start' });
    expect(state?.boundsInset).toEqual({ top: 6, left: 2 });
    expect(state?.boundsOutset).toEqual({ top: 9 });
    expect(state?.chromeEnabled).toBe(true);
    expect(state?.chromeInset).toEqual({ top: 4, right: 3, bottom: 2, left: 1 });
  });

  it('drops unsupported persisted fields instead of writing them back', () => {
    localStorage.setItem(
      'pixel-matrix-player-config',
      JSON.stringify({
        version: '1.2.0',
        gridSize: { columns: 27, rows: 20 },
        magnets: {
          'test-magnet': {
            anchors: createMockMagnet().anchors,
            isActive: true,
            renderer: 'test-renderer',
            variant: 'compact',
            skinProps: {
              density: 'dense',
            },
            unsupportedField: {
              keep: false,
            },
          },
        },
        customMagnets: [
          {
            ...createMockMagnet(),
            id: 'custom-visualizer',
            skinProps: {
              bars: 24,
            },
            unsupportedField: {
              keep: false,
            },
          },
        ],
      })
    );

    const loaded = loadConfig();
    expect(loaded?.magnets['test-magnet']?.skinProps).toEqual({ density: 'dense' });
    expect((loaded?.magnets['test-magnet'] as Record<string, unknown> | undefined)?.unsupportedField).toBeUndefined();
    expect(loaded?.customMagnets[0]?.skinProps).toEqual({ bars: 24 });
    expect((loaded?.customMagnets[0] as Record<string, unknown> | undefined)?.unsupportedField).toBeUndefined();

    const applied = applyConfig(loaded!, [createMockMagnet()]);
    expect(applied.magnetLibrary[0]?.skinProps).toEqual({ density: 'dense' });

    const customMagnet = applied.magnetLibrary.find((magnet) => magnet.id === 'custom-visualizer');
    expect(customMagnet?.skinProps).toEqual({ bars: 24 });
    expect((customMagnet as Record<string, unknown> | undefined)?.unsupportedField).toBeUndefined();

    saveConfig(applied.magnetLibrary, new Set(['test-magnet', 'custom-visualizer']), { columns: 27, rows: 20 });
    expect(localStorage.getItem('pixel-matrix-player-config')).not.toContain('unsupportedField');
  });

  it('applies saved layout and chrome inset fields back onto the magnet library', () => {
    const magnetLibrary = [createMockMagnet()];
    const active = new Set<string>(['test-magnet']);

    saveConfig(magnetLibrary, active, { columns: 27, rows: 20 });
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();

    const applied = applyConfig(loaded!, []);
    const magnet = applied.magnetLibrary[0];

    expect(magnet.boundsMode).toBe('docked');
    expect(magnet.boundsDock).toEqual({ x: 'start' });
    expect(magnet.boundsInset).toEqual({ top: 6, left: 2 });
    expect(magnet.boundsOutset).toEqual({ top: 9 });
    expect(magnet.chrome?.enabled).toBe(true);
    expect(magnet.chrome?.inset).toEqual({ top: 4, right: 3, bottom: 2, left: 1 });
  });
});
