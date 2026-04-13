import { describe, expect, it, vi } from 'vitest';
import type { NavigationService } from '../services/navigation';
import type { HostAudioService, HostNavigation } from '../magnet-system/plugins/pluginHostApi';
import { createPluginMountApi } from '../magnet-system/plugins/pluginHostApi';
import {
  goBackBuiltinViaHostCapability,
  navigateBuiltinViaHostCapability,
  openBuiltinPluginPageViaHostCapability,
  openBuiltinPluginVisualizerViaHostCapability,
  openBuiltinPluginWindowViaHostCapability,
  openBuiltinWindowViaHostCapability,
} from './builtinNavigationCapabilityBridge';

const mocks = vi.hoisted(() => ({
  calculateWindowPositionMock: vi.fn(async () => ({
    x: 120,
    y: 240,
    width: 720,
    height: 480,
  })),
  openEditorWindowMock: vi.fn(async () => {}),
  openVstManagerWindowMock: vi.fn(async () => {}),
  openPluginWindowMock: vi.fn(async () => {}),
}));

vi.mock('../utils/editorWindows', () => ({
  calculateWindowPosition: mocks.calculateWindowPositionMock,
  openEditorWindow: mocks.openEditorWindowMock,
  closeEditorWindow: vi.fn(async () => {}),
}));

vi.mock('../utils/vstManagerWindows', () => ({
  openVstManagerWindow: mocks.openVstManagerWindowMock,
  closeVstManagerWindow: vi.fn(async () => {}),
}));

vi.mock('../utils/pluginWindows', () => ({
  openPluginWindow: mocks.openPluginWindowMock,
}));

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

  it('supports builtin plugin surface routes through the shared host capability', async () => {
    const navigation = createNavigationServiceStub();

    await openBuiltinPluginPageViaHostCapability(
      navigation,
      {
        pluginId: 'demo-plugin',
        pageId: 'demo-page',
        sourceKind: 'extv2',
      },
      'settings.plugins:open-installed-extension-page'
    );
    await openBuiltinPluginVisualizerViaHostCapability(
      navigation,
      {
        pluginId: 'demo-plugin',
        visualizerId: 'demo-visualizer',
        sourceKind: 'extv2',
      },
      'visualizer:extv2:demo-plugin:demo-visualizer'
    );

    expect(navigation.navigateTo).toHaveBeenNthCalledWith(1, 'plugin-page', {
      pluginId: 'demo-plugin',
      pageId: 'demo-page',
      sourceKind: 'extv2',
    });
    expect(navigation.navigateTo).toHaveBeenNthCalledWith(2, 'plugin-visualizer', {
      pluginId: 'demo-plugin',
      visualizerId: 'demo-visualizer',
      sourceKind: 'extv2',
    });
  });

  it('routes builtin and plugin window opens through host.pmp.shell.window', async () => {
    const navigation = createNavigationServiceStub();

    await openBuiltinWindowViaHostCapability(
      navigation,
      {
        windowId: 'keyboard-shortcuts',
      },
      'app:open-keyboard-shortcuts-window'
    );
    await openBuiltinWindowViaHostCapability(
      navigation,
      {
        windowId: 'editor:theme',
        x: 320,
        y: 180,
        width: 960,
        height: 640,
      },
      'app:open-theme-editor-window'
    );
    await openBuiltinWindowViaHostCapability(
      navigation,
      {
        windowId: 'vst-manager',
        title: 'Builtin VST Manager',
      },
      'app:open-vst3-plugin-manager'
    );
    await openBuiltinPluginWindowViaHostCapability(
      navigation,
      {
        sourceKind: 'extv2',
        pluginId: 'demo-plugin',
        windowId: 'demo-window',
        title: 'Demo Window',
        width: 720,
        height: 420,
        x: 12,
        y: 34,
      },
      'window:extv2:demo-plugin:demo-window'
    );

    expect(navigation.navigateTo).toHaveBeenCalledWith('keyboard-shortcuts', undefined);
    expect(mocks.openEditorWindowMock).toHaveBeenCalledWith({
      type: 'theme',
      x: 320,
      y: 180,
      width: 960,
      height: 640,
    });
    expect(mocks.openVstManagerWindowMock).toHaveBeenCalledWith({
      title: 'Builtin VST Manager',
      width: undefined,
      height: undefined,
      x: undefined,
      y: undefined,
    });
    expect(mocks.openPluginWindowMock).toHaveBeenCalledWith({
      sourceKind: 'extv2',
      pluginId: 'demo-plugin',
      windowId: 'demo-window',
      title: 'Demo Window',
      width: 720,
      height: 420,
      x: 12,
      y: 34,
    });
    expect(mocks.calculateWindowPositionMock).not.toHaveBeenCalled();
  });

  it('defaults shared plugin window bridge opens to extv2 when sourceKind is omitted', async () => {
    const navigation = createNavigationServiceStub();
    mocks.openPluginWindowMock.mockReset();
    const api = createPluginMountApi({
      pluginId: 'window-fixture',
      hostLabel: 'BuiltinNavigationCapabilityBridgeTest',
      permissions: new Set(['api:host', 'api:host-capability', 'api:window']),
      audioService: createAudioServiceStub(),
      navigation: createHostNavigationStub(),
    });

    await api.host.invokeCapability('host.pmp.shell.window', 'open', {
      windowId: 'demo-window',
      options: {
        pluginId: 'demo-plugin',
        title: 'Default Kind Window',
      },
    });

    expect(mocks.openPluginWindowMock).toHaveBeenCalledWith({
      sourceKind: 'extv2',
      pluginId: 'window-fixture',
      windowId: 'demo-window',
      title: 'Default Kind Window',
      width: undefined,
      height: undefined,
      x: undefined,
      y: undefined,
    });
    expect(navigation.navigateTo).not.toHaveBeenCalled();
  });
});
