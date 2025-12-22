import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import {
  getPmpsMagnetShaderBinding,
  loadPmpsMagnetShaderBindings,
  removePmpsMagnetShaderBinding,
  upsertPmpsMagnetShaderBinding,
} from '../pmpsMagnetShaderBindings';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

beforeEach(() => {
  localStorage.clear();
});

describe('pmps magnet shader bindings', () => {
  it('stores and removes bindings by magnetId', () => {
    expect(loadPmpsMagnetShaderBindings()).toEqual({});
    expect(getPmpsMagnetShaderBinding('track-info')).toBeNull();

    upsertPmpsMagnetShaderBinding('track-info', { shaderId: 'shader-demo', enabled: true });

    const storedRaw = localStorage.getItem(STORAGE_KEYS.PMPS_MAGNET_SHADER_BINDINGS);
    expect(storedRaw).toContain('track-info');
    expect(getPmpsMagnetShaderBinding('track-info')?.shaderId).toBe('shader-demo');

    removePmpsMagnetShaderBinding('track-info');
    expect(getPmpsMagnetShaderBinding('track-info')).toBeNull();
  });
});

