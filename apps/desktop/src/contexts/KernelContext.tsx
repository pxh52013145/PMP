import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createKernel, ModuleLoader, type Kernel } from '../kernel';
import type { AppEvents } from '../contracts/events';
import { createLifecycleModule } from '../services/lifecycle';
import { createNavigationModule } from '../services/navigation';
import { createAudioModule } from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createMediaSessionModule } from '../services/media-session';
import { createBuiltinContributionsModule } from '../builtin-modules/builtinContributionsModule';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createBuiltinKeybindingsModule } from '../builtin-modules/builtinKeybindingsModule';
import { createBuiltinWorkbenchesModule } from '../builtin-modules/builtinWorkbenchesModule';
import { createPmpmContributionsModule } from '../magnet-system/plugins/pmpmContributionsModule';
import { createPmpmMagnetRenderersModule } from '../magnet-system/plugins/pmpmMagnetRenderersModule';
import { createKeybindingsModule } from '../services/keybindings';

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
  const isVstManagerWindow = hash.startsWith('#/vst-manager');
  const isAuxWindow = isEditorWindow || isPluginWindow || isVstManagerWindow;

  const modules = [
    createLifecycleModule(),
    createNavigationModule(),
    createAudioModule({
      mode: isEditorWindow ? 'noop' : 'real',
      enableTaskbarMediaControls: !isAuxWindow,
    }),
    createCommandsModule(),
    createKeybindingsModule(),
    createMediaSessionModule({ enabled: !isAuxWindow }),
    createBuiltinMagnetRenderersModule(),
    createPmpmMagnetRenderersModule(),
    createBuiltinCommandsModule(),
    createBuiltinKeybindingsModule(),
  ];

  if (!isAuxWindow) {
    modules.push(createBuiltinWorkbenchesModule());
    modules.push(createBuiltinContributionsModule());
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
