import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppEvents } from '../contracts/events';
import {
  createKernel,
  ModuleLoader,
  setKernelLogSink,
  type Kernel,
  type KernelModule,
} from '../kernel';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createBuiltinKeybindingsModule } from '../builtin-modules/builtinKeybindingsModule';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createAudioModule } from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createKeybindingsModule } from '../services/keybindings';
import { createLifecycleModule } from '../services/lifecycle';
import { createNavigationModule } from '../services/navigation';
import { createQualityModule } from '../services/quality';
import { createRuntimeCapsuleManagerModule } from '../services/runtime-capsules';
import { createTelemetryModule } from '../services/telemetry';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import {
  KernelContext,
  registerEditorKernelDisposer,
} from './KernelApiContext';
import { resolveKernelWindowProfile } from './kernelWindowProfile';

type EditorKernel = Kernel<AppEvents>;

type EditorKernelRuntime = {
  kernel: EditorKernel;
  loader: ModuleLoader<AppEvents>;
  activatePluginModules: () => Promise<void>;
  requiresPluginModulesBeforeRender: boolean;
  dispose: () => void;
};

let cachedEditorRuntime: EditorKernelRuntime | null = null;

function forwardKernelLog(
  component: string,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  event: string,
  options?: { message?: string; fields?: Record<string, unknown> }
): void {
  const logger = getTelemetryLogger('kernel', component);
  logger[level](event, options);
}

async function loadPluginRuntimeModules(): Promise<KernelModule<AppEvents>[]> {
  const [shellSurfaceManager, runtimeManager, contributions, renderers] = await Promise.all([
    import('../magnet-system/plugins/shellSurfaceManagerModule'),
    import('../magnet-system/plugins/installedExtensionRuntimeManagerModule'),
    import('../magnet-system/plugins/extensionContributionsModule'),
    import('../magnet-system/plugins/installedExtensionMagnetRenderersModule'),
  ]);

  return [
    shellSurfaceManager.createShellSurfaceManagerModule({ enableBackgroundSync: false }),
    runtimeManager.createInstalledExtensionRuntimeManagerModule({
      autoStartBackgroundRuntimes: false,
    }),
    contributions.createInstalledExtensionContributionsModule(),
    renderers.createInstalledExtensionMagnetRenderersModule(),
  ];
}

function createEditorRuntime(): EditorKernelRuntime {
  setKernelLogSink({ log: forwardKernelLog });
  const kernel = createKernel<AppEvents>();
  const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);
  const profile = resolveKernelWindowProfile(window.location.hash);
  let disposed = false;
  let pluginModulesActivated = false;
  let pluginActivationPromise: Promise<void> | null = null;

  const modules: KernelModule<AppEvents>[] = [
    createLifecycleModule(),
    createTelemetryModule(),
    createQualityModule(),
  ];

  if (profile.needsRuntimeCapsuleManager) {
    modules.push(createRuntimeCapsuleManagerModule());
  }

  modules.push(
    createNavigationModule(),
    createAudioModule({ mode: 'noop', enableTaskbarMediaControls: false }),
    createCommandsModule(),
    createKeybindingsModule(),
    createBuiltinCommandsModule(),
    createBuiltinKeybindingsModule()
  );

  if (profile.needsBuiltinMagnetRenderers) {
    modules.push(createBuiltinMagnetRenderersModule());
  }

  loader.activate(modules);

  const activatePluginModules = async () => {
    if (!profile.isRegistrationWindow || disposed || pluginModulesActivated) return;
    if (pluginActivationPromise) return await pluginActivationPromise;

    pluginActivationPromise = (async () => {
      const pluginModules = await loadPluginRuntimeModules();
      if (disposed || pluginModulesActivated) return;
      loader.activate(pluginModules);
      pluginModulesActivated = true;
    })().finally(() => {
      pluginActivationPromise = null;
    });
    await pluginActivationPromise;
  };

  const runtime: EditorKernelRuntime = {
    kernel,
    loader,
    activatePluginModules,
    requiresPluginModulesBeforeRender: profile.isRegistrationWindow,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      loader.deactivateAll();
      if (cachedEditorRuntime === runtime) cachedEditorRuntime = null;
    },
  };
  return runtime;
}

function getOrCreateEditorRuntime(): EditorKernelRuntime {
  if (cachedEditorRuntime) return cachedEditorRuntime;
  cachedEditorRuntime = createEditorRuntime();
  return cachedEditorRuntime;
}

function currentEditorType(): string {
  const type = window.location.hash.slice('#/editor/'.length).split(/[/?#]/, 1)[0];
  return type === 'theme' ? 'registration' : type;
}

export function EditorKernelProvider({ children }: { children: ReactNode }) {
  const pendingDeactivate = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtime] = useState(getOrCreateEditorRuntime);
  const [runtimeReady, setRuntimeReady] = useState(
    () => !runtime.requiresPluginModulesBeforeRender
  );

  useEffect(() => {
    if (!runtime.requiresPluginModulesBeforeRender) return;
    let cancelled = false;
    void runtime
      .activatePluginModules()
      .then(() => {
        if (!cancelled) setRuntimeReady(true);
      })
      .catch((error) => {
        getTelemetryLogger('kernel', 'EditorKernelProvider').error(
          'kernel.editor-plugin-modules.activate.failed',
          { message: error instanceof Error ? error.message : String(error) }
        );
        if (!cancelled) setRuntimeReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);

  useEffect(() => {
    if (pendingDeactivate.current) {
      clearTimeout(pendingDeactivate.current);
      pendingDeactivate.current = null;
    }
    return () => {
      pendingDeactivate.current = setTimeout(() => {
        runtime.dispose();
        pendingDeactivate.current = null;
      }, 0);
    };
  }, [runtime]);

  useEffect(() => {
    const dispose = () => {
      if (pendingDeactivate.current) {
        clearTimeout(pendingDeactivate.current);
        pendingDeactivate.current = null;
      }
      runtime.dispose();
    };
    const unregisterDisposer = registerEditorKernelDisposer((windowType) => {
      const normalizedTarget = windowType === 'theme' ? 'registration' : windowType;
      if (normalizedTarget !== currentEditorType()) return false;
      dispose();
      return true;
    });
    window.addEventListener('pagehide', dispose);
    return () => {
      unregisterDisposer();
      window.removeEventListener('pagehide', dispose);
    };
  }, [runtime]);

  return (
    <KernelContext.Provider value={runtime.kernel}>
      {runtimeReady ? children : null}
    </KernelContext.Provider>
  );
}
