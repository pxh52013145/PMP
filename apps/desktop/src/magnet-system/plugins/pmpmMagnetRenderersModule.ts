import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { registerMagnetRenderer, unregisterMagnetRenderer } from '../registry';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { clearMagnetVariants, registerMagnetVariant } from '../variantRegistry';
import { getPluginRendererDefinition, loadInstalledPmpmPlugins, subscribePmpmPlugins } from './pmpm';

const telemetry = getTelemetryLogger('pmpm', 'pmpmMagnetRenderersModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPmpmMagnetRenderersModule(): KernelModule<AppEvents> {
  return {
    id: 'pmpm-magnet-renderers',
    activate: () => {
      const registered = new Set<string>();

      const sync = () => {
        const installed = loadInstalledPmpmPlugins();
        const installedById = new Map(installed.map((plugin) => [plugin.manifest.metadata.id, plugin]));
        const nextIds = new Set(installed.map((plugin) => plugin.manifest.metadata.id));

        for (const id of Array.from(registered)) {
          if (nextIds.has(id)) continue;
          unregisterMagnetRenderer(id);
          clearMagnetVariants(id);
          registered.delete(id);
        }

        for (const id of nextIds) {
          const def = getPluginRendererDefinition(id);
          if (!def) continue;
          registerMagnetRenderer(def, { overwrite: true });
          registered.add(id);

          clearMagnetVariants(id);
          const plugin = installedById.get(id);
          if (!plugin) continue;
          const variants = plugin.manifest.magnet?.variants ?? [];
          for (const variant of variants) {
            registerMagnetVariant(
              id,
              {
                id: variant.id,
                label: variant.label,
                description: variant.description,
                source: 'plugin',
                metadata: {
                  pluginId: id,
                  pluginVersion: plugin.manifest.metadata.version,
                  ...(variant.metadata ?? {}),
                },
              },
              { overwrite: true }
            );
          }
        }
      };

      sync();
      const unsubscribe = subscribePmpmPlugins(sync);

      return () => {
        try {
          unsubscribe();
        } catch (error) {
          telemetry.warn('plugin_magnet_renderers.unsubscribe.failed', {
            message: readErrorMessage(error),
          });
        }

        for (const id of Array.from(registered)) {
          unregisterMagnetRenderer(id);
          clearMagnetVariants(id);
        }
        registered.clear();
      };
    },
  };
}

