import type { MagnetRendererDefinition } from '../registry';
import { PluginMagnetHost } from './PluginMagnetHost';
import { getInstalledPmpmPlugin } from './pmpm';

export function getPluginRendererDefinition(id: string): MagnetRendererDefinition | null {
  const plugin = getInstalledPmpmPlugin(id);
  if (!plugin) return null;

  const enabled = plugin.enabled ?? true;

  return {
    id,
    source: 'plugin',
    description: plugin.manifest.metadata.description,
    group: 'plugin',
    tags: plugin.manifest.metadata.tags,
    metadata: {
      pluginVersion: plugin.manifest.metadata.version,
      permissions: plugin.manifest.permissions ?? [],
      enabled,
    },
    render: () =>
      enabled ? (
        <PluginMagnetHost pluginId={id} />
      ) : (
        <DisabledPluginMagnet pluginId={id} />
      ),
    preview: plugin.manifest.metadata.name,
  };
}

function DisabledPluginMagnet({ pluginId }: { pluginId: string }) {
  const plugin = getInstalledPmpmPlugin(pluginId);
  const name = plugin?.manifest.metadata.name ?? pluginId;
  const reason = plugin?.disabledReason;
  const lastError = plugin?.lastError;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        color: 'rgba(255,255,255,0.78)',
      }}
    >
      <div style={{ fontWeight: 700 }}>{name || pluginId}</div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        {reason === 'crash'
          ? 'Plugin disabled (crashed)'
          : reason === 'quarantine'
            ? 'Plugin disabled (quarantined)'
            : 'Plugin disabled'}
      </div>
      {lastError && (
        <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'pre-wrap' }}>{lastError}</div>
      )}
    </div>
  );
}
