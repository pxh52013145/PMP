import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { saveConfig, loadConfig } from '../configManager';
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
  content: 'Test Content' as unknown as React.ReactNode,
  style: {},
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
});
