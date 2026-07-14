import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  createKernel,
  ModuleLoader,
  setKernelLogSink,
  type Kernel,
  type KernelModule,
} from '../kernel';
import type { AppEvents } from '../contracts/events';
import { createLifecycleModule } from '../services/lifecycle';
import { createNavigationModule } from '../services/navigation';
import {
  createAudioAnalysisModule,
  createAudioModule,
  createCloudPlaybackQueueModule,
} from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createMediaSessionModule } from '../services/media-session';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createBuiltinKeybindingsModule } from '../builtin-modules/builtinKeybindingsModule';
import { createKeybindingsModule } from '../services/keybindings';
import {
  createMemoryGovernanceModule,
  createSpaceRuntimeGovernanceModule,
} from '../services/governance';
import { createQualityModule } from '../services/quality';
import { createPerformanceControlModule } from '../services/performance-control';
import {
  createEditorToolsRuntimeCapsuleModule,
  createRuntimeCapsuleManagerModule,
} from '../services/runtime-capsules';
import { createTelemetryModule } from '../services/telemetry';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { PMP_STORAGE_CHANGE_EVENT } from '../modules/storage/localStorage';
import { recordStartupMemoryCheckpoint } from '../modules/startup/startupMemoryTrace';
import { createPlatformWorkspaceGovernanceModule } from '../modules/music-platform/platformWorkspaceGovernanceModule';
import { KernelContext } from './KernelApiContext';
import { resolveKernelWindowProfile } from './kernelWindowProfile';

type DesktopKernel = Kernel<AppEvents>;

type KernelRuntime = {
  kernel: DesktopKernel;
  loader: ModuleLoader<AppEvents>;
  activatePluginModules: () => Promise<void>;
  shouldActivatePluginModules: () => boolean;
  requiresPluginModulesBeforeRender: boolean;
  markDisposed: () => void;
};

let cachedRuntime: KernelRuntime | null = null;

function forwardKernelLog(
  component: string,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  event: string,
  options?: { message?: string; fields?: Record<string, unknown> }
): void {
  const logger = getTelemetryLogger('kernel', component);
  switch (level) {
    case 'trace':
      logger.trace(event, options);
      return;
    case 'debug':
      logger.debug(event, options);
      return;
    case 'info':
      logger.info(event, options);
      return;
    case 'warn':
      logger.warn(event, options);
      return;
    case 'error':
      logger.error(event, options);
      return;
    case 'fatal':
      logger.fatal(event, options);
      return;
    default: {
      const exhaustive: never = level;
      throw new Error(`Unsupported kernel log level: ${String(exhaustive)}`);
    }
  }
}

export function hasEnabledInstalledExtensionCandidates(raw: string | null | undefined): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[]') return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const enabled = (entry as { enabled?: unknown }).enabled;
    if (enabled === false) continue;
    return true;
  }
  return false;
}

function hasLikelyInstalledExtensionsV2(): boolean {
  if (typeof window === 'undefined') return false;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.EXTENSIONS_V2);
  } catch {
    return false;
  }
  return hasEnabledInstalledExtensionCandidates(raw);
}

async function loadPluginRuntimeModules(options: {
  enableShellSurfaceBackgroundSync: boolean;
  autoStartBackgroundRuntimes: boolean;
}): Promise<KernelModule<AppEvents>[]> {
  const [
    shellSurfaceManagerModule,
    runtimeManagerModule,
    extensionContributionModule,
    extensionRendererModule,
  ] = await Promise.all([
    import('../magnet-system/plugins/shellSurfaceManagerModule'),
    import('../magnet-system/plugins/installedExtensionRuntimeManagerModule'),
    import('../magnet-system/plugins/extensionContributionsModule'),
    import('../magnet-system/plugins/installedExtensionMagnetRenderersModule'),
  ]);

  const modules: KernelModule<AppEvents>[] = [
    shellSurfaceManagerModule.createShellSurfaceManagerModule({
      enableBackgroundSync: options.enableShellSurfaceBackgroundSync,
    }),
    runtimeManagerModule.createInstalledExtensionRuntimeManagerModule({
      autoStartBackgroundRuntimes: options.autoStartBackgroundRuntimes,
    }),
    extensionContributionModule.createInstalledExtensionContributionsModule(),
    extensionRendererModule.createInstalledExtensionMagnetRenderersModule(),
  ];

  return modules;
}

async function loadBuiltinContributionsModule(): Promise<KernelModule<AppEvents>> {
  const mod = await import('../builtin-modules/builtinContributionsModule');
  return mod.createBuiltinContributionsModule();
}

function createRuntime(): KernelRuntime {
  const telemetry = getTelemetryLogger('kernel', 'KernelContext');
  setKernelLogSink({
    log(component, level, event, options) {
      forwardKernelLog(component, level, event, options);
    },
  });
  const kernel = createKernel<AppEvents>();
  const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);

  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const profile = resolveKernelWindowProfile(hash);
  const { isEditorWindow, isRegistrationWindow, isAuxWindow, canUsePluginModules } = profile;

  let runtimeDisposed = false;
  let pluginModulesActivated = false;
  let pluginActivationPromise: Promise<void> | null = null;
  let builtinContributionsActivated = false;
  let builtinContributionsActivationPromise: Promise<void> | null = null;

  const activatePluginModules = async (): Promise<void> => {
    if (!canUsePluginModules) return;
    if (runtimeDisposed || pluginModulesActivated) return;
    if (pluginActivationPromise) {
      await pluginActivationPromise;
      return;
    }

    pluginActivationPromise = (async () => {
      const modules = await loadPluginRuntimeModules({
        enableShellSurfaceBackgroundSync: !isAuxWindow,
        autoStartBackgroundRuntimes: !isRegistrationWindow,
      });
      if (runtimeDisposed || pluginModulesActivated) return;
      loader.activate(modules);
      pluginModulesActivated = true;
      telemetry.info('kernel.plugin-modules.activated', {
        fields: {
          moduleCount: modules.length,
        },
      });
    })().finally(() => {
      pluginActivationPromise = null;
    });

    await pluginActivationPromise;
  };

  const activateBuiltinContributions = async (): Promise<void> => {
    if (runtimeDisposed || builtinContributionsActivated) return;
    if (builtinContributionsActivationPromise) {
      await builtinContributionsActivationPromise;
      return;
    }

    builtinContributionsActivationPromise = (async () => {
      const module = await loadBuiltinContributionsModule();
      if (runtimeDisposed || builtinContributionsActivated) return;
      loader.activate([module]);
      builtinContributionsActivated = true;
      telemetry.info('kernel.builtin-contributions.activated');
      recordStartupMemoryCheckpoint('builtin-contributions.activated');
    })().finally(() => {
      builtinContributionsActivationPromise = null;
    });

    await builtinContributionsActivationPromise;
  };

  const shouldActivatePluginModules = (): boolean => {
    if (!canUsePluginModules) return false;
    if (runtimeDisposed || pluginModulesActivated || pluginActivationPromise) return false;
    return hasLikelyInstalledExtensionsV2();
  };

  const modules: KernelModule<AppEvents>[] = [
    createLifecycleModule(),
    createTelemetryModule(),
    createQualityModule(),
  ];

  if (profile.needsRuntimeCapsuleManager) {
    modules.push(createRuntimeCapsuleManagerModule());
  }

  if (profile.needsEditorRuntimeServices) {
    modules.push(createEditorToolsRuntimeCapsuleModule());
    modules.push(createPerformanceControlModule());
  }

  modules.push(
    createNavigationModule(),
    createAudioModule({
      mode: isEditorWindow ? 'noop' : 'real',
      enableTaskbarMediaControls: !isAuxWindow,
    }),
    createCommandsModule(),
    createKeybindingsModule(),
    createBuiltinCommandsModule(),
    createBuiltinKeybindingsModule()
  );

  if (profile.needsBuiltinMagnetRenderers) {
    modules.push(createBuiltinMagnetRenderersModule());
  }

  if (!isEditorWindow) {
    modules.push(createAudioAnalysisModule({ enablePreheat: !isAuxWindow }));
    modules.push(createCloudPlaybackQueueModule());
    modules.push(createMediaSessionModule({ enabled: !isAuxWindow }));
  }

  if (!isAuxWindow) {
    modules.push(createPlatformWorkspaceGovernanceModule());
    modules.push(createSpaceRuntimeGovernanceModule());
    modules.push(createMemoryGovernanceModule());
  }

  loader.activate(modules);
  telemetry.info('kernel.runtime.created');
  telemetry.info('kernel.modules.activated', {
    fields: {
      moduleCount: modules.length,
      auxWindow: isAuxWindow,
      canUsePluginModules,
    },
  });
  recordStartupMemoryCheckpoint('kernel.modules.activated', {
    fields: {
      moduleCount: modules.length,
      auxWindow: isAuxWindow,
      canUsePluginModules,
    },
  });

  if (!isAuxWindow) {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        void activateBuiltinContributions();
      }, 600);
    });
  }

  if (shouldActivatePluginModules()) {
    void activatePluginModules();
  }

  return {
    kernel,
    loader,
    activatePluginModules,
    shouldActivatePluginModules,
    requiresPluginModulesBeforeRender: isRegistrationWindow,
    markDisposed: () => {
      runtimeDisposed = true;
    },
  };
}

function getOrCreateRuntime(): KernelRuntime {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = createRuntime();
  return cachedRuntime;
}

function disposeRuntime(runtime: KernelRuntime): void {
  runtime.markDisposed();
  runtime.loader.deactivateAll();
  if (cachedRuntime === runtime) {
    cachedRuntime = null;
  }
}

export function KernelProvider({ children }: { children: ReactNode }) {
  const pendingDeactivate = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtime] = useState<KernelRuntime>(() => getOrCreateRuntime());
  const [runtimeReady, setRuntimeReady] = useState(
    () => !runtime.requiresPluginModulesBeforeRender
  );

  useEffect(() => {
    if (!runtime.requiresPluginModulesBeforeRender) {
      setRuntimeReady(true);
      return;
    }

    let disposed = false;
    void runtime
      .activatePluginModules()
      .then(() => {
        if (!disposed) setRuntimeReady(true);
      })
      .catch((error) => {
        getTelemetryLogger('kernel', 'KernelProvider').error(
          'kernel.registration-plugin-modules.activate.failed',
          {
            message: error instanceof Error ? error.message : String(error),
          }
        );
      });
    return () => {
      disposed = true;
    };
  }, [runtime]);

  useEffect(() => {
    const tryActivate = () => {
      if (!runtime.shouldActivatePluginModules()) return;
      void runtime.activatePluginModules();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.EXTENSIONS_V2) {
        return;
      }
      tryActivate();
    };

    const onPmpStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string | null }>).detail;
      if (detail?.key !== STORAGE_KEYS.EXTENSIONS_V2) {
        return;
      }
      tryActivate();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onPmpStorageChange as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onPmpStorageChange as EventListener);
    };
  }, [runtime]);

  useEffect(() => {
    if (pendingDeactivate.current) {
      clearTimeout(pendingDeactivate.current);
      pendingDeactivate.current = null;
    }

    return () => {
      pendingDeactivate.current = setTimeout(() => {
        disposeRuntime(runtime);
        pendingDeactivate.current = null;
      }, 0);
    };
  }, [runtime]);

  useEffect(() => {
    const disposeOnPageExit = () => {
      if (pendingDeactivate.current) {
        clearTimeout(pendingDeactivate.current);
        pendingDeactivate.current = null;
      }
      disposeRuntime(runtime);
    };

    window.addEventListener('pagehide', disposeOnPageExit);
    return () => window.removeEventListener('pagehide', disposeOnPageExit);
  }, [runtime]);

  return (
    <KernelContext.Provider value={runtime.kernel}>
      {runtimeReady ? children : null}
    </KernelContext.Provider>
  );
}

export { useKernel } from './KernelApiContext';
export { resolveKernelWindowProfile } from './kernelWindowProfile';
