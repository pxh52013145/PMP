import { describe, expect, it } from 'vitest';

import { DEFAULT_DYNAMIC_COLORS } from '../../../utils/dynamicColors';
import { createPluginMountApi, type HostAudioService, type HostNavigation } from '../pluginHostApi';

function createTestAudioService(state: unknown): HostAudioService {
  return {
    getState: () => state,
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    play: async () => {},
    pause: () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    toggleMute: () => {},
    getFrequencyData: () => null,
  };
}

const navigation: HostNavigation = {
  navigateTo: () => {},
  goBack: () => {},
};

describe('pmpm Host API - audio.getCover()', () => {
  it('returns null when permission denied', async () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({
        currentTrack: { id: 't1', title: 'Song', coverUrl: 'data:image/png;base64,AAA' },
      }),
      navigation,
    });

    await expect(api.audio.getCover()).resolves.toBeNull();
  });

  it('returns cover url + colors when allowed (no audio-state required)', async () => {
    const coverUrl = 'data:image/png;base64,AAA';
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-cover']),
      audioService: createTestAudioService({
        currentTrack: { id: 't1', title: 'Song', coverUrl },
      }),
      navigation,
    });

    const cover = await api.audio.getCover();
    expect(cover).toEqual({
      url: coverUrl,
      colors: DEFAULT_DYNAMIC_COLORS,
    });
  });
});

