import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { removeMagnetCatalogMagnet, upsertMagnetCatalogMagnet, useMagnetConfig } from '../../modules/magnets';
import { usePersistentSetting } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useKernel } from '../../contexts/KernelContext';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { useT } from '../../i18n';
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
  getPmpmTrustedKeysRevision,
  readPmpmTrustedKeyIds,
  subscribePmpmTrustedKeys,
  trustPmpmSigningKeyId,
  untrustPmpmSigningKeyId,
} from '../../magnet-system/plugins/pmpmTrust';
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
import { useConfirmDialog } from '../core/ConfirmDialog';

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
  if (event.type === 'audio-input-adapter-selected') {
    return `[audio-input:selected:${event.adapterKind}] ${event.adapterId} -> ${event.selectedInputId}`;
  }
  if (event.type === 'audio-input-adapter-fallback') {
    return `[audio-input:fallback] ${event.fromProviderId} -> ${event.toAdapterId} (${event.reason})`;
  }
  if (event.type === 'audio-input-adapter-session-closed') {
    return `[audio-input:closed:${event.adapterKind}] ${event.adapterId} ${event.reason ?? ''}`.trim();
  }
  if (event.type === 'audio-input-adapter-provider-quarantined') {
    return `[audio-input:quarantined] ${event.providerId} failures=${event.consecutiveFailures}`;
  }
  if (event.type === 'audio-input-adapter-provider-quarantine-cleared') {
    return `[audio-input:quarantine-cleared] ${event.providerId ?? 'all'} ${event.reason ?? ''}`.trim();
  }
  return '[event]';
}

export function PluginsSettingsPanel() {
  const kernel = useKernel();
  const t = useT();
  const governance = kernel.services.getOptional(GOVERNANCE_SERVICE_TOKEN);
  const { activeMagnetIds, magnetLibrary, setMagnetLibrary } = useMagnetConfig();
  const isTauri = isTauriRuntime();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowUnsignedPlugins, setAllowUnsignedPlugins] = usePersistentSetting(
    STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS,
    true
  );
  const [requireTrustedSignatures, setRequireTrustedSignatures] = usePersistentSetting(
    STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES,
    false
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

  const trustedKeysRevision = useSyncExternalStore(
    subscribePmpmTrustedKeys,
    getPmpmTrustedKeysRevision,
    getPmpmTrustedKeysRevision
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

  const trustedKeyIds = useMemo(() => {
    void trustedKeysRevision;
    return readPmpmTrustedKeyIds();
  }, [trustedKeysRevision]);

  const trustedKeySet = useMemo(() => new Set(trustedKeyIds), [trustedKeyIds]);

  const auditLog = useMemo(() => {
    void auditRevision;
    return readPmpmAuditLog();
  }, [auditRevision]);

  const sandboxEnabled = useMemo(() => {
    void sandboxRevision;
    return getPmpmSandboxRuntimeEnabled();
  }, [sandboxRevision]);

  const restartPmpmRuntime = useCallback(
    (pluginId: string, reason: string) => {
      governance?.restartPmpmPluginRuntime(pluginId, { reason });
    },
    [governance]
  );

  const handleInstall = useCallback(async () => {
    if (!isTauri) {
      setError(t('settings.plugins.install.requireTauri'));
      return;
    }
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [{ name: t('settings.plugins.install.filePickerFilter'), extensions: ['pmpm'] }],
      });
      if (!selected) return;
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof filePath !== 'string') {
        throw new Error(t('settings.plugins.install.error.invalidFilePath'));
      }

      const parsed = await parsePmpmPluginFromFilePath(filePath);
      const meta = parsed.manifest.metadata;
      const permissions = parsed.manifest.permissions ?? [];
      const isUpdate = installedPlugins.some((p) => p.manifest.metadata.id === meta.id);

      if (!isUpdate && magnetLibrary.some((m) => m.id === meta.id)) {
        throw new Error(t('settings.plugins.install.error.magnetIdExists', { id: meta.id }));
      }

      const signatureLine = (() => {
        if (parsed.signature) {
          const keyId = parsed.signature.keyId.slice(0, 12);
          return trustedKeySet.has(parsed.signature.keyId)
            ? t('settings.plugins.install.signature.okTrusted', { keyId })
            : t('settings.plugins.install.signature.okUntrusted', { keyId });
        }

        if (requireTrustedSignatures) {
          return t('settings.plugins.install.signature.requiredTrusted');
        }

        if (allowUnsignedPlugins) {
          return t('settings.plugins.install.signature.none');
        }

        return t('settings.plugins.install.signature.required');
      })();

      const confirmText = [
        t('settings.plugins.install.confirm.plugin', { name: meta.name }),
        t('settings.plugins.install.confirm.idVersion', { id: meta.id, version: meta.version }),
        meta.author ? t('settings.plugins.install.confirm.author', { author: meta.author }) : null,
        meta.description
          ? t('settings.plugins.install.confirm.description', { description: meta.description })
          : null,
        '',
        signatureLine,
        '',
        t('settings.plugins.install.confirm.permissionsTitle'),
        permissions.length > 0
          ? permissions.map((p) => `- ${p}`).join('\n')
          : t('settings.plugins.install.confirm.permissionsNone'),
        '',
        parsed.entrySha256
          ? t('settings.plugins.install.confirm.entrySha256', { sha256: parsed.entrySha256 })
          : null,
        '',
        t('settings.plugins.install.confirm.prompt'),
      ]
        .filter((line): line is string => typeof line === 'string')
        .join('\n');

      const ok = await confirm({
        title: t('settings.plugins.install.confirm.title'),
        message: confirmText,
        confirmText: t('common.action.install'),
        cancelText: t('common.action.cancel'),
      });
      if (!ok) return;

      await installPmpmPluginFromFilePath(filePath);

      const template = createMagnetTemplateFromPlugin(parsed);
      upsertMagnetCatalogMagnet(template);

      if (!magnetLibrary.some((m) => m.id === meta.id)) {
        setMagnetLibrary((prev) => [...prev, template]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    allowUnsignedPlugins,
    busy,
    confirm,
    installedPlugins,
    isTauri,
    magnetLibrary,
    requireTrustedSignatures,
    setMagnetLibrary,
    t,
    trustedKeySet,
  ]);

  const handleUninstall = useCallback(
    async (pluginId: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        if (activeMagnetIds.has(pluginId)) {
          throw new Error(t('settings.plugins.uninstall.error.activeMagnet', { id: pluginId }));
        }

        const ok = await confirm({
          title: t('settings.plugins.uninstall.confirm.title'),
          message: t('settings.plugins.uninstall.confirm.message', { id: pluginId }),
          confirmText: t('common.action.uninstall'),
          cancelText: t('common.action.cancel'),
          danger: true,
        });
        if (!ok) return;

        uninstallPmpmPlugin(pluginId);
        restartPmpmRuntime(pluginId, 'uninstall');
        clearPmpmAuditLog(pluginId);

        removeMagnetCatalogMagnet(pluginId);
        if (magnetLibrary.some((m) => m.id === pluginId)) {
          setMagnetLibrary((prev) => prev.filter((m) => m.id !== pluginId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, confirm, magnetLibrary, restartPmpmRuntime, setMagnetLibrary, t]
  );

  const handleToggleEnabled = useCallback(
    async (pluginId: string, enabled: boolean) => {
      if (busy) return;
      setBusy(true);
      setError(null);

      try {
        if (!enabled && activeMagnetIds.has(pluginId)) {
          const ok = await confirm({
            title: t('settings.plugins.disable.confirm.title'),
            message: t('settings.plugins.disable.confirm.message', { id: pluginId }),
            confirmText: t('common.action.disable'),
            cancelText: t('common.action.cancel'),
            danger: true,
          });
          if (!ok) return;
        }

        setPmpmPluginEnabled(pluginId, enabled);
        restartPmpmRuntime(pluginId, enabled ? 'enabled' : 'disabled');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [activeMagnetIds, busy, confirm, restartPmpmRuntime, t]
  );

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.plugins.pmpm.label')}</p>
          <p className="settings-card-desc">{t('settings.plugins.pmpm.desc')}</p>
        </div>

        <button type="button" className="settings-action-btn" onClick={() => void handleInstall()} disabled={busy}>
          {t('common.action.installEllipsis')}
        </button>
      </div>

      {error && <div className="settings-inline-error">{error}</div>}

      <div className="settings-plugin-switches settings-card-note">
        <label className="settings-plugin-switch-row">
          <input
            type="checkbox"
            checked={sandboxEnabled}
            onChange={(e) => setPmpmSandboxRuntimeEnabled(Boolean(e.target.checked))}
          />
          <span>{t('settings.plugins.runtimeSandbox.label')}</span>
        </label>
        <label className="settings-plugin-switch-row">
          <input
            type="checkbox"
            checked={requireTrustedSignatures}
            onChange={(e) => {
              const next = Boolean(e.target.checked);
              setRequireTrustedSignatures(next);
              if (next) setAllowUnsignedPlugins(false);
            }}
          />
          <span>{t('settings.plugins.requireTrustedSignatures.label')}</span>
        </label>
        <label className="settings-plugin-switch-row">
          <input
            type="checkbox"
            checked={allowUnsignedPlugins}
            disabled={requireTrustedSignatures}
            onChange={(e) => setAllowUnsignedPlugins(Boolean(e.target.checked))}
          />
          <span>{t('settings.plugins.allowUnsignedPlugins.label')}</span>
        </label>
      </div>

      <div className="settings-plugin-list">
        {installedPlugins.length === 0 ? (
          <div className="settings-card-note">{t('settings.plugins.empty')}</div>
        ) : (
          installedPlugins.map((plugin) => {
            const meta = plugin.manifest.metadata;
            const permissions = plugin.manifest.permissions ?? [];
            const deniedPermissions = plugin.deniedPermissions ?? [];
            const deniedSet = new Set(deniedPermissions);
            const isActive = activeMagnetIds.has(meta.id);
            const enabled = plugin.enabled ?? true;
            const signatureKeyId = plugin.signature?.keyId ?? null;
            const signatureTrusted = signatureKeyId ? trustedKeySet.has(signatureKeyId) : false;
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
                    <span className="settings-plugin-tag">
                      {enabled ? t('settings.plugins.tag.enabled') : t('settings.plugins.tag.disabled')}
                    </span>
                    <span className="settings-plugin-tag" title={signatureKeyId ?? undefined}>
                      {signatureKeyId
                        ? signatureTrusted
                          ? t('settings.plugins.tag.signedTrusted')
                          : t('settings.plugins.tag.signedUntrusted')
                        : t('settings.plugins.tag.unsigned')}
                    </span>
                    {panels > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.settingsPanelsCount', { count: panels })}
                      </span>
                    )}
                    {pages > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.pagesCount', { count: pages })}
                      </span>
                    )}
                    {windows > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.windowsCount', { count: windows })}
                      </span>
                    )}
                    {visualizers > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.visualizersCount', { count: visualizers })}
                      </span>
                    )}
                    {commands > 0 && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.tag.commandsCount', { count: commands })}
                      </span>
                    )}
                  </div>

                  <div className="settings-plugin-permissions">
                    <div>{t('settings.plugins.permissions.label')}</div>
                    {permissions.length === 0 ? (
                      <div className="settings-row-desc">{t('settings.plugins.permissions.none')}</div>
                    ) : (
                      <div className="settings-row-desc-list settings-row-meta">
                        {permissions.map((perm) => {
                          const allowed = !deniedSet.has(perm);
                          return (
                            <label key={perm} className="settings-plugin-permission-line">
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
                                  restartPmpmRuntime(meta.id, 'permissions-updated');
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
                    <details className="settings-plugin-details">
                      <summary className="settings-plugin-details-summary">
                        {t('settings.plugins.audit.summary', { count: pluginAudit.length })}
                      </summary>
                      <div className="settings-plugin-details-content">
                        {pluginAudit.map((event, idx) => (
                          <div key={idx}>{formatAuditEvent(event)}</div>
                        ))}
                      </div>
                      <div className="settings-plugin-details-actions">
                        <button
                          type="button"
                          className="settings-action-btn"
                          onClick={() => clearPmpmAuditLog(meta.id)}
                          disabled={busy}
                        >
                          {t('common.action.clear')}
                        </button>
                      </div>
                    </details>
                  )}
                </div>

                <div className="settings-plugin-actions">
                  <button
                    type="button"
                    className="settings-action-btn"
                    disabled={busy}
                    onClick={() => void handleToggleEnabled(meta.id, !enabled)}
                    title={
                      enabled
                        ? t('settings.plugins.action.disable.title')
                        : t('settings.plugins.action.enable.title')
                    }
                  >
                    {enabled ? t('common.action.disable') : t('common.action.enable')}
                  </button>

                  <button
                    type="button"
                    className="settings-action-btn"
                    disabled={busy}
                    onClick={() => restartPmpmRuntime(meta.id, 'manual')}
                    title={t('settings.plugins.action.restart.title')}
                  >
                    {t('common.action.restart')}
                  </button>

                  {signatureKeyId && (
                    <button
                      type="button"
                      className="settings-action-btn"
                      disabled={busy}
                      onClick={() => {
                        try {
                          if (signatureTrusted) {
                            untrustPmpmSigningKeyId(signatureKeyId);
                          } else {
                            trustPmpmSigningKeyId(signatureKeyId);
                            if (plugin.disabledReason === 'policy') {
                              setPmpmPluginEnabled(meta.id, true);
                            }
                          }
                          restartPmpmRuntime(
                            meta.id,
                            signatureTrusted ? 'key-untrusted' : 'key-trusted'
                          );
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      title={
                        signatureTrusted
                          ? t('settings.plugins.action.untrustKey.title')
                          : t('settings.plugins.action.trustKey.title')
                      }
                    >
                      {signatureTrusted
                        ? t('settings.plugins.action.untrustKey.label')
                        : t('settings.plugins.action.trustKey.label')}
                    </button>
                  )}

                  <button
                    type="button"
                    className="settings-danger-btn"
                    disabled={busy || isActive}
                    onClick={() => void handleUninstall(meta.id)}
                    title={
                      isActive
                        ? t('settings.plugins.action.uninstall.title.magnetActive')
                        : t('settings.plugins.action.uninstall.title')
                    }
                  >
                    {t('common.action.uninstall')}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
