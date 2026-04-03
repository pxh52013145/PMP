import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createKernel, ModuleLoader, setKernelLogSink, type Kernel, type KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import { createLifecycleModule } from '../services/lifecycle';
import { createNavigationModule } from '../services/navigation';
import { createAudioModule, createCloudPlaybackQueueModule } from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createMediaSessionModule } from '../services/media-session';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createBuiltinKeybindingsModule } from '../builtin-modules/builtinKeybindingsModule';
import { createKeybindingsModule } from '../services/keybindings';
import { createMemoryGovernanceModule } from '../services/governance';
import { createQualityModule } from '../services/quality';
import { createPerformanceControlModule } from '../services/performance-control';
import { createTelemetryModule } from '../services/telemetry';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { PMP_STORAGE_CHANGE_EVENT } from '../modules/storage/localStorage';

type DesktopKernel = Kernel<AppEvents>;

type KernelRuntime = {
  kernel: DesktopKernel;
  loader: ModuleLoader<AppEvents>;
  activatePluginModules: () => Promise<void>;
  shouldActivatePluginModules: () => boolean;
  markDisposed: () => void;
};

const KernelContext = createContext<DesktopKernel | undefined>(undefined);

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

export function hasEnabledPmpmPluginCandidates(raw: string | null | undefined): boolean {
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

function hasLikelyInstalledPmpmPlugins(): boolean {
  if (typeof window === 'undefined') return false;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEYS.PMPM_PLUGINS);
  } catch {
    return false;
  }
  return hasEnabledPmpmPluginCandidates(raw);
}

async function loadPmpmRuntimeModules(): Promise<KernelModule<AppEvents>[]> {
  const [rendererModule, contributionModule] = await Promise.all([
    import('../magnet-system/plugins/pmpmMagnetRenderersModule'),
    import('../magnet-system/plugins/pmpmContributionsModule'),
  ]);
  return [
    rendererModule.createPmpmMagnetRenderersModule(),
    contributionModule.createPmpmContributionsModule(),
  ];
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
  const isEditorWindow = hash.startsWith('#/editor/');
  const isPluginWindow = hash.startsWith('#/plugin-window/');
  const isVstManagerWindow = hash.startsWith('#/vst-manager');
  const isAuxWindow = isEditorWindow || isPluginWindow || isVstManagerWindow;
  const canUsePluginModules = !isEditorWindow;

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
      const modules = await loadPmpmRuntimeModules();
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
    })().finally(() => {
      builtinContributionsActivationPromise = null;
    });

    await builtinContributionsActivationPromise;
  };

  const shouldActivatePluginModules = (): boolean => {
    if (!canUsePluginModules) return false;
    if (runtimeDisposed || pluginModulesActivated || pluginActivationPromise) return false;
    return hasLikelyInstalledPmpmPlugins();
  };

  const modules = [
    createLifecycleModule(),
    createTelemetryModule(),
    createQualityModule(),
    createPerformanceControlModule(),
    createNavigationModule(),
    createAudioModule({
      mode: isEditorWindow ? 'noop' : 'real',
      enableTaskbarMediaControls: !isAuxWindow,
    }),
    createCloudPlaybackQueueModule(),
    createCommandsModule(),
    createKeybindingsModule(),
    createMediaSessionModule({ enabled: !isAuxWindow }),
    createBuiltinMagnetRenderersModule(),
    createBuiltinCommandsModule(),
    createBuiltinKeybindingsModule(),
  ];

  if (!isAuxWindow) {
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

  useEffect(() => {
    const tryActivate = () => {
      if (!runtime.shouldActivatePluginModules()) return;
      void runtime.activatePluginModules();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
      tryActivate();
    };

    const onPmpStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string | null }>).detail;
      if (detail?.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
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

  return <KernelContext.Provider value={runtime.kernel}>{children}</KernelContext.Provider>;
}

export function useKernel(): DesktopKernel {
  const kernel = useContext(KernelContext);
  if (!kernel) {
    throw new Error('useKernel must be used within KernelProvider');
  }
  return kernel;
}
