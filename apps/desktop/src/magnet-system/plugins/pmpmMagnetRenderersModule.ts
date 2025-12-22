import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { registerMagnetRenderer, unregisterMagnetRenderer } from '../registry';
import { getPluginRendererDefinition, loadInstalledPmpmPlugins, subscribePmpmPlugins } from './pmpm';

export function createPmpmMagnetRenderersModule(): KernelModule<AppEvents> {
  return {
    id: 'pmpm-magnet-renderers',
    activate: () => {
      const registered = new Set<string>();

      const sync = () => {
        const installed = loadInstalledPmpmPlugins();
        const nextIds = new Set(installed.map((plugin) => plugin.manifest.metadata.id));

        for (const id of Array.from(registered)) {
          if (nextIds.has(id)) continue;
          unregisterMagnetRenderer(id);
          registered.delete(id);
        }

        for (const id of nextIds) {
          const def = getPluginRendererDefinition(id);
          if (!def) continue;
          registerMagnetRenderer(def, { overwrite: true });
          registered.add(id);
        }
      };

      sync();
      const unsubscribe = subscribePmpmPlugins(sync);

      return () => {
        try {
          unsubscribe();
        } catch (error) {
          console.warn('[pmpm-magnet-renderers] unsubscribe failed', error);
        }

        for (const id of Array.from(registered)) {
          unregisterMagnetRenderer(id);
        }
        registered.clear();
      };
    },
  };
}

