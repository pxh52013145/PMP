import { describe, expect, it, vi } from 'vitest';

import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import {
  createPluginMountApi,
  registerPluginHostCapability,
  type HostAudioService,
  type HostNavigation,
} from '../pluginHostApi';

type NavigationListener = Parameters<NonNullable<HostNavigation['subscribe']>>[0];

function createTestAudioService(overrides: Partial<HostAudioService> = {}): HostAudioService {
  return {
    getState: () => ({ currentTrack: null, playMode: 'sequence' }),
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    play: async () => {},
    pause: () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    toggleMute: () => {},
    ...overrides,
  };
}

function makeNavigationSnapshot(currentIndex: number) {
  return {
    currentPage: { type: 'home' as const },
    history: [{ type: 'home' as const }],
    currentIndex,
  };
}

function createTestNavigation(snapshot: { currentIndex: number } = { currentIndex: 0 }) {
  const listeners = new Set<NavigationListener>();

  const navigation: HostNavigation = {
    navigateTo: vi.fn(),
    goBack: vi.fn(),
    getSnapshot: () =>
      makeNavigationSnapshot(snapshot.currentIndex) as never,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  return {
    navigation,
    emitChange: (nextIndex: number) => {
      const next = makeNavigationSnapshot(nextIndex);
      for (const cb of Array.from(listeners)) cb(next);
    },
  };
}

describe('pmpm Host API - extensions', () => {
  it('host.getInfo returns null when permission denied', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.getInfo()).toBeNull();
  });

  it('host.getInfo returns version info when allowed', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.getInfo()).toEqual({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      hostApiVersion: HOST_API_VERSION,
      appVersion: APP_VERSION,
      runtime: expect.any(String),
    });
  });

  it('audio.playNext is gated by api:audio-control', async () => {
    const playNext = vi.fn(async () => {});

    const apiDenied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ playNext }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await apiDenied.audio.playNext();
    expect(playNext).not.toHaveBeenCalled();

    const apiAllowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-control']),
      audioService: createTestAudioService({ playNext }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await apiAllowed.audio.playNext();
    expect(playNext).toHaveBeenCalledTimes(1);
  });

  it('audio.setPlayMode validates mode and requires api:audio-control', () => {
    const setPlayMode = vi.fn();

    const apiDenied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ setPlayMode }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    apiDenied.audio.setPlayMode('loop');
    expect(setPlayMode).not.toHaveBeenCalled();

    const apiAllowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-control']),
      audioService: createTestAudioService({ setPlayMode }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    apiAllowed.audio.setPlayMode('not-a-mode');
    expect(setPlayMode).not.toHaveBeenCalled();

    apiAllowed.audio.setPlayMode('loop');
    expect(setPlayMode).toHaveBeenCalledTimes(1);
    expect(setPlayMode).toHaveBeenCalledWith('loop');
  });

  it('navigation.canGoBack uses snapshot currentIndex when allowed', () => {
    const { navigation: nav0 } = createTestNavigation({ currentIndex: 0 });
    const api0 = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation: nav0,
    });
    expect(api0.navigation.canGoBack()).toBe(false);

    const { navigation: nav2 } = createTestNavigation({ currentIndex: 2 });
    const api2 = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation: nav2,
    });
    expect(api2.navigation.canGoBack()).toBe(true);
  });

  it('navigation.onChange wires through host subscribe when allowed', () => {
    const { navigation, emitChange } = createTestNavigation({ currentIndex: 0 });
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation,
    });

    const cb = vi.fn();
    const unsubscribe = api.navigation.onChange(cb);
    emitChange(1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    emitChange(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('host.listCapabilities filters by capability permission', async () => {
    const deniedAi = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const deniedList = await deniedAi.host.listCapabilities();
    expect(deniedList.some((item) => item.id === 'foundation.ai-adapter')).toBe(false);

    const allowedAi = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:ai-runtime']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const allowedList = await allowedAi.host.listCapabilities();
    expect(allowedList.some((item) => item.id === 'foundation.ai-adapter')).toBe(true);
  });

  it('host.invokeCapability enforces permissions and forwards invoke context', async () => {
    const unregister = registerPluginHostCapability({
      id: 'test.echo-bridge',
      version: '1.0.0',
      permission: 'api:ai-runtime',
      handler: ({ method, payload, context }) => ({
        method,
        payload,
        pluginId: context.pluginId,
      }),
    });

    try {
      const denied = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      await expect(
        denied.host.invokeCapability('test.echo-bridge', 'run', { value: 1 })
      ).rejects.toThrow(/permission denied/i);

      const allowed = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      await expect(
        allowed.host.invokeCapability('test.echo-bridge', 'run', { value: 1 })
      ).resolves.toEqual({
        method: 'run',
        payload: { value: 1 },
        pluginId: 'demo',
      });
    } finally {
      unregister();
    }
  });

  it('host.hasPermission supports wildcard capability grants', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:*']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.hasPermission('api:voice-training')).toBe(true);
    expect(api.host.hasPermission('api:desktop-pet')).toBe(true);
  });

  it('visualizer.getSpectrumFrame and onSpectrumFrame are gated and poll host frames', async () => {
    const getSpectrumFrame = vi.fn((tap?: 'pre-dsp' | 'post-dsp') => ({
      frameId: tap === 'pre-dsp' ? 10 : 20,
      timestampMs: 123,
      tap: tap ?? 'post-dsp',
      sampleRate: 48_000,
      bins: new Uint8Array([1, 2, 3]),
    }));

    const denied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ getSpectrumFrame }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(denied.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })).toBeNull();

    const allowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-visual']),
      audioService: createTestAudioService({ getSpectrumFrame }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const pre = allowed.visualizer.getSpectrumFrame({ tap: 'pre-dsp' });
    expect(pre?.tap).toBe('pre-dsp');

    vi.useFakeTimers();
    const cb = vi.fn();
    const off = allowed.visualizer.onSpectrumFrame(cb, { tap: 'post-dsp', intervalMs: 16 });
    vi.advanceTimersByTime(20);
    off();
    vi.useRealTimers();

    expect(cb).toHaveBeenCalled();
    expect(getSpectrumFrame).toHaveBeenCalledWith('pre-dsp');
    expect(getSpectrumFrame).toHaveBeenCalledWith('post-dsp');
  });
});
