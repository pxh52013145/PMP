import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createKernel, ModuleLoader, type Kernel } from '../kernel';
import type { AppEvents } from '../contracts/events';
import { createNavigationModule } from '../services/navigation';
import { createAudioModule } from '../services/audio';
import { createCommandsModule } from '../services/commands';
import { createBuiltinContributionsModule } from '../builtin-modules/builtinContributionsModule';
import { createBuiltinMagnetRenderersModule } from '../builtin-modules/builtinMagnetRenderersModule';
import { createBuiltinCommandsModule } from '../builtin-modules/builtinCommandsModule';
import { createPmpmContributionsModule } from '../magnet-system/plugins/pmpmContributionsModule';
import { createPmpmMagnetRenderersModule } from '../magnet-system/plugins/pmpmMagnetRenderersModule';

type DesktopKernel = Kernel<AppEvents>;

type KernelRuntime = {
  kernel: DesktopKernel;
  loader: ModuleLoader<AppEvents>;
};

const KernelContext = createContext<DesktopKernel | undefined>(undefined);

export function KernelProvider({ children }: { children: ReactNode }) {
  const pendingDeactivate = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [runtime] = useState<KernelRuntime>(() => {
    const kernel = createKernel<AppEvents>();
    const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    const isEditorWindow = hash.startsWith('#/editor/');
    const isPluginWindow = hash.startsWith('#/plugin-window/');
    const isVstEditorWindow = hash.startsWith('#/vst-editor/');

      const modules = [
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
      modules.push(createBuiltinContributionsModule());
    }

    if (!isEditorWindow) {
      modules.push(createPmpmContributionsModule());
    }

    loader.activate(modules);
    return { kernel, loader };
  });

  useEffect(() => {
    if (pendingDeactivate.current) {
      clearTimeout(pendingDeactivate.current);
      pendingDeactivate.current = null;
    }

    return () => {
      pendingDeactivate.current = setTimeout(() => {
        runtime.loader.deactivateAll();
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
