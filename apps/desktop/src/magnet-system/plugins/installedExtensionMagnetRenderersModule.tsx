import React from 'react';
import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { registerMagnetRenderer, unregisterMagnetRenderer } from '../registry';
import { clearMagnetVariants, registerMagnetVariant } from '../variantRegistry';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  getInstalledExtensionRecord,
  loadInstalledExtensions,
  subscribeInstalledExtensions,
} from './extensions';
import {
  readInstalledExtensionPmpHostContributions,
  supportsInstalledExtensionMagnetSurface,
} from './installedExtensionHostPmp';
import { InstalledExtensionMagnetHost } from './InstalledExtensionSurfaceHost';

const telemetry = getTelemetryLogger('extensions', 'installedExtensionMagnetRenderersModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInstalledExtensionRendererDefinition(id: string) {
  const record = getInstalledExtensionRecord(id);
  if (!record || !supportsInstalledExtensionMagnetSurface(record)) return null;

  const identity = record.manifest.identity;
  const enabled = record.enabled ?? true;

  return {
    id,
    source: 'plugin' as const,
    description: identity.description,
    group: 'plugin',
    tags: [...(identity.keywords ?? []), ...(identity.categories ?? [])],
    metadata: {
      pluginVersion: identity.version,
      enabled,
    },
    render: () =>
      enabled
        ? React.createElement(InstalledExtensionMagnetHost, { pluginId: id })
        : React.createElement(DisabledInstalledExtensionMagnet, { pluginId: id }),
    preview: identity.displayName ?? identity.name,
  };
}

function DisabledInstalledExtensionMagnet({ pluginId }: { pluginId: string }) {
  const record = getInstalledExtensionRecord(pluginId);
  const name = record?.manifest.identity.displayName ?? record?.manifest.identity.name ?? pluginId;
  const reason = record?.disabledReason;
  const lastError = record?.lastError;

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        color: 'rgba(255,255,255,0.78)',
      },
    },
    React.createElement('div', { style: { fontWeight: 700 } }, name || pluginId),
    React.createElement(
      'div',
      { style: { fontSize: 12, opacity: 0.75 } },
      reason === 'crash' ? 'Extension disabled (crashed)' : 'Extension disabled'
    ),
    lastError
      ? React.createElement(
          'div',
          { style: { fontSize: 11, opacity: 0.7, whiteSpace: 'pre-wrap' } },
          lastError
        )
      : null
  );
}

export function createInstalledExtensionMagnetRenderersModule(): KernelModule<AppEvents> {
  return {
    id: 'installed-extension-magnet-renderers',
    activate: () => {
      const registered = new Set<string>();

      const sync = () => {
        const installed = loadInstalledExtensions();
        const installedById = new Map(
          installed.map((record) => [record.manifest.identity.id, record] as const)
        );
        const nextIds = new Set(
          installed
            .filter((record) => supportsInstalledExtensionMagnetSurface(record))
            .map((record) => record.manifest.identity.id)
        );

        for (const id of Array.from(registered)) {
          if (nextIds.has(id)) continue;
          unregisterMagnetRenderer(id);
          clearMagnetVariants(id);
          registered.delete(id);
        }

        for (const id of nextIds) {
          const def = getInstalledExtensionRendererDefinition(id);
          if (!def) continue;
          registerMagnetRenderer(def, { overwrite: true });
          registered.add(id);

          clearMagnetVariants(id);
          const record = installedById.get(id);
          if (!record) continue;
          const contributions = readInstalledExtensionPmpHostContributions(record.manifest);
          for (const variant of contributions?.magnets?.variants ?? []) {
            registerMagnetVariant(
              id,
              {
                id: variant.id,
                label: variant.label,
                description: variant.description,
                source: 'plugin',
                metadata: {
                  pluginId: id,
                  pluginVersion:
                    getInstalledExtensionRecord(id)?.manifest.identity.version ?? undefined,
                  ...(variant.metadata ?? {}),
                },
              },
              { overwrite: true }
            );
          }
        }
      };

      sync();
      const unsubscribe = subscribeInstalledExtensions(sync);

      return () => {
        try {
          unsubscribe();
        } catch (error) {
          telemetry.warn('installed_extension_magnet_renderers.unsubscribe.failed', {
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
