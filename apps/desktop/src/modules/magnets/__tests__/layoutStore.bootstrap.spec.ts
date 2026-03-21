import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMagnetLayoutStoreBootstrapRequest,
  type MagnetLayoutStoreBootstrapRequest,
} from '../layoutStore';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

describe('buildMagnetLayoutStoreBootstrapRequest', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses injected default active magnets for missing stored layouts', () => {
    localStorage.setItem(
      STORAGE_KEYS.MAGNET_SPACES,
      JSON.stringify({
        version: 1,
        activeSpaceId: 'space1',
        spaces: [{ id: 'space1', name: '主空间', order: 1, createdAt: Date.now() }],
      })
    );

    const defaults = new Set<string>(['drag-handle', 'btn-editor']);
    const request = buildMagnetLayoutStoreBootstrapRequest(defaults) as MagnetLayoutStoreBootstrapRequest;

    const layout = request.layoutsBySpaceId.space1;
    expect(layout).toBeTruthy();
    expect(layout?.activeMagnetIds).toContain('drag-handle');
    expect(layout?.activeMagnetIds).toContain('btn-editor');
  });
});

