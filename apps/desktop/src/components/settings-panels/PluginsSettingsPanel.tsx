import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useMagnetConfig } from '../../modules/magnets';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  createMagnetTemplateFromPlugin,
  getPmpmPluginsRevision,
  installPmpmPluginFromFilePath,
  loadInstalledPmpmPlugins,
  parsePmpmPluginFromFilePath,
  subscribePmpmPlugins,
  uninstallPmpmPlugin,
} from '../../magnet-system/plugins/pmpm';

export function PluginsSettingsPanel() {
  const { activeMagnetIds, magnetLibrary, setMagnetLibrary } = useMagnetConfig();
  const isTauri = isTauriRuntime();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const installedPlugins = useMemo(() => {
    void pluginStoreRevision;
    return loadInstalledPmpmPlugins();
  }, [pluginStoreRevision]);

  const handleInstall = useCallback(async () => {
    if (!isTauri) {
      setError('安装 .pmpm 需要 Tauri 运行时（使用 `pnpm dev:tauri`）。');
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: '.pmpm plugin', extensions: ['pmpm'] }],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error('无法解析选中的 .pmpm 文件路径');
      }

      const parsed = await parsePmpmPluginFromFilePath(filePath);
      const meta = parsed.manifest.metadata;
      const permissions = parsed.manifest.permissions ?? [];
      const isUpdate = installedPlugins.some((p) => p.manifest.metadata.id === meta.id);

      if (!isUpdate && magnetLibrary.some((m) => m.id === meta.id)) {
        throw new Error(`Magnet ID "${meta.id}" 已存在，无法安装同名插件（请先删除/重命名该 Magnet）`);
      }

      const confirmText = [
        `安装 .pmpm 插件：${meta.name}`,
        `${meta.id}@${meta.version}`,
        meta.author ? `作者：${meta.author}` : null,
        meta.description ? `说明：${meta.description}` : null,
        '',
        '权限声明：',
        permissions.length > 0 ? permissions.map((p) => `- ${p}`).join('\n') : '(无)',
        '',
        parsed.entrySha256 ? `entrySha256: ${parsed.entrySha256}` : null,
        '',
        '确认安装？',
      ]
        .filter((line): line is string => typeof line === 'string' && line.length > 0)
        .join('\n');

      if (!window.confirm(confirmText)) return;

      await installPmpmPluginFromFilePath(filePath);

      if (!magnetLibrary.some((m) => m.id === meta.id)) {
        setMagnetLibrary((prev) => [...prev, createMagnetTemplateFromPlugin(parsed)]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, installedPlugins, isTauri, magnetLibrary, setMagnetLibrary]);

  const handleUninstall = useCallback(
    async (pluginId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        if (activeMagnetIds.has(pluginId)) {
          throw new Error(`请先停用 Magnet "${pluginId}"，再卸载插件。`);
        }

        if (!window.confirm(`确认卸载插件 "${pluginId}"？`)) return;

        uninstallPmpmPlugin(pluginId);

        if (magnetLibrary.some((m) => m.id === pluginId)) {
          setMagnetLibrary((prev) => prev.filter((m) => m.id !== pluginId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, magnetLibrary, setMagnetLibrary]
  );

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">.pmpm 插件</p>
          <p className="settings-card-desc">安装/卸载 Magnet 插件，并查看它们声明的贡献点。</p>
        </div>

        <button type="button" className="settings-action-btn" onClick={() => void handleInstall()} disabled={busy}>
          安装…
        </button>
      </div>

      {error && <div className="settings-inline-error">{error}</div>}

      <div className="settings-plugin-list">
        {installedPlugins.length === 0 ? (
          <div className="settings-card-note">暂无已安装插件</div>
        ) : (
          installedPlugins.map((plugin) => {
            const meta = plugin.manifest.metadata;
            const permissions = plugin.manifest.permissions ?? [];
            const isActive = activeMagnetIds.has(meta.id);
            const enabled = plugin.enabled ?? true;
            const panels = plugin.manifest.contributions?.settingsPanels?.length ?? 0;
            const pages = plugin.manifest.contributions?.pages?.length ?? 0;
            const windows = plugin.manifest.contributions?.windows?.length ?? 0;
            const visualizers = plugin.manifest.contributions?.visualizers?.length ?? 0;
            const commands = plugin.manifest.contributions?.commands?.length ?? 0;

            return (
              <div key={meta.id} className="settings-plugin-item">
                <div className="settings-plugin-meta">
                  <div className="settings-plugin-title">
                    {meta.name}{' '}
                    <span className="settings-plugin-subtitle">
                      ({meta.id}@{meta.version})
                    </span>
                  </div>

                  {meta.description && <div className="settings-plugin-desc">{meta.description}</div>}

                  <div className="settings-plugin-tags">
                    <span className="settings-plugin-tag">{enabled ? 'enabled' : 'disabled'}</span>
                    {panels > 0 && <span className="settings-plugin-tag">settings: {panels}</span>}
                    {pages > 0 && <span className="settings-plugin-tag">pages: {pages}</span>}
                    {windows > 0 && <span className="settings-plugin-tag">windows: {windows}</span>}
                    {visualizers > 0 && <span className="settings-plugin-tag">visualizers: {visualizers}</span>}
                    {commands > 0 && <span className="settings-plugin-tag">commands: {commands}</span>}
                  </div>

                  <div className="settings-plugin-permissions">
                    权限：{permissions.length > 0 ? permissions.join(', ') : '(无)'}
                  </div>

                  {plugin.lastError && (
                    <div className="settings-plugin-error" title={plugin.lastError}>
                      {plugin.lastError}
                    </div>
                  )}
                </div>

                <div className="settings-plugin-actions">
                  <button
                    type="button"
                    className="settings-danger-btn"
                    disabled={busy || isActive}
                    onClick={() => void handleUninstall(meta.id)}
                    title={isActive ? '请先从点阵停用该 Magnet' : '卸载插件'}
                  >
                    卸载
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
