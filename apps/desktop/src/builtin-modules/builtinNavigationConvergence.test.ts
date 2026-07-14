import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEvents } from '../contracts/events';
import type { VisualizerContribution, WindowContribution } from '../contracts/contributions';
import { ContributionRegistry, EventBus, ServiceRegistry } from '../kernel';
import type { NavigationService } from '../services/navigation';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { COMMANDS_SERVICE_TOKEN, DefaultCommandsService } from '../services/commands';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from '../magnet-system/plugins/installedExtensionRuntimeManager';
import { SHELL_SURFACE_MANAGER_TOKEN } from '../magnet-system/plugins/shellSurfaceManager';
import { createBuiltinContributionsModule } from './builtinContributionsModule';
import { createBuiltinCommandsModule } from './builtinCommandsModule';
import { createInstalledExtensionContributionsModule } from '../magnet-system/plugins/extensionContributionsModule';
import { createPluginMountApi } from '../magnet-system/plugins/pluginHostApi';

const mocks = vi.hoisted(() => ({
  navigateBuiltinViaHostCapabilityMock: vi.fn(async () => {}),
  openBuiltinWindowViaHostCapabilityMock: vi.fn(async () => {}),
  openBuiltinPluginVisualizerViaHostCapabilityMock: vi.fn(async () => {}),
  openBuiltinPluginWindowViaHostCapabilityMock: vi.fn(async () => {}),
  loadInstalledExtensionsMock: vi.fn((): unknown[] => []),
  subscribeInstalledExtensionsMock: vi.fn(() => () => {}),
}));

vi.mock('./builtinNavigationCapabilityBridge', () => ({
  navigateBuiltinViaHostCapability: mocks.navigateBuiltinViaHostCapabilityMock,
  goBackBuiltinViaHostCapability: vi.fn(async () => {}),
  openBuiltinWindowViaHostCapability: mocks.openBuiltinWindowViaHostCapabilityMock,
  openBuiltinPluginPageViaHostCapability: vi.fn(async () => {}),
  openBuiltinPluginVisualizerViaHostCapability:
    mocks.openBuiltinPluginVisualizerViaHostCapabilityMock,
  openBuiltinPluginWindowViaHostCapability: mocks.openBuiltinPluginWindowViaHostCapabilityMock,
}));

vi.mock('../magnet-system/plugins/extensions', () => ({
  loadInstalledExtensions: mocks.loadInstalledExtensionsMock,
  subscribeInstalledExtensions: mocks.subscribeInstalledExtensionsMock,
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

function createAudioServiceStub() {
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

function createModuleContext(navigation: NavigationService) {
  const services = new ServiceRegistry();
  const contributions = new ContributionRegistry();
  const events = new EventBus<AppEvents>().withSource('builtin-navigation-convergence-test');

  services.register(NAVIGATION_SERVICE_TOKEN, navigation);
  services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, {
    runCommand: vi.fn(),
    resolveRuntime: vi.fn(),
  } as never);
  services.register(SHELL_SURFACE_MANAGER_TOKEN, {
    summonSurface: vi.fn(),
  } as never);

  return { services, contributions, events };
}

describe('builtin navigation convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadInstalledExtensionsMock.mockReturnValue([]);
    mocks.subscribeInstalledExtensionsMock.mockReturnValue(() => {});
  });

  it('routes builtin keyboard shortcut window opens through command -> capability', async () => {
    const navigation = createNavigationServiceStub();
    const ctx = createModuleContext(navigation);
    ctx.services.register(COMMANDS_SERVICE_TOKEN, new DefaultCommandsService(ctx.contributions), {
      replace: true,
    });

    createBuiltinCommandsModule().activate(ctx);
    createBuiltinContributionsModule().activate(ctx);

    const contribution = ctx.contributions.get<WindowContribution>('window', 'keyboard-shortcuts');
    expect(contribution).not.toBeNull();

    await contribution?.open();

    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'keyboard-shortcuts',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-keyboard-shortcuts-window'
    );
  });

  it('routes installed extension visualizer opens through the shared builtin bridge', async () => {
    mocks.loadInstalledExtensionsMock.mockReturnValue([
      {
        enabled: true,
        manifest: {
          identity: {
            id: 'demo-ext',
            name: 'Demo Extension',
          },
          contributes: {
            host: {
              pmp: {
                visualizers: [
                  {
                    id: 'demo-visualizer',
                    title: 'Demo Visualizer',
                  },
                ],
              },
            },
          },
        },
      },
    ] as unknown[]);

    const navigation = createNavigationServiceStub();
    const ctx = createModuleContext(navigation);

    createInstalledExtensionContributionsModule().activate(ctx);

    const contribution = ctx.contributions.get<VisualizerContribution>(
      'visualizer',
      'extv2:demo-ext:visualizer:demo-visualizer'
    );
    expect(contribution).not.toBeNull();

    await contribution?.open();

    expect(mocks.openBuiltinPluginVisualizerViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        pluginId: 'demo-ext',
        visualizerId: 'demo-visualizer',
        sourceKind: 'extv2',
      },
      'visualizer:extv2:demo-ext:demo-visualizer'
    );
  });

  it('routes plugin window opens through the shared builtin bridge', async () => {
    mocks.loadInstalledExtensionsMock.mockReturnValue([
      {
        enabled: true,
        manifest: {
          identity: {
            id: 'demo-ext',
            name: 'Demo Extension',
          },
          hostTargets: [{ hostId: 'pmp', required: true }],
          runtimes: [],
          contributes: {
            host: {
              pmp: {
                windows: [
                  {
                    id: 'demo-window',
                    title: 'Demo Window',
                    width: 640,
                    height: 480,
                  },
                ],
              },
            },
          },
        },
      },
    ] as unknown[]);

    const navigation = createNavigationServiceStub();
    const ctx = createModuleContext(navigation);

    createInstalledExtensionContributionsModule().activate(ctx);

    const contribution = ctx.contributions.get<WindowContribution>(
      'window',
      'extv2:demo-ext:window:demo-window'
    );
    expect(contribution).not.toBeNull();

    await contribution?.open({ title: 'Overridden Window', width: 720 });

    expect(mocks.openBuiltinPluginWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        sourceKind: 'extv2',
        pluginId: 'demo-ext',
        windowId: 'demo-window',
        title: 'Overridden Window',
        width: 720,
        height: 480,
        x: undefined,
        y: undefined,
      },
      'window:extv2:demo-ext:demo-window'
    );
  });

  it('routes shell.menu activation into builtin window/navigation command capability paths', async () => {
    const navigation = createNavigationServiceStub();
    const ctx = createModuleContext(navigation);
    ctx.services.register(COMMANDS_SERVICE_TOKEN, new DefaultCommandsService(ctx.contributions), {
      replace: true,
    });
    createBuiltinContributionsModule().activate(ctx);
    createBuiltinCommandsModule().activate(ctx);

    const api = createPluginMountApi({
      pluginId: 'menu-fixture',
      hostLabel: 'BuiltinNavigationConvergenceTest',
      permissions: new Set(['api:host', 'api:host-capability', 'api:navigation', 'api:window']),
      audioService: createAudioServiceStub(),
      navigation: {
        navigateTo: vi.fn(),
        goBack: vi.fn(),
        getSnapshot: () => ({
          currentPage: { type: 'home' },
          history: [{ type: 'home' }],
          currentIndex: 0,
        }),
        subscribe: () => () => {},
      },
      commands: ctx.services.get(COMMANDS_SERVICE_TOKEN),
    });

    const keyboardShortcutsResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-keyboard-shortcuts-window',
      }
    );
    const navigateHomeResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-home',
      }
    );
    const navigateSettingsResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-settings',
      }
    );
    const navigateMusicLibraryResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-music-library',
      }
    );
    const openMusicTagWorkbenchResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'musicTag.openWorkbench',
      }
    );
    const navigateDspRackResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-dsp-rack',
      }
    );
    const navigateDebugCenterResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-debug-center',
      }
    );
    const navigateNativeDebugResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-native-debug',
      }
    );
    const themeEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-theme-editor-window',
      }
    );
    const debugEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-debug-editor-window',
      }
    );
    const controlEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-control-editor-window',
      }
    );
    const customBackgroundEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-custom-background-editor-window',
      }
    );
    const statisticsEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-statistics-editor-window',
      }
    );
    const libraryEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-library-editor-window',
      }
    );
    const styleEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-style-editor-window',
      }
    );
    const backgroundEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-background-editor-window',
      }
    );
    const stylePixelEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-style-pixel-editor-window',
      }
    );
    const styleCoverColorEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-style-cover-color-editor-window',
      }
    );
    const styleBackgroundEffectEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-style-background-effect-editor-window',
      }
    );
    const styleBorderEffectEditorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-style-border-effect-editor-window',
      }
    );
    const perfMonitorResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:navigate-perf-monitor',
      }
    );
    const vstManagerResult = await api.host.invokeCapability(
      'host.pmp.shell.menu',
      'activateItem',
      {
        itemId: 'app:open-vst3-plugin-manager',
      }
    );

    expect(keyboardShortcutsResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-keyboard-shortcuts-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(navigateHomeResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-home',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(navigateSettingsResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-settings',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(navigateMusicLibraryResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-music-library',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(openMusicTagWorkbenchResult).toEqual({
      ok: true,
      data: {
        itemId: 'musicTag.openWorkbench',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(navigateDspRackResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-dsp-rack',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(navigateDebugCenterResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-debug-center',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(navigateNativeDebugResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-native-debug',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(themeEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-theme-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(debugEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-debug-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(controlEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-control-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(customBackgroundEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-custom-background-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(statisticsEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-statistics-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(libraryEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-library-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(styleEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-style-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(backgroundEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-background-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(stylePixelEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-style-pixel-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(styleCoverColorEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-style-cover-color-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(styleBackgroundEffectEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-style-background-effect-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(styleBorderEffectEditorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-style-border-effect-editor-window',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(perfMonitorResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:navigate-perf-monitor',
        activated: true,
        requiredPermission: 'api:navigation',
      },
    });
    expect(vstManagerResult).toEqual({
      ok: true,
      data: {
        itemId: 'app:open-vst3-plugin-manager',
        activated: true,
        requiredPermission: 'api:window',
      },
    });
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'home',
      undefined,
      'app:navigate-home'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'settings',
      undefined,
      'app:navigate-settings'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'music-library',
      undefined,
      'app:navigate-music-library'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'music-tag-workbench',
      undefined,
      'musicTag.openWorkbench'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'dsp-rack',
      undefined,
      'app:navigate-dsp-rack'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'debug',
      { tab: 'debug-center' },
      'app:navigate-debug-center'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'debug',
      { tab: 'native-debug' },
      'app:navigate-native-debug'
    );
    expect(mocks.navigateBuiltinViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      'debug',
      { tab: 'perf-monitor' },
      'app:navigate-perf-monitor'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'keyboard-shortcuts',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-keyboard-shortcuts-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:registration',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-theme-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:debug',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-debug-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:control',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-control-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:custom-background',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-custom-background-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:statistics',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-statistics-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:library',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-library-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:style',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-style-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:background',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-background-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:style-pixel',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-style-pixel-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:style-cover-color',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-style-cover-color-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:style-background-effect',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-style-background-effect-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      {
        windowId: 'editor:style-border-effect',
        title: undefined,
        width: undefined,
        height: undefined,
        x: undefined,
        y: undefined,
      },
      'app:open-style-border-effect-editor-window'
    );
    expect(mocks.openBuiltinWindowViaHostCapabilityMock).toHaveBeenCalledWith(
      navigation,
      expect.objectContaining({
        windowId: 'vst-manager',
      }),
      'app:open-vst3-plugin-manager'
    );
  });
});
