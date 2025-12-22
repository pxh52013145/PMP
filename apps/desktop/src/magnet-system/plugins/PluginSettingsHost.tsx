import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';
import {
  getPmpmPluginEffectivePermissions,
  getPmpmPluginsRevision,
  recordPmpmPluginCrash,
  subscribePmpmPlugins,
} from './pmpm';
import { ensurePmpmPluginRuntime } from './pmpmRuntime';
import { createPluginMountApi, type PluginMountApi } from './pluginHostApi';

export function PluginSettingsHost({
  pluginId,
  panelId,
}: {
  pluginId: string;
  panelId?: string;
}) {
  const audioService = useAudioService();
  const navigation = useNavigation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const permissions = useMemo(() => {
    void pluginStoreRevision;
    return getPmpmPluginEffectivePermissions(pluginId);
  }, [pluginId, pluginStoreRevision]);

  const api = useMemo<PluginMountApi>(() => {
    return createPluginMountApi({
      pluginId,
      hostLabel: 'PluginSettingsHost',
      permissions,
      audioService,
      navigation,
    });
  }, [audioService, navigation, permissions, pluginId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setError(null);

    void ensurePmpmPluginRuntime(pluginId)
      .then((runtime) => {
        if (cancelled) return;

        const mount = runtime.mountSettings;
        if (typeof mount !== 'function') {
          throw new Error('Plugin entry must export `mountSettings(container, api, panelId?)`');
        }

        try {
          const cleanup = mount(container, api, panelId);
          cleanupRef.current = typeof cleanup === 'function' ? cleanup : null;
        } catch (err) {
          throw err instanceof Error ? err : new Error(String(err));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        recordPmpmPluginCrash(pluginId, err, 'settings');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      try {
        cleanupRef.current?.();
      } finally {
        cleanupRef.current = null;
        container.innerHTML = '';
      }
    };
  }, [api, panelId, pluginId]);

  if (error) {
    return (
      <div style={{ width: '100%', padding: 10, color: 'rgba(255,255,255,0.75)' }}>
        <div style={{ fontWeight: 600 }}>Plugin Settings Error</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>{error}</div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
