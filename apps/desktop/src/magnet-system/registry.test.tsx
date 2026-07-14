import { afterEach, describe, expect, it } from 'vitest';
import type { Magnet } from '../types/pixel';
import { clearMagnetRenderers, getMagnetPreviewNode, registerMagnetRenderer } from './registry';

describe('magnet renderer previews', () => {
  afterEach(() => {
    clearMagnetRenderers();
  });

  it('falls back to the Magnet preview text when a renderer preview throws', () => {
    registerMagnetRenderer({
      id: 'broken-preview',
      render: () => null,
      preview: () => {
        throw new Error('preview failed');
      },
    });

    const magnet = {
      id: 'broken-preview-magnet',
      renderer: 'broken-preview',
      previewText: 'Safe preview',
    } as Magnet;

    expect(() => getMagnetPreviewNode(magnet)).not.toThrow();
    expect(getMagnetPreviewNode(magnet)).toBe('Safe preview');
  });
});
