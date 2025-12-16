import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { NativeAudioService } from '../NativeAudioService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NativeAudioService', () => {
  it('initializes with idle playback state', () => {
    const service = new NativeAudioService();
    expect(service.getState().playbackState).toBe('idle');
    service.destroy();
  });
});
