import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { DefaultShellSurfaceManager, SHELL_SURFACE_MANAGER_TOKEN } from './shellSurfaceManager';

export function createShellSurfaceManagerModule(options: {
  enableBackgroundSync?: boolean;
} = {}): KernelModule<AppEvents> {
  return {
    id: 'plugin-shell-surface-manager',
    activate: ({ services }) => {
      const manager = new DefaultShellSurfaceManager({
        enableBackgroundSync: options.enableBackgroundSync ?? true,
      });
      const unregister = services.register(SHELL_SURFACE_MANAGER_TOKEN, manager, {
        replace: true,
      });
      manager.start();

      return () => {
        manager.dispose();
        unregister();
      };
    },
  };
}
