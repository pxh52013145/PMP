import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { removeMagnetCatalogMagnet, upsertMagnetCatalogMagnet, useMagnetConfig } from '../../modules/magnets';
import { usePersistentSetting } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useKernel } from '../../contexts/KernelContext';
import { GOVERNANCE_SERVICE_TOKEN } from '../../services/governance';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import { useT } from '../../i18n';
import {
  createMagnetTemplateFromPlugin,
  getPmpmPluginsRevision,
  installPmpmPluginFromFilePath,
  listPmpmPermissionCapabilityBindings,
  loadInstalledPmpmExtensionRecords,
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
import {
  installStreamProtocolDemoPlugin,
  STREAM_PROTOCOL_DEMO_PLUGIN_ID,
  STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
} from '../../magnet-system/plugins/streamProtocolDemoPlugin';
import { resolveInstalledPmpmPluginRuntime } from '../../magnet-system/plugins/runtime';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { PmpButton, PmpCard, PmpCheckbox } from '../primitives';

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
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
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

  const installedExtensionRecords = useMemo(() => {
    void pluginStoreRevision;
    return loadInstalledPmpmExtensionRecords();
  }, [pluginStoreRevision]);

  const installedExtensionRecordById = useMemo(() => {
    return new Map(
      installedExtensionRecords.map((record) => [record.manifest.identity.id, record] as const)
    );
  }, [installedExtensionRecords]);

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

  const runtimeResolutionByPluginId = useMemo(() => {
    return new Map(
      installedPlugins.map((plugin) => [
        plugin.manifest.metadata.id,
        resolveInstalledPmpmPluginRuntime(plugin.manifest.metadata.id, {
          preferSandbox: sandboxEnabled,
        }),
      ] as const)
    );
  }, [installedPlugins, sandboxEnabled]);

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

  const handleInstallStreamDemo = useCallback(async () => {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const installed = await installStreamProtocolDemoPlugin();
      navigationService.navigateTo('plugin-visualizer', {
        pluginId: installed.pluginId,
        visualizerId: installed.visualizerId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, navigationService]);

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
    <PmpCard className="settings-card" surfaceId="primitive.card.settings">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.plugins.pmpm.label')}</p>
          <p className="settings-card-desc">{t('settings.plugins.pmpm.desc')}</p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <PmpButton
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleInstallStreamDemo()}
            disabled={busy}
            title={STREAM_PROTOCOL_DEMO_PLUGIN_ID}
          >
            {t('settings.plugins.demo.install')}
          </PmpButton>
          <PmpButton
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleInstall()}
            disabled={busy}
          >
            {t('common.action.installEllipsis')}
          </PmpButton>
        </div>
      </div>

      {error && <div className="settings-inline-error">{error}</div>}

      <div className="settings-plugin-switches settings-card-note">
        <PmpCheckbox
          className="settings-checkbox settings-plugin-switch-row"
          variant="settings"
          checked={sandboxEnabled}
          onCheckedChange={(next) => setPmpmSandboxRuntimeEnabled(next)}
        >
          {t('settings.plugins.runtimeSandbox.label')}
        </PmpCheckbox>
        <PmpCheckbox
          className="settings-checkbox settings-plugin-switch-row"
          variant="settings"
          checked={requireTrustedSignatures}
          onCheckedChange={(next) => {
              setRequireTrustedSignatures(next);
              if (next) setAllowUnsignedPlugins(false);
          }}
        >
          {t('settings.plugins.requireTrustedSignatures.label')}
        </PmpCheckbox>
        <PmpCheckbox
          className="settings-checkbox settings-plugin-switch-row"
          variant="settings"
          checked={allowUnsignedPlugins}
          disabled={requireTrustedSignatures}
          onCheckedChange={(next) => setAllowUnsignedPlugins(next)}
        >
          {t('settings.plugins.allowUnsignedPlugins.label')}
        </PmpCheckbox>
      </div>

      <div className="settings-plugin-list">
        {installedPlugins.length === 0 ? (
          <div className="settings-card-note">{t('settings.plugins.empty')}</div>
        ) : (
          installedPlugins.map((plugin) => {
            const meta = plugin.manifest.metadata;
            const permissions = plugin.manifest.permissions ?? [];
            const extensionRecord = installedExtensionRecordById.get(meta.id) ?? null;
            const runtimeResolution = runtimeResolutionByPluginId.get(meta.id) ?? null;
            const permissionCapabilityBindings = listPmpmPermissionCapabilityBindings(plugin);
            const capabilityIdByPermission = new Map(
              permissionCapabilityBindings.map((binding) => [binding.permission, binding.capabilityId] as const)
            );
            const deniedPermissions = plugin.deniedPermissions ?? [];
            const deniedSet = new Set(deniedPermissions);
            const isActive = activeMagnetIds.has(meta.id);
            const enabled = plugin.enabled ?? true;
            const signatureKeyId = plugin.signature?.keyId ?? null;
            const signatureTrusted = signatureKeyId ? trustedKeySet.has(signatureKeyId) : false;
            const extensionProjectionTitle = extensionRecord
              ? [
                  ...extensionRecord.manifest.hostTargets.map((target) => target.hostId),
                  ...extensionRecord.manifest.runtimes.map((runtime) => runtime.runtimeId),
                  ...(extensionRecord.manifest.compat?.map((entry) => entry.compatLayerId) ?? []),
                ].join('\n')
              : undefined;
            const runtimeProjectionTitle = (() => {
              if (!runtimeResolution) {
                return t('settings.plugins.tag.runtimeMissing');
              }
              if (runtimeResolution.status === 'resolved') {
                return [
                  t('settings.plugins.tag.runtimeResolved', {
                    runtimeId: runtimeResolution.runtime.runtimeId,
                  }),
                  t('settings.plugins.tag.launcher', {
                    launcherId: runtimeResolution.launcher.id,
                  }),
                  t('settings.plugins.tag.transport', {
                    transport: runtimeResolution.launcher.transport,
                  }),
                  ...runtimeResolution.issues.map((issue) =>
                    t('settings.plugins.runtime.issue', { issue })
                  ),
                ].join('\n');
              }
              return [
                t('settings.plugins.tag.runtimeBlocked'),
                runtimeResolution.candidateLaunchers.length > 0
                  ? t('settings.plugins.runtime.candidates', {
                      launchers: runtimeResolution.candidateLaunchers
                        .map((launcher) => launcher.id)
                        .join(', '),
                    })
                  : null,
                ...runtimeResolution.issues.map((issue) =>
                  t('settings.plugins.runtime.issue', { issue })
                ),
              ]
                .filter((line): line is string => typeof line === 'string' && line.length > 0)
                .join('\n');
            })();
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
                    <span
                      className="settings-plugin-subtitle"
                      title={extensionProjectionTitle}
                    >
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
                    {runtimeResolution?.status === 'resolved' ? (
                      <>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {t('settings.plugins.tag.runtimeResolved', {
                            runtimeId: runtimeResolution.runtime.runtimeId,
                          })}
                        </span>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {t('settings.plugins.tag.launcher', {
                            launcherId: runtimeResolution.launcher.id,
                          })}
                        </span>
                        <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                          {t('settings.plugins.tag.transport', {
                            transport: runtimeResolution.launcher.transport,
                          })}
                        </span>
                      </>
                    ) : (
                      <span className="settings-plugin-tag" title={runtimeProjectionTitle}>
                        {runtimeResolution
                          ? t('settings.plugins.tag.runtimeBlocked')
                          : t('settings.plugins.tag.runtimeMissing')}
                      </span>
                    )}
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
                    {meta.id === STREAM_PROTOCOL_DEMO_PLUGIN_ID && (
                      <span className="settings-plugin-tag">
                        {t('settings.plugins.demo.tag')}
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
                            <PmpCheckbox
                              key={perm}
                              className="settings-checkbox settings-plugin-permission-line"
                              variant="settings"
                              checked={allowed}
                              disabled={busy}
                              onCheckedChange={(nextAllowed) => {
                                  const nextDenied = new Set(deniedPermissions);
                                  if (nextAllowed) nextDenied.delete(perm);
                                  else nextDenied.add(perm);
                                  setPmpmPluginDeniedPermissions(meta.id, Array.from(nextDenied));
                                  restartPmpmRuntime(meta.id, 'permissions-updated');
                              }}
                            >
                              <span title={capabilityIdByPermission.get(perm) ?? undefined}>
                                {perm}
                              </span>
                            </PmpCheckbox>
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
                        <PmpButton
                          type="button"
                          className="settings-action-btn"
                          variant="default"
                          onClick={() => clearPmpmAuditLog(meta.id)}
                          disabled={busy}
                        >
                          {t('common.action.clear')}
                        </PmpButton>
                      </div>
                    </details>
                  )}
                </div>

                <div className="settings-plugin-actions">
                  {meta.id === STREAM_PROTOCOL_DEMO_PLUGIN_ID && (
                    <PmpButton
                      type="button"
                      className="settings-action-btn"
                      variant="default"
                      disabled={busy}
                      onClick={() =>
                        navigationService.navigateTo('plugin-visualizer', {
                          pluginId: STREAM_PROTOCOL_DEMO_PLUGIN_ID,
                          visualizerId: STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
                        })
                      }
                    >
                      {t('common.action.open')}
                    </PmpButton>
                  )}
                  <PmpButton
                    type="button"
                    className="settings-action-btn"
                    variant="default"
                    disabled={busy}
                    onClick={() => void handleToggleEnabled(meta.id, !enabled)}
                    title={
                      enabled
                        ? t('settings.plugins.action.disable.title')
                        : t('settings.plugins.action.enable.title')
                    }
                  >
                    {enabled ? t('common.action.disable') : t('common.action.enable')}
                  </PmpButton>

                  <PmpButton
                    type="button"
                    className="settings-action-btn"
                    variant="default"
                    disabled={busy}
                    onClick={() => restartPmpmRuntime(meta.id, 'manual')}
                    title={t('settings.plugins.action.restart.title')}
                  >
                    {t('common.action.restart')}
                  </PmpButton>

                  {signatureKeyId && (
                    <PmpButton
                      type="button"
                      className="settings-action-btn"
                      variant="default"
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
                    </PmpButton>
                  )}

                  <PmpButton
                    type="button"
                    className="settings-danger-btn"
                    variant="danger"
                    disabled={busy || isActive}
                    onClick={() => void handleUninstall(meta.id)}
                    title={
                      isActive
                        ? t('settings.plugins.action.uninstall.title.magnetActive')
                        : t('settings.plugins.action.uninstall.title')
                    }
                  >
                    {t('common.action.uninstall')}
                  </PmpButton>
                </div>
              </div>
            );
          })
        )}
      </div>
      {confirmDialog}
    </PmpCard>
  );
}
