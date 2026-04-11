import { describe, expect, it, vi } from 'vitest';
import type { NavigationService } from '../services/navigation';
import type { HostAudioService, HostNavigation } from '../magnet-system/plugins/pluginHostApi';
import { createPluginMountApi } from '../magnet-system/plugins/pluginHostApi';
import {
  goBackBuiltinViaHostCapability,
  navigateBuiltinViaHostCapability,
} from './builtinNavigationCapabilityBridge';

function createNavigationServiceStub(): NavigationService {
  return {
    getSnapshot: () => ({
      currentPage: { type: 'home' },
      history: [{ type: 'home' }],
      currentIndex: 0,
    }),
    navigateTo: vi.fn(),
    goBack: vi.fn(),
  };
}

function createHostNavigationStub(): HostNavigation {
  return {
    navigateTo: vi.fn(),
    goBack: vi.fn(),
    getSnapshot: () => ({
      currentPage: { type: 'home' },
      history: [{ type: 'home' }],
      currentIndex: 0,
    }),
    subscribe: () => () => {},
  };
}

function createAudioServiceStub(): HostAudioService {
  return {
    getState: () => ({
      playbackState: 'stopped',
      queue: [],
      currentTrack: null,
      currentTime: 0,
      duration: 0,
      volume: 1,
      muted: false,
      playMode: 'sequence',
      currentIndex: -1,
      buffering: false,
    }),
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    play: async () => {},
    pause: async () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    toggleMute: () => {},
  };
}

describe('builtin navigation capability bridge', () => {
  it('routes builtin navigation commands through host.pmp.navigation', async () => {
    const navigation = createNavigationServiceStub();

    await navigateBuiltinViaHostCapability(navigation, 'settings', undefined, 'app:navigate-settings');
    await navigateBuiltinViaHostCapability(
      navigation,
      'debug',
      { tab: 'debug-center' },
      'app:navigate-debug-center'
    );
    await goBackBuiltinViaHostCapability(navigation, 'app:go-back');

    expect(navigation.navigateTo).toHaveBeenNthCalledWith(1, 'settings', undefined);
    expect(navigation.navigateTo).toHaveBeenNthCalledWith(2, 'debug', { tab: 'debug-center' });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('lets builtin and plugin callers share the same host.pmp.navigation capability handler', async () => {
    const builtinNavigation = createNavigationServiceStub();
    const pluginNavigation = createHostNavigationStub();
    const api = createPluginMountApi({
      pluginId: 'navigation-fixture',
      hostLabel: 'BuiltinNavigationCapabilityBridgeTest',
      sourceKind: 'extv2',
      permissions: new Set(['api:host', 'api:host-capability', 'api:navigation']),
      audioService: createAudioServiceStub(),
      navigation: pluginNavigation,
    });

    await api.host.invokeCapability('host.pmp.navigation', 'navigateTo', {
      page: 'plugin-page',
      params: {
        pluginId: 'navigation-fixture',
        pageId: 'demo-page',
      },
    });
    await navigateBuiltinViaHostCapability(
      builtinNavigation,
      'settings',
      undefined,
      'app:navigate-settings'
    );

    expect(pluginNavigation.navigateTo).toHaveBeenCalledWith('plugin-page', {
      pluginId: 'navigation-fixture',
      pageId: 'demo-page',
      sourceKind: 'extv2',
    });
    expect(builtinNavigation.navigateTo).toHaveBeenCalledWith('settings', undefined);
  });
});
