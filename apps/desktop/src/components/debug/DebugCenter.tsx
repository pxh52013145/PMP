import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { usePersistentSetting } from '../../modules/storage';
import {
  getDebugConfig,
  getDebugEnvSnapshot,
  getDefaultDebugConfig,
  getProcessPerfSnapshot,
  restartApp,
  setDebugConfig,
  type DebugConfig,
  type DebugEnvSnapshot,
  type ProcessPerfSnapshot,
  type VstSidechainModeOverride,
} from '../../modules/debug';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { calculateWindowPosition, openEditorWindow } from '../../utils/editorWindows';
import { openVstManagerWindow } from '../../utils/vstManagerWindows';
import { MusicLibraryService } from '../../services/audio/MusicLibraryService';
import { ConfirmDialog } from '../magnet/ConfirmDialog';

const WINDOW_COMM_DEBUG_KEY = 'pixel-matrix-debug-window-comm';

type TriBool = boolean | null;

type EditorWindowsDebugState = {
  windows: Array<{ windowType: string; exists: boolean; visible: boolean }>;
  cachedHidden?: string | null;
};

type CoverCacheStats = ReturnType<MusicLibraryService['getCoverRuntimeCacheStats']>;

function formatTriBool(value: TriBool): 'auto' | 'on' | 'off' {
  if (value === null) return 'auto';
  return value ? 'on' : 'off';
}

function formatBytesMb(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatCpuPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

function normalizeTriBool(mode: 'auto' | 'on' | 'off'): TriBool {
  if (mode === 'auto') return null;
  return mode === 'on';
}

function normalizeSidechainMode(
  value: 'auto' | VstSidechainModeOverride
): VstSidechainModeOverride | null {
  return value === 'auto' ? null : value;
}

function buildPowerShellSnippet(config: DebugConfig): string {
  const lines: string[] = [];

  if (config.vstBridge.stderr || config.vstBridge.logEditor) {
    lines.push('$env:PMP_VST_BRIDGE_STDERR="1"');
  }
  if (config.vstBridge.logEditor) {
    lines.push('$env:PMP_VST_BRIDGE_LOG_EDITOR="1"');
  }
  if (config.vstBridge.editorSafeMode !== null) {
    lines.push(`$env:PMP_VST_EDITOR_SAFE_MODE="${config.vstBridge.editorSafeMode ? '1' : '0'}"`);
  }
  if (config.vstBridge.sidechainMode) {
    lines.push(`$env:PMP_VST_SIDECHAIN_MODE="${config.vstBridge.sidechainMode}"`);
  }
  if (config.vstBridge.minidump) {
    lines.push('$env:PMP_VST_BRIDGE_MINIDUMP="1"');
  }
  if (config.vstBridge.minidumpDir) {
    lines.push(`$env:PMP_VST_BRIDGE_MINIDUMP_DIR="${config.vstBridge.minidumpDir}"`);
  }

  lines.push('pnpm --filter @pixel-matrix/desktop dev');
  return lines.join('\n');
}

export function DebugCenter({ variant = 'page' }: { variant?: 'page' | 'settings' }) {
  const t = useT();
  const { navigateTo, history } = useNavigation();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [config, setConfigState] = useState<DebugConfig>(() => getDefaultDebugConfig());
  const [envSnapshot, setEnvSnapshot] = useState<DebugEnvSnapshot>({});
  const [editorWindowsState, setEditorWindowsState] = useState<EditorWindowsDebugState | null>(null);
  const [coverCacheStats, setCoverCacheStats] = useState<CoverCacheStats | null>(null);
  const [processPerf, setProcessPerf] = useState<ProcessPerfSnapshot | null>(null);
  const [processPerfError, setProcessPerfError] = useState<string | null>(null);
  const [processPerfAutoRefresh, setProcessPerfAutoRefresh] = useState(false);
  const [processPerfBusy, setProcessPerfBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmRestartIntoDebug, setConfirmRestartIntoDebug] = useState(false);
  const [confirmDestroyEditorWindows, setConfirmDestroyEditorWindows] = useState(false);
  const [confirmClearCoverCaches, setConfirmClearCoverCaches] = useState(false);
  const [minidumpDirDraft, setMinidumpDirDraft] = useState('');
  const processPerfBusyRef = useRef(false);

  const [windowCommDebug, setWindowCommDebug] = usePersistentSetting<string>(
    WINDOW_COMM_DEBUG_KEY,
    '0',
    { format: 'string' }
  );
  const windowCommDebugEnabled = windowCommDebug === '1';

  const navigationHistoryStats = useMemo(() => {
    let bytes = 0;
    try {
      const serialized = JSON.stringify(history);
      bytes =
        typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(serialized).length
          : serialized.length * 2;
    } catch {
      // ignore
    }
    return { count: history.length, bytes };
  }, [history]);

  const refreshMemory = useCallback(async () => {
    const coverStats = MusicLibraryService.getInstance().getCoverRuntimeCacheStats();
    setCoverCacheStats(coverStats);

    if (!isTauri) {
      setEditorWindowsState(null);
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const state = await invoke<EditorWindowsDebugState>('debug_get_editor_windows_state');
      setEditorWindowsState(state);
    } catch {
      setEditorWindowsState(null);
    }
  }, [isTauri]);

  const refreshProcessPerf = useCallback(async () => {
    if (!isTauri) {
      setProcessPerf(null);
      return;
    }

    if (processPerfBusyRef.current) return;
    processPerfBusyRef.current = true;

    setProcessPerfBusy(true);
    setProcessPerfError(null);
    try {
      const snapshot = await getProcessPerfSnapshot();
      setProcessPerf(snapshot);
      if (!snapshot) {
        setProcessPerfError(t('debug.center.memory.processPerf.error.unavailable'));
      }
    } catch (err) {
      setProcessPerf(null);
      setProcessPerfError(err instanceof Error ? err.message : String(err));
    } finally {
      processPerfBusyRef.current = false;
      setProcessPerfBusy(false);
    }
  }, [isTauri, t]);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    const [nextConfig, snapshot] = await Promise.all([getDebugConfig(), getDebugEnvSnapshot()]);
    setConfigState(nextConfig);
    setEnvSnapshot(snapshot);
    setMinidumpDirDraft(nextConfig.vstBridge.minidumpDir ?? '');
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;
    setBusy(true);
    void Promise.all([getDebugConfig(), getDebugEnvSnapshot()])
      .then(([nextConfig, snapshot]) => {
        if (cancelled) return;
        setConfigState(nextConfig);
        setEnvSnapshot(snapshot);
        setMinidumpDirDraft(nextConfig.vstBridge.minidumpDir ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isTauri]);

  useEffect(() => {
    void refreshMemory();
  }, [refreshMemory]);

  useEffect(() => {
    void refreshProcessPerf();
  }, [refreshProcessPerf]);

  useEffect(() => {
    if (!isTauri) return;
    if (!processPerfAutoRefresh) return;

    const interval = window.setInterval(() => {
      void refreshProcessPerf();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isTauri, processPerfAutoRefresh, refreshProcessPerf]);

  const persist = useCallback(
    async (next: DebugConfig) => {
      if (!isTauri) return;
      setBusy(true);
      setError(null);
      try {
        await setDebugConfig(next);
        setPendingRestart(true);
        const snapshot = await getDebugEnvSnapshot().catch(() => ({}));
        setEnvSnapshot(snapshot);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [isTauri]
  );

  const updateConfig = useCallback(
    (updater: (prev: DebugConfig) => DebugConfig) => {
      setConfigState((prev) => {
        const next = updater(prev);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const handlePickMinidumpDir = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { open } = await import('@tauri-apps/api/dialog');
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected !== 'string') return;
      const trimmed = selected.trim();
      setMinidumpDirDraft(trimmed);
      updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidumpDir: trimmed || null } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, updateConfig]);

  const handleMinidumpDirBlur = useCallback(() => {
    const trimmed = minidumpDirDraft.trim();
    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidumpDir: trimmed || null } }));
  }, [minidumpDirDraft, updateConfig]);

  const handleCopyPowerShell = useCallback(() => {
    const snippet = buildPowerShellSnippet(config);
    void navigator.clipboard.writeText(snippet).catch(() => {});
  }, [config]);

  const handleOpenThemeDebugWindow = useCallback(async () => {
    try {
      const position = await calculateWindowPosition('debug');
      await openEditorWindow({ type: 'debug', ...position });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleOpenVstManager = useCallback(async () => {
    try {
      await openVstManagerWindow({ title: t('windows.vst-manager.title') });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [t]);

  const requestRestart = useCallback(
    async (mode: 'normal' | 'debug-center') => {
      if (!isTauri) return;

      const next: DebugConfig =
        mode === 'debug-center'
          ? { ...config, enabled: true, openDebugCenterOnNextStart: true }
          : config;

      try {
        await setDebugConfig(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      await restartApp();
    },
    [config, isTauri]
  );

  const headerActions = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <button type="button" className="settings-action-btn" onClick={() => setConfirmRestart(true)} disabled={!isTauri}>
        {t('debug.center.actions.restart')}
      </button>
      <button
        type="button"
        className="settings-action-btn"
        onClick={() => setConfirmRestartIntoDebug(true)}
        disabled={!isTauri}
      >
        {t('debug.center.actions.restartAndOpen')}
      </button>
    </div>
  );

  const header =
    variant === 'page' ? (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{t('pages.debug-center.title')}</h1>
          <p style={{ fontSize: 12, opacity: 0.72, margin: '6px 0 0' }}>{t('pages.debug-center.subtitle')}</p>
        </div>
        {headerActions}
      </div>
    ) : (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>{headerActions}</div>
    );

  return (
    <div style={{ width: '100%', height: '100%', padding: variant === 'page' ? 16 : 0 }}>
      {header}

      {!isTauri ? (
        <div className="settings-card-note" style={{ marginTop: variant === 'page' ? 16 : 0 }}>
          {t('debug.center.note.requireTauri')}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: variant === 'page' ? 16 : 0 }}>
        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.mode.label')}</p>
              <p className="settings-card-desc">{t('debug.center.mode.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {config.enabled ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>

          <div className="settings-toggle">
            <button type="button" data-active={!config.enabled} onClick={() => updateConfig((prev) => ({ ...prev, enabled: false }))}>
              {t('common.state.off')}
            </button>
            <button type="button" data-active={config.enabled} onClick={() => updateConfig((prev) => ({ ...prev, enabled: true }))}>
              {t('common.state.on')}
            </button>
          </div>

          {pendingRestart ? <p className="settings-card-note">{t('debug.center.mode.note.restartRequired')}</p> : null}
          {busy ? <p className="settings-card-note">{t('debug.center.mode.note.saving')}</p> : null}
          {error ? <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.9)' }}>{error}</p> : null}
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.vstBridge.title')}</p>
              <p className="settings-card-desc">{t('debug.center.vstBridge.desc')}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="settings-action-btn" onClick={() => void refresh()} disabled={!isTauri}>
                {t('debug.center.actions.refreshEnv')}
              </button>
              <button type="button" className="settings-action-btn" onClick={handleCopyPowerShell}>
                {t('debug.center.actions.copyPowershell')}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <p className="settings-card-label">{t('debug.center.vstBridge.stderr.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.vstBridge.stderr.desc')}</p>
                </div>
                <span className="settings-card-badge">
                  {config.vstBridge.stderr ? t('common.state.on') : t('common.state.off')}
                </span>
              </div>
              <div className="settings-toggle">
                <button
                  type="button"
                  data-active={!config.vstBridge.stderr}
                  onClick={() => updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, stderr: false } }))}
                >
                  {t('common.state.off')}
                </button>
                <button
                  type="button"
                  data-active={config.vstBridge.stderr}
                  onClick={() => updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, stderr: true } }))}
                >
                  {t('common.state.on')}
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <p className="settings-card-label">{t('debug.center.vstBridge.logEditor.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.vstBridge.logEditor.desc')}</p>
                </div>
                <span className="settings-card-badge">
                  {config.vstBridge.logEditor ? t('common.state.on') : t('common.state.off')}
                </span>
              </div>
              <div className="settings-toggle">
                <button
                  type="button"
                  data-active={!config.vstBridge.logEditor}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, logEditor: false } }))
                  }
                >
                  {t('common.state.off')}
                </button>
                <button
                  type="button"
                  data-active={config.vstBridge.logEditor}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, logEditor: true } }))
                  }
                >
                  {t('common.state.on')}
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <p className="settings-card-label">{t('debug.center.vstBridge.minidump.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.vstBridge.minidump.desc')}</p>
                </div>
                <span className="settings-card-badge">
                  {config.vstBridge.minidump ? t('common.state.on') : t('common.state.off')}
                </span>
              </div>
              <div className="settings-toggle">
                <button
                  type="button"
                  data-active={!config.vstBridge.minidump}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidump: false } }))
                  }
                >
                  {t('common.state.off')}
                </button>
                <button
                  type="button"
                  data-active={config.vstBridge.minidump}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidump: true } }))
                  }
                >
                  {t('common.state.on')}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={minidumpDirDraft}
                  onChange={(e) => setMinidumpDirDraft(e.target.value)}
                  onBlur={handleMinidumpDirBlur}
                  placeholder={t('debug.center.vstBridge.minidumpDir.placeholder')}
                  style={{
                    flex: 1,
                    minWidth: 220,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.2)',
                    color: 'rgba(255,255,255,0.92)',
                    outline: 'none',
                  }}
                  disabled={!isTauri}
                />
                <button type="button" className="settings-action-btn" onClick={() => void handlePickMinidumpDir()}>
                  {t('debug.center.vstBridge.minidumpDir.pick')}
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <p className="settings-card-label">{t('debug.center.vstBridge.editorSafeMode.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.vstBridge.editorSafeMode.desc')}</p>
                </div>
                <span className="settings-card-badge">
                  {t(`debug.center.vstBridge.editorSafeMode.badge.${formatTriBool(config.vstBridge.editorSafeMode)}`)}
                </span>
              </div>

              <div className="settings-toggle">
                {(['auto', 'on', 'off'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-active={formatTriBool(config.vstBridge.editorSafeMode) === mode}
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        vstBridge: { ...prev.vstBridge, editorSafeMode: normalizeTriBool(mode) },
                      }))
                    }
                  >
                    {t(`debug.center.vstBridge.editorSafeMode.option.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <p className="settings-card-label">{t('debug.center.vstBridge.sidechainMode.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.vstBridge.sidechainMode.desc')}</p>
                </div>
                <span className="settings-card-badge">
                  {t(`debug.center.vstBridge.sidechainMode.badge.${config.vstBridge.sidechainMode ?? 'auto'}`)}
                </span>
              </div>

              <div className="settings-toggle">
                {(['auto', 'disabled', 'silence', 'self'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-active={(config.vstBridge.sidechainMode ?? 'auto') === mode}
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        vstBridge: { ...prev.vstBridge, sidechainMode: normalizeSidechainMode(mode) },
                      }))
                    }
                  >
                    {t(`debug.center.vstBridge.sidechainMode.option.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="settings-card-label">{t('debug.center.env.title')}</p>
              <p className="settings-card-desc">{t('debug.center.env.desc')}</p>
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  overflowX: 'auto',
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.88)',
                }}
              >
                {Object.keys(envSnapshot).length === 0
                  ? t('debug.center.env.empty')
                  : Object.entries(envSnapshot)
                      .map(([key, value]) => `${key}=${value ?? ''}`)
                      .join('\n')}
              </pre>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.windowComm.title')}</p>
              <p className="settings-card-desc">{t('debug.center.windowComm.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {windowCommDebugEnabled ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>
          <div className="settings-toggle">
            <button type="button" data-active={!windowCommDebugEnabled} onClick={() => setWindowCommDebug('0')}>
              {t('common.state.off')}
            </button>
            <button type="button" data-active={windowCommDebugEnabled} onClick={() => setWindowCommDebug('1')}>
              {t('common.state.on')}
            </button>
          </div>
          <p className="settings-card-note">{t('debug.center.windowComm.note')}</p>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.memory.title')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.desc')}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => {
                  void refreshMemory();
                  void refreshProcessPerf();
                }}
              >
                {t('common.action.refresh')}
              </button>
              <button type="button" className="settings-action-btn" onClick={() => setConfirmClearCoverCaches(true)}>
                {t('debug.center.memory.actions.clearCoverCaches')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => setConfirmDestroyEditorWindows(true)}
                disabled={!isTauri}
              >
                {t('debug.center.memory.actions.destroyEditorWindows')}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <p className="settings-card-label">{t('debug.center.memory.editorWindows.label')}</p>
              <p className="settings-card-desc">
                {t('debug.center.memory.editorWindows.stats', {
                  alive: editorWindowsState?.windows.filter((w) => w.exists).length ?? 0,
                  visible:
                    editorWindowsState?.windows.filter((w) => w.exists && w.visible).length ?? 0,
                  hidden:
                    (editorWindowsState?.windows.filter((w) => w.exists).length ?? 0) -
                    (editorWindowsState?.windows.filter((w) => w.exists && w.visible).length ?? 0),
                })}
              </p>
              <p className="settings-card-note">
                {t('debug.center.memory.editorWindows.cachedHidden', {
                  type: editorWindowsState?.cachedHidden ?? '-',
                })}
              </p>
            </div>

            <div>
              <p className="settings-card-label">{t('debug.center.memory.coverCaches.label')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p className="settings-card-desc">
                  {t('debug.center.memory.coverCaches.blobUrls.value', {
                    count: coverCacheStats?.coverBlobUrlCacheEntries ?? 0,
                    mb: ((coverCacheStats?.coverBlobUrlTotalBytes ?? 0) / 1024 / 1024).toFixed(1),
                  })}
                </p>
                <p className="settings-card-desc">
                  {t('debug.center.memory.coverCaches.urls.value', {
                    count: coverCacheStats?.coverUrlCacheEntries ?? 0,
                  })}
                </p>
                <p className="settings-card-desc">
                  {t('debug.center.memory.coverCaches.inflight.value', {
                    count: coverCacheStats?.coverUrlInflight ?? 0,
                  })}
                </p>
                <p className="settings-card-desc">
                  {t('debug.center.memory.coverCaches.album.value', {
                    count: coverCacheStats?.albumCoverUrlCacheEntries ?? 0,
                  })}
                </p>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 260px', minWidth: 240 }}>
                  <p className="settings-card-label">{t('debug.center.memory.processPerf.label')}</p>
                  <p className="settings-card-desc">{t('debug.center.memory.processPerf.desc')}</p>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="settings-action-btn"
                    onClick={() => void refreshProcessPerf()}
                    disabled={!isTauri || processPerfBusy}
                  >
                    {t('common.action.refresh')}
                  </button>
                </div>
              </div>

              <div className="settings-toggle" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  data-active={!processPerfAutoRefresh}
                  onClick={() => setProcessPerfAutoRefresh(false)}
                >
                  {t('common.state.off')}
                </button>
                <button
                  type="button"
                  data-active={processPerfAutoRefresh}
                  onClick={() => setProcessPerfAutoRefresh(true)}
                >
                  {t('common.state.on')}
                </button>
              </div>
              <p className="settings-card-note">{t('debug.center.memory.processPerf.autoRefresh.note')}</p>

              {processPerfError ? (
                <p className="settings-card-note" style={{ color: 'rgba(255, 140, 140, 0.92)' }}>
                  {processPerfError}
                </p>
              ) : null}

              {processPerf ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  <p className="settings-card-note">
                    {t('debug.center.memory.processPerf.sample', {
                      intervalSec: processPerf.sampleIntervalMs
                        ? (processPerf.sampleIntervalMs / 1000).toFixed(2)
                        : '-',
                      cpuCount: processPerf.cpuCount,
                    })}
                  </p>
                  {processPerf.systemMemory ? (
                    <p className="settings-card-note">
                      {t('debug.center.memory.processPerf.systemMemory', {
                        load: processPerf.systemMemory.memoryLoadPercent,
                        total: formatBytesMb(processPerf.systemMemory.totalPhysicalBytes),
                        avail: formatBytesMb(processPerf.systemMemory.availablePhysicalBytes),
                      })}
                    </p>
                  ) : null}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p className="settings-card-desc">
                      {t('debug.center.memory.processPerf.totals.all', {
                        ws: formatBytesMb(processPerf.totals.workingSetBytes),
                        private: formatBytesMb(processPerf.totals.privateBytes),
                        cpu: formatCpuPercent(processPerf.totals.cpuPercent),
                      })}
                    </p>
                    <p className="settings-card-desc">
                      {t('debug.center.memory.processPerf.totals.app', {
                        ws: formatBytesMb(processPerf.totals.appWorkingSetBytes),
                        private: formatBytesMb(processPerf.totals.appPrivateBytes),
                        cpu: formatCpuPercent(processPerf.totals.appCpuPercent),
                      })}
                    </p>
                    <p className="settings-card-desc">
                      {t('debug.center.memory.processPerf.totals.webview2', {
                        ws: formatBytesMb(processPerf.totals.webview2WorkingSetBytes),
                        private: formatBytesMb(processPerf.totals.webview2PrivateBytes),
                        cpu: formatCpuPercent(processPerf.totals.webview2CpuPercent),
                      })}
                    </p>
                    <p className="settings-card-desc">
                      {t('debug.center.memory.processPerf.totals.other', {
                        ws: formatBytesMb(processPerf.totals.otherWorkingSetBytes),
                        private: formatBytesMb(processPerf.totals.otherPrivateBytes),
                        cpu: formatCpuPercent(processPerf.totals.otherCpuPercent),
                      })}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                    {processPerf.processes.map((process) => {
                      const kindLabel =
                        process.kind === 'app'
                          ? t('debug.center.memory.processPerf.kind.app')
                          : process.kind === 'webview2'
                            ? t('debug.center.memory.processPerf.kind.webview2')
                            : t('debug.center.memory.processPerf.kind.child');

                      return (
                        <div
                          key={process.pid}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.08)',
                            background: 'rgba(0,0,0,0.22)',
                          }}
                        >
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>
                              {process.name}
                            </span>
                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                              {t('debug.center.memory.processPerf.processPid', { pid: process.pid })}
                            </span>
                          </div>
                          <p className="settings-card-note" style={{ marginTop: 6 }}>
                            {t('debug.center.memory.processPerf.processLine', {
                              kind: kindLabel,
                              cpu: formatCpuPercent(process.cpuPercent),
                              private: formatBytesMb(process.privateBytes),
                              ws: formatBytesMb(process.workingSetBytes),
                            })}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <p className="settings-card-label">{t('debug.center.memory.navigation.label')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.navigation.desc')}</p>
              <p className="settings-card-note">
                {t('debug.center.memory.navigation.history.value', {
                  count: navigationHistoryStats.count,
                  kb: (navigationHistoryStats.bytes / 1024).toFixed(1),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.shortcuts.title')}</p>
              <p className="settings-card-desc">{t('debug.center.shortcuts.desc')}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="settings-action-btn" onClick={() => navigateTo('native-debug')}>
              {t('debug.center.shortcuts.nativeDebug')}
            </button>
            <button type="button" className="settings-action-btn" onClick={() => navigateTo('dsp-rack')}>
              {t('debug.center.shortcuts.dspRack')}
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => void handleOpenVstManager()}
              disabled={!isTauri}
            >
              {t('debug.center.shortcuts.vstManager')}
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => void handleOpenThemeDebugWindow()}
              disabled={!isTauri}
            >
              {t('debug.center.shortcuts.themeDebug')}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmRestart}
        title={t('debug.center.restart.confirmTitle')}
        message={t('debug.center.restart.confirmMessage')}
        confirmText={t('debug.center.actions.restart')}
        onConfirm={() => {
          setConfirmRestart(false);
          void requestRestart('normal');
        }}
        onCancel={() => setConfirmRestart(false)}
      />

      <ConfirmDialog
        isOpen={confirmRestartIntoDebug}
        title={t('debug.center.restart.confirmTitle')}
        message={t('debug.center.restart.confirmMessageIntoDebug')}
        confirmText={t('debug.center.actions.restartAndOpen')}
        onConfirm={() => {
          setConfirmRestartIntoDebug(false);
          void requestRestart('debug-center');
        }}
        onCancel={() => setConfirmRestartIntoDebug(false)}
      />

      <ConfirmDialog
        isOpen={confirmDestroyEditorWindows}
        title={t('debug.center.memory.confirm.destroyEditorWindows.title')}
        message={t('debug.center.memory.confirm.destroyEditorWindows.message')}
        confirmText={t('common.action.confirm')}
        onConfirm={() => {
          setConfirmDestroyEditorWindows(false);
          if (!isTauri) return;
          void import('@tauri-apps/api/tauri')
            .then(({ invoke }) => invoke('close_all_editor_windows'))
            .then(() => refreshMemory())
            .catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }}
        onCancel={() => setConfirmDestroyEditorWindows(false)}
      />

      <ConfirmDialog
        isOpen={confirmClearCoverCaches}
        title={t('debug.center.memory.confirm.clearCoverCaches.title')}
        message={t('debug.center.memory.confirm.clearCoverCaches.message')}
        confirmText={t('common.action.confirm')}
        onConfirm={() => {
          setConfirmClearCoverCaches(false);
          MusicLibraryService.getInstance().clearCoverRuntimeCaches();
          void refreshMemory();
        }}
        onCancel={() => setConfirmClearCoverCaches(false)}
      />
    </div>
  );
}
