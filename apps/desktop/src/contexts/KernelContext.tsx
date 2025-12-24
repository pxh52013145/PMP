import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createKernel, ModuleLoader, type Kernel } from '../kernel';
import type { AppEvents } from '../contracts/events';
import { createLifecycleModule } from '../services/lifecycle';
import { createNavigationModule } from '../services/navigation';
import { createAudioModule } from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createBuiltinContributionsModule } from '../builtin-modules/builtinContributionsModule';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createBuiltinWorkbenchesModule } from '../builtin-modules/builtinWorkbenchesModule';
import { createBuiltinVstEditorWindowsModule } from '../builtin-modules/builtinVstEditorWindowsModule';
import { createPmpmContributionsModule } from '../magnet-system/plugins/pmpmContributionsModule';
import { createPmpmMagnetRenderersModule } from '../magnet-system/plugins/pmpmMagnetRenderersModule';

type DesktopKernel = Kernel<AppEvents>;

type KernelRuntime = {
  kernel: DesktopKernel;
  loader: ModuleLoader<AppEvents>;
};

const KernelContext = createContext<DesktopKernel | undefined>(undefined);

let cachedRuntime: KernelRuntime | null = null;

function createRuntime(): KernelRuntime {
  const kernel = createKernel<AppEvents>();
  const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);

  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const isEditorWindow = hash.startsWith('#/editor/');
  const isPluginWindow = hash.startsWith('#/plugin-window/');
  const isVstEditorWindow = hash.startsWith('#/vst-editor/');

  const modules = [
    createLifecycleModule(),
    createNavigationModule(),
    createAudioModule({
      mode: isEditorWindow ? 'noop' : 'real',
      enableTaskbarMediaControls: !isEditorWindow && !isPluginWindow && !isVstEditorWindow,
    }),
    createCommandsModule(),
    createBuiltinMagnetRenderersModule(),
    createPmpmMagnetRenderersModule(),
    createBuiltinCommandsModule(),
  ];

  if (!isEditorWindow && !isPluginWindow && !isVstEditorWindow) {
    modules.push(createBuiltinWorkbenchesModule());
    modules.push(createBuiltinContributionsModule());
    modules.push(createBuiltinVstEditorWindowsModule());
  }

  if (!isEditorWindow) {
    modules.push(createPmpmContributionsModule());
  }

  loader.activate(modules);
  return { kernel, loader };
}

function getOrCreateRuntime(): KernelRuntime {
  if (cachedRuntime) return cachedRuntime;
  cachedRuntime = createRuntime();
  return cachedRuntime;
}

function disposeRuntime(runtime: KernelRuntime): void {
  runtime.loader.deactivateAll();
  if (cachedRuntime === runtime) {
    cachedRuntime = null;
  }
}

export function KernelProvider({ children }: { children: ReactNode }) {
  const pendingDeactivate = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [runtime] = useState<KernelRuntime>(() => getOrCreateRuntime());

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
