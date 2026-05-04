import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { buildMagnetLayoutStoreBootstrapRequest } from './layoutStore';
import { createDefaultMagnetSpacesState } from './spaces';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}));

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

describe('magnet layout store bootstrap request', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('bootstraps only the active space by default', () => {
    const spaces = createDefaultMagnetSpacesState(1_710_000_000_000);
    localStorage.setItem(
      STORAGE_KEYS.MAGNET_SPACES,
      JSON.stringify({ ...spaces, activeSpaceId: 'space2' })
    );

    const request = buildMagnetLayoutStoreBootstrapRequest();

    expect(request.mode).toBe('active-only');
    expect(request.activeSpaceId).toBe('space2');
    expect(Object.keys(request.layoutsBySpaceId)).toEqual(['space2']);
    expect(request.layoutsBySpaceId.space2.activeMagnetIds).toContain('music-tag-workbench');
  });

  it('can still bootstrap every known space for explicit repair flows', () => {
    const spaces = createDefaultMagnetSpacesState(1_710_000_000_000);
    localStorage.setItem(STORAGE_KEYS.MAGNET_SPACES, JSON.stringify(spaces));

    const request = buildMagnetLayoutStoreBootstrapRequest(undefined, 'all-known-spaces');

    expect(request.mode).toBe('all-known-spaces');
    expect(Object.keys(request.layoutsBySpaceId)).toEqual(['space1', 'space2', 'space3']);
    expect(request.layoutsBySpaceId.space3.activeMagnetIds).toContain(
      'plugin-development-workspace'
    );
  });
});
