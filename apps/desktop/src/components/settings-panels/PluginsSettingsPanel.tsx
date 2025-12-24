import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useMagnetConfig } from '../../modules/magnets';
import { usePersistentSetting } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useKernel } from '../../contexts/KernelContext';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import {
  createMagnetTemplateFromPlugin,
  getPmpmPluginsRevision,
  installPmpmPluginFromFilePath,
  loadInstalledPmpmPlugins,
  parsePmpmPluginFromFilePath,
  setPmpmPluginDeniedPermissions,
  setPmpmPluginEnabled,
  subscribePmpmPlugins,
  uninstallPmpmPlugin,
} from '../../magnet-system/plugins/pmpm';
import {
  clearPmpmAuditLog,
  getPmpmAuditRevision,
  readPmpmAuditLog,
  subscribePmpmAudit,
  type PmpmAuditEvent,
} from '../../magnet-system/plugins/pmpmGovernance';
import {
  getPmpmSandboxRevision,
  getPmpmSandboxRuntimeEnabled,
  setPmpmSandboxRuntimeEnabled,
  subscribePmpmSandbox,
} from '../../magnet-system/plugins/pmpmSandboxConfig';

function formatAuditEvent(event: PmpmAuditEvent): string {
  if (event.type === 'permission-denied') {
    return `[denied] ${event.hostLabel} ${event.capability} ${event.action}`;
  }
  if (event.type === 'crash') {
    return `[crash:${event.surface}] ${event.message}`;
  }
  if (event.type === 'runtime-unresponsive') {
    return `[hang:${event.surface}] timeout=${event.timeoutMs}ms`;
  }
  if (event.type === 'runtime-restart') {
    return `[restart] ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'enabled') {
    return '[enabled]';
  }
  if (event.type === 'disabled') {
    return `[disabled] ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'permissions-updated') {
    return `[permissions] denied=${event.deniedPermissions.join(',') || '(none)'}`;
  }
  return '[event]';
}

export function PluginsSettingsPanel() {
  const kernel = useKernel();
  const governance = kernel.services.get(GOVERNANCE_SERVICE_TOKEN);
  const { activeMagnetIds, magnetLibrary, setMagnetLibrary } = useMagnetConfig();
  const isTauri = isTauriRuntime();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowUnsignedPlugins, setAllowUnsignedPlugins] = usePersistentSetting(
    STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS,
    true
  );

  const pluginStoreRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );

  const auditRevision = useSyncExternalStore(
    subscribePmpmAudit,
    getPmpmAuditRevision,
    getPmpmAuditRevision
  );

  const sandboxRevision = useSyncExternalStore(
    subscribePmpmSandbox,
    getPmpmSandboxRevision,
    getPmpmSandboxRevision
  );

  const installedPlugins = useMemo(() => {
    void pluginStoreRevision;
    return loadInstalledPmpmPlugins();
  }, [pluginStoreRevision]);

  const auditLog = useMemo(() => {
    void auditRevision;
    return readPmpmAuditLog();
  }, [auditRevision]);

  const sandboxEnabled = useMemo(() => {
    void sandboxRevision;
    return getPmpmSandboxRuntimeEnabled();
  }, [sandboxRevision]);

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
        parsed.signature
          ? `Signature: OK (keyId=${parsed.signature.keyId.slice(0, 12)}…)`
          : allowUnsignedPlugins
            ? 'Signature: (none)'
            : 'Signature: required (unsigned not allowed)',
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
  }, [allowUnsignedPlugins, busy, installedPlugins, isTauri, magnetLibrary, setMagnetLibrary]);

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
        governance.restartPmpmPluginRuntime(pluginId, { reason: 'uninstall' });
        clearPmpmAuditLog(pluginId);

        if (magnetLibrary.some((m) => m.id === pluginId)) {
          setMagnetLibrary((prev) => prev.filter((m) => m.id !== pluginId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, governance, magnetLibrary, setMagnetLibrary]
  );

  const handleToggleEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        if (!enabled && activeMagnetIds.has(pluginId)) {
          const ok = window.confirm(
            `Magnet "${pluginId}" 当前处于激活状态，禁用后将显示为 Disabled 占位。确认禁用？`
          );
          if (!ok) return;
        }

        setPmpmPluginEnabled(pluginId, enabled);
        governance.restartPmpmPluginRuntime(pluginId, { reason: enabled ? 'enabled' : 'disabled' });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, governance]
  );

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">.pmpm 插件</p>
          <p className="settings-card-desc">
            安装/卸载 Magnet 插件，并查看它们声明的贡献点（R5：默认启用隔离运行时）。
          </p>
        </div>

        <button type="button" className="settings-action-btn" onClick={() => void handleInstall()} disabled={busy}>
          安装…
        </button>
      </div>

      {error && <div className="settings-inline-error">{error}</div>}

      <div className="settings-card-note" style={{ marginBottom: 10 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={sandboxEnabled}
            onChange={(e) => setPmpmSandboxRuntimeEnabled(Boolean(e.target.checked))}
          />
          <span>Enable isolated runtime (sandbox iframe, recommended)</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={allowUnsignedPlugins}
            onChange={(e) => setAllowUnsignedPlugins(Boolean(e.target.checked))}
          />
          <span>Allow unsigned .pmpm plugins (security)</span>
        </label>
      </div>

      <div className="settings-plugin-list">
        {installedPlugins.length === 0 ? (
          <div className="settings-card-note">暂无已安装插件</div>
        ) : (
          installedPlugins.map((plugin) => {
            const meta = plugin.manifest.metadata;
            const permissions = plugin.manifest.permissions ?? [];
            const deniedPermissions = plugin.deniedPermissions ?? [];
            const deniedSet = new Set(deniedPermissions);
            const isActive = activeMagnetIds.has(meta.id);
            const enabled = plugin.enabled ?? true;
            const panels = plugin.manifest.contributions?.settingsPanels?.length ?? 0;
            const pages = plugin.manifest.contributions?.pages?.length ?? 0;
            const windows = plugin.manifest.contributions?.windows?.length ?? 0;
            const visualizers = plugin.manifest.contributions?.visualizers?.length ?? 0;
            const commands = plugin.manifest.contributions?.commands?.length ?? 0;
            const pluginAudit = auditLog
              .filter((event) => event.pluginId === meta.id)
              .slice(-8)
              .reverse();

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
                    <span className="settings-plugin-tag" title={plugin.signature?.keyId ?? undefined}>
                      {plugin.signature ? 'signed' : 'unsigned'}
                    </span>
                    {panels > 0 && <span className="settings-plugin-tag">settings: {panels}</span>}
                    {pages > 0 && <span className="settings-plugin-tag">pages: {pages}</span>}
                    {windows > 0 && <span className="settings-plugin-tag">windows: {windows}</span>}
                    {visualizers > 0 && <span className="settings-plugin-tag">visualizers: {visualizers}</span>}
                    {commands > 0 && <span className="settings-plugin-tag">commands: {commands}</span>}
                  </div>

                  <div className="settings-plugin-permissions">
                    <div>权限：</div>
                    {permissions.length === 0 ? (
                      <div style={{ opacity: 0.8 }}>(无)</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                        {permissions.map((perm) => {
                          const allowed = !deniedSet.has(perm);
                          return (
                            <label
                              key={perm}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy ? 0.6 : 0.9,
                                fontSize: 12,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={allowed}
                                disabled={busy}
                                onChange={(e) => {
                                  const nextAllowed = Boolean(e.target.checked);
                                  const nextDenied = new Set(deniedPermissions);
                                  if (nextAllowed) nextDenied.delete(perm);
                                  else nextDenied.add(perm);
                                  setPmpmPluginDeniedPermissions(meta.id, Array.from(nextDenied));
                                  governance.restartPmpmPluginRuntime(meta.id, {
                                    reason: 'permissions-updated',
                                  });
                                }}
                              />
                              <span>{perm}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {plugin.lastError && (
                    <div className="settings-plugin-error" title={plugin.lastError}>
                      {plugin.lastError}
                    </div>
                  )}

                  {pluginAudit.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.85 }}>
                        Audit ({pluginAudit.length})
                      </summary>
                      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75, whiteSpace: 'pre-wrap' }}>
                        {pluginAudit.map((event, idx) => (
                          <div key={idx}>{formatAuditEvent(event)}</div>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="settings-action-btn"
                        style={{ marginTop: 6 }}
                        onClick={() => clearPmpmAuditLog(meta.id)}
                        disabled={busy}
                      >
                        Clear Audit
                      </button>
                    </details>
                  )}
                </div>

                <div className="settings-plugin-actions">
                  <button
                    type="button"
                    className="settings-action-btn"
                    disabled={busy}
                    onClick={() => void handleToggleEnabled(meta.id, !enabled)}
                    title={enabled ? '禁用该插件（会移除插件贡献点）' : '启用该插件'}
                  >
                    {enabled ? '禁用' : '启用'}
                  </button>

                  <button
                    type="button"
                    className="settings-action-btn"
                    disabled={busy}
                    onClick={() => governance.restartPmpmPluginRuntime(meta.id, { reason: 'manual' })}
                    title="Restart plugin runtime (best-effort)."
                  >
                    Restart
                  </button>

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
