import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { readJson, usePersistentSetting, writeJson } from '../../modules/storage';
import {
  getDebugConfig,
  getDebugEnvSnapshot,
  getDefaultDebugConfig,
  getProcessPerfTotalsSnapshot,
  restartApp,
  setDebugConfig,
  type DebugConfig,
  type DebugEnvSnapshot,
  type ProcessPerfTotalsSnapshot,
  type VstSidechainModeOverride,
} from '../../modules/debug';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { calculateWindowPosition, openEditorWindow } from '../../utils/editorWindows';
import { openVstManagerWindow } from '../../utils/vstManagerWindows';
import { MusicLibraryService } from '../../services/audio/MusicLibraryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { ConfirmDialog } from '../magnet/ConfirmDialog';

const WINDOW_COMM_DEBUG_KEY = 'pixel-matrix-debug-window-comm';

type TriBool = boolean | null;

type EditorWindowsDebugState = {
  windows: Array<{ windowType: string; exists: boolean; visible: boolean }>;
  cachedHidden?: string | null;
};

type CoverCacheStats = ReturnType<MusicLibraryService['getCoverRuntimeCacheStats']>;

type MemoryBaselineSample = {
  id: string;
  capturedAtMs: number;
  stage: 'manual' | 'pre-library' | 'post-library' | 'post-playback';
  scenarioId?: string;
  navigationHistoryBytes: number;
  jsHeapUsedBytes?: number;
  coverBlobUrlTotalBytes: number;
  coverDecodedEstimateTotalBytes: number;
  coverBlobUrlCacheEntries: number;
  coverDecodedEstimateEntries: number;
  coverUrlCacheEntries: number;
  albumCoverUrlCacheEntries: number;
  webview2WorkingSetBytes?: number;
  webview2PrivateBytes?: number;
  treeWorkingSetBytes?: number;
  treePrivateBytes?: number;
};

type MemoryBaselineScenarioComparison = {
  scenarioId: string;
  sampleCount: number;
  startAtMs: number;
  endAtMs: number;
  startStage: MemoryBaselineSample['stage'];
  endStage: MemoryBaselineSample['stage'];
  deltaNavigationHistoryBytes: number;
  deltaCoverBlobUrlTotalBytes: number;
  deltaCoverDecodedEstimateTotalBytes: number;
  deltaJsHeapUsedBytes?: number;
  deltaWebview2WorkingSetBytes?: number;
  deltaWebview2PrivateBytes?: number;
  deltaTreeWorkingSetBytes?: number;
  deltaTreePrivateBytes?: number;
};

type MemoryBaselineExportPayload = {
  exportedAtMs: number;
  sampleCount: number;
  samples: MemoryBaselineSample[];
  scenarioComparisons: MemoryBaselineScenarioComparison[];
};

const MEMORY_BASELINE_MAX_ENTRIES = 20;
const THREE_STAGE_CAPTURE_PLAN: ReadonlyArray<{
  stage: MemoryBaselineSample['stage'];
  delayMs: number;
}> = [
  { stage: 'pre-library', delayMs: 0 },
  { stage: 'post-library', delayMs: 8_000 },
  { stage: 'post-playback', delayMs: 20_000 },
];

function formatBytesToMb(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const mb = value / 1024 / 1024;
  const normalized = Object.is(mb, -0) ? 0 : mb;
  return normalized.toFixed(1);
}

function formatTriBool(value: TriBool): 'auto' | 'on' | 'off' {
  if (value === null) return 'auto';
  return value ? 'on' : 'off';
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

function diffOptionalNumber(current?: number, previous?: number): number | undefined {
  if (typeof current !== 'number' || !Number.isFinite(current)) return undefined;
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return undefined;
  return current - previous;
}

function computeScenarioComparisons(
  samples: MemoryBaselineSample[]
): MemoryBaselineScenarioComparison[] {
  const grouped = new Map<string, MemoryBaselineSample[]>();
  for (const sample of samples) {
    if (!sample.scenarioId) continue;
    const list = grouped.get(sample.scenarioId) ?? [];
    list.push(sample);
    grouped.set(sample.scenarioId, list);
  }

  const comparisons: MemoryBaselineScenarioComparison[] = [];
  for (const [scenarioId, list] of grouped.entries()) {
    if (list.length < 2) continue;
    const ordered = list.slice().sort((left, right) => left.capturedAtMs - right.capturedAtMs);
    const start = ordered[0];
    const end = ordered[ordered.length - 1];
    if (!start || !end) continue;

    comparisons.push({
      scenarioId,
      sampleCount: ordered.length,
      startAtMs: start.capturedAtMs,
      endAtMs: end.capturedAtMs,
      startStage: start.stage,
      endStage: end.stage,
      deltaNavigationHistoryBytes: end.navigationHistoryBytes - start.navigationHistoryBytes,
      deltaCoverBlobUrlTotalBytes: end.coverBlobUrlTotalBytes - start.coverBlobUrlTotalBytes,
      deltaCoverDecodedEstimateTotalBytes:
        end.coverDecodedEstimateTotalBytes - start.coverDecodedEstimateTotalBytes,
      deltaJsHeapUsedBytes: diffOptionalNumber(end.jsHeapUsedBytes, start.jsHeapUsedBytes),
      deltaWebview2WorkingSetBytes: diffOptionalNumber(
        end.webview2WorkingSetBytes,
        start.webview2WorkingSetBytes
      ),
      deltaWebview2PrivateBytes: diffOptionalNumber(end.webview2PrivateBytes, start.webview2PrivateBytes),
      deltaTreeWorkingSetBytes: diffOptionalNumber(end.treeWorkingSetBytes, start.treeWorkingSetBytes),
      deltaTreePrivateBytes: diffOptionalNumber(end.treePrivateBytes, start.treePrivateBytes),
    });
  }

  return comparisons.sort((left, right) => right.endAtMs - left.endAtMs);
}

function buildMemoryBaselineExportPayload(samples: MemoryBaselineSample[]): MemoryBaselineExportPayload {
  return {
    exportedAtMs: Date.now(),
    sampleCount: samples.length,
    samples: samples.slice(),
    scenarioComparisons: computeScenarioComparisons(samples),
  };
}

function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (!/[",\n\r]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildMemoryBaselineCsv(payload: MemoryBaselineExportPayload): string {
  const sampleHeader = [
    'sample_id',
    'captured_at_iso',
    'captured_at_ms',
    'stage',
    'scenario_id',
    'navigation_history_bytes',
    'js_heap_used_bytes',
    'cover_blob_total_bytes',
    'cover_decoded_total_bytes',
    'cover_blob_entries',
    'cover_decoded_entries',
    'cover_url_entries',
    'album_cover_entries',
    'webview2_working_set_bytes',
    'webview2_private_bytes',
    'tree_working_set_bytes',
    'tree_private_bytes',
  ];

  const sampleRows = payload.samples.map((sample) => [
    sample.id,
    new Date(sample.capturedAtMs).toISOString(),
    sample.capturedAtMs,
    sample.stage,
    sample.scenarioId ?? '',
    sample.navigationHistoryBytes,
    sample.jsHeapUsedBytes,
    sample.coverBlobUrlTotalBytes,
    sample.coverDecodedEstimateTotalBytes,
    sample.coverBlobUrlCacheEntries,
    sample.coverDecodedEstimateEntries,
    sample.coverUrlCacheEntries,
    sample.albumCoverUrlCacheEntries,
    sample.webview2WorkingSetBytes,
    sample.webview2PrivateBytes,
    sample.treeWorkingSetBytes,
    sample.treePrivateBytes,
  ]);

  const comparisonHeader = [
    'scenario_id',
    'sample_count',
    'start_at_iso',
    'end_at_iso',
    'start_stage',
    'end_stage',
    'delta_navigation_history_bytes',
    'delta_cover_blob_total_bytes',
    'delta_cover_decoded_total_bytes',
    'delta_js_heap_used_bytes',
    'delta_webview2_working_set_bytes',
    'delta_webview2_private_bytes',
    'delta_tree_working_set_bytes',
    'delta_tree_private_bytes',
  ];

  const comparisonRows = payload.scenarioComparisons.map((item) => [
    item.scenarioId,
    item.sampleCount,
    new Date(item.startAtMs).toISOString(),
    new Date(item.endAtMs).toISOString(),
    item.startStage,
    item.endStage,
    item.deltaNavigationHistoryBytes,
    item.deltaCoverBlobUrlTotalBytes,
    item.deltaCoverDecodedEstimateTotalBytes,
    item.deltaJsHeapUsedBytes,
    item.deltaWebview2WorkingSetBytes,
    item.deltaWebview2PrivateBytes,
    item.deltaTreeWorkingSetBytes,
    item.deltaTreePrivateBytes,
  ]);

  const section = (header: string[], rows: unknown[][]): string => {
    const headerLine = header.map(toCsvCell).join(',');
    const rowLines = rows.map((row) => row.map(toCsvCell).join(','));
    return [headerLine, ...rowLines].join('\n');
  };

  return [
    '# memory_baseline_samples',
    section(sampleHeader, sampleRows),
    '',
    '# memory_baseline_scenario_comparisons',
    section(comparisonHeader, comparisonRows),
    '',
  ].join('\n');
}

export function DebugCenter({ variant = 'page' }: { variant?: 'page' | 'settings' }) {
  const t = useT();
  const { navigateTo, history } = useNavigation();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [config, setConfigState] = useState<DebugConfig>(() => getDefaultDebugConfig());
  const [envSnapshot, setEnvSnapshot] = useState<DebugEnvSnapshot>({});
  const [editorWindowsState, setEditorWindowsState] = useState<EditorWindowsDebugState | null>(null);
  const [coverCacheStats, setCoverCacheStats] = useState<CoverCacheStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmRestartIntoDebug, setConfirmRestartIntoDebug] = useState(false);
  const [confirmDestroyEditorWindows, setConfirmDestroyEditorWindows] = useState(false);
  const [confirmClearCoverCaches, setConfirmClearCoverCaches] = useState(false);
  const [minidumpDirDraft, setMinidumpDirDraft] = useState('');
  const [memoryBaselines, setMemoryBaselines] = useState<MemoryBaselineSample[]>(() =>
    readJson<MemoryBaselineSample[]>(STORAGE_KEYS.MEMORY_BASELINE_SAMPLES_V1, [])
  );
  const [threeStageBaselineRunning, setThreeStageBaselineRunning] = useState(false);
  const [lastThreeStageScenarioId, setLastThreeStageScenarioId] = useState<string | null>(null);
  const threeStageCaptureTimersRef = useRef<number[]>([]);

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

  const clearThreeStageCaptureTimers = useCallback(() => {
    if (threeStageCaptureTimersRef.current.length === 0) return;
    for (const timer of threeStageCaptureTimersRef.current) {
      window.clearTimeout(timer);
    }
    threeStageCaptureTimersRef.current = [];
  }, []);

  const captureMemoryBaseline = useCallback(async (options?: {
    stage?: MemoryBaselineSample['stage'];
    scenarioId?: string;
  }) => {
    const coverStats = MusicLibraryService.getInstance().getCoverRuntimeCacheStats();
    let processTotals: ProcessPerfTotalsSnapshot | null = null;
    if (isTauri) {
      processTotals = await getProcessPerfTotalsSnapshot();
    }

    const jsHeapUsedBytes = (() => {
      try {
        const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
        const value = memory?.usedJSHeapSize;
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
      } catch {
        return undefined;
      }
    })();

    const sample: MemoryBaselineSample = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      capturedAtMs: Date.now(),
      stage: options?.stage ?? 'manual',
      scenarioId: options?.scenarioId,
      navigationHistoryBytes: navigationHistoryStats.bytes,
      jsHeapUsedBytes,
      coverBlobUrlTotalBytes: coverStats.coverBlobUrlTotalBytes,
      coverDecodedEstimateTotalBytes: coverStats.coverDecodedEstimateTotalBytes,
      coverBlobUrlCacheEntries: coverStats.coverBlobUrlCacheEntries,
      coverDecodedEstimateEntries: coverStats.coverDecodedEstimateEntries,
      coverUrlCacheEntries: coverStats.coverUrlCacheEntries,
      albumCoverUrlCacheEntries: coverStats.albumCoverUrlCacheEntries,
      webview2WorkingSetBytes: processTotals?.totals.webview2WorkingSetBytes,
      webview2PrivateBytes: processTotals?.totals.webview2PrivateBytes,
      treeWorkingSetBytes: processTotals?.totals.workingSetBytes,
      treePrivateBytes: processTotals?.totals.privateBytes,
    };

    setMemoryBaselines((previous) => {
      const next = [sample, ...previous].slice(0, MEMORY_BASELINE_MAX_ENTRIES);
      writeJson(STORAGE_KEYS.MEMORY_BASELINE_SAMPLES_V1, next, { mode: 'idle', debounceMs: 200 });
      return next;
    });
    return sample;
  }, [isTauri, navigationHistoryStats.bytes]);

  const runThreeStageBaselineCapture = useCallback(async () => {
    if (threeStageBaselineRunning) return;

    clearThreeStageCaptureTimers();

    const scenarioId = `baseline-${Date.now().toString(36)}`;
    setLastThreeStageScenarioId(scenarioId);
    setThreeStageBaselineRunning(true);

    for (const [index, item] of THREE_STAGE_CAPTURE_PLAN.entries()) {
      const isLast = index === THREE_STAGE_CAPTURE_PLAN.length - 1;
      const timer = window.setTimeout(() => {
        void captureMemoryBaseline({ stage: item.stage, scenarioId }).finally(() => {
          if (isLast) {
            setThreeStageBaselineRunning(false);
          }
        });
      }, item.delayMs);
      threeStageCaptureTimersRef.current.push(timer);
    }
  }, [captureMemoryBaseline, clearThreeStageCaptureTimers, threeStageBaselineRunning]);

  const clearMemoryBaselines = useCallback(() => {
    clearThreeStageCaptureTimers();
    setThreeStageBaselineRunning(false);
    setLastThreeStageScenarioId(null);
    setMemoryBaselines([]);
    writeJson(STORAGE_KEYS.MEMORY_BASELINE_SAMPLES_V1, [], { mode: 'idle', debounceMs: 200 });
  }, [clearThreeStageCaptureTimers]);

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
    return () => {
      clearThreeStageCaptureTimers();
    };
  }, [clearThreeStageCaptureTimers]);

  const latestThreeStageDelta = useMemo(() => {
    const scenarioId = lastThreeStageScenarioId;
    if (!scenarioId) return null;
    const scenarioSamples = memoryBaselines
      .filter((sample) => sample.scenarioId === scenarioId)
      .slice()
      .sort((left, right) => left.capturedAtMs - right.capturedAtMs);
    if (scenarioSamples.length < 2) return null;

    const start = scenarioSamples[0];
    const end = scenarioSamples[scenarioSamples.length - 1];

    return {
      sampleCount: scenarioSamples.length,
      jsHeapDeltaMb: formatBytesToMb((end.jsHeapUsedBytes ?? 0) - (start.jsHeapUsedBytes ?? 0)),
      webview2PrivateDeltaMb: formatBytesToMb(
        (end.webview2PrivateBytes ?? 0) - (start.webview2PrivateBytes ?? 0)
      ),
      webview2WsDeltaMb: formatBytesToMb(
        (end.webview2WorkingSetBytes ?? 0) - (start.webview2WorkingSetBytes ?? 0)
      ),
      coverBlobDeltaMb: formatBytesToMb(
        end.coverBlobUrlTotalBytes - start.coverBlobUrlTotalBytes
      ),
      coverDecodedDeltaMb: formatBytesToMb(
        end.coverDecodedEstimateTotalBytes - start.coverDecodedEstimateTotalBytes
      ),
    };
  }, [lastThreeStageScenarioId, memoryBaselines]);

  const downloadTextFile = useCallback((fileName: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }, []);

  const handleExportBaselinesJson = useCallback(() => {
    if (memoryBaselines.length === 0) {
      setError(t('debug.center.memory.baselines.export.emptyError'));
      return;
    }

    const payload = buildMemoryBaselineExportPayload(memoryBaselines);
    const json = JSON.stringify(payload, null, 2);
    downloadTextFile(
      `memory-baselines-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      json,
      'application/json;charset=utf-8'
    );
  }, [downloadTextFile, memoryBaselines, t]);

  const handleExportBaselinesCsv = useCallback(() => {
    if (memoryBaselines.length === 0) {
      setError(t('debug.center.memory.baselines.export.emptyError'));
      return;
    }

    const payload = buildMemoryBaselineExportPayload(memoryBaselines);
    const csv = buildMemoryBaselineCsv(payload);
    downloadTextFile(
      `memory-baselines-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      csv,
      'text/csv;charset=utf-8'
    );
  }, [downloadTextFile, memoryBaselines, t]);

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
                }}
              >
                {t('common.action.refresh')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => {
                  void captureMemoryBaseline();
                }}
              >
                {t('debug.center.memory.actions.captureBaseline')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={() => {
                  void runThreeStageBaselineCapture();
                }}
                disabled={threeStageBaselineRunning}
              >
                {t('debug.center.memory.actions.captureThreeStage')}
              </button>
              <button type="button" className="settings-action-btn" onClick={clearMemoryBaselines}>
                {t('debug.center.memory.actions.clearBaselines')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={handleExportBaselinesJson}
                disabled={memoryBaselines.length === 0}
              >
                {t('debug.center.memory.actions.exportBaselinesJson')}
              </button>
              <button
                type="button"
                className="settings-action-btn"
                onClick={handleExportBaselinesCsv}
                disabled={memoryBaselines.length === 0}
              >
                {t('debug.center.memory.actions.exportBaselinesCsv')}
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

          {threeStageBaselineRunning && (
            <p className="settings-card-note">{t('debug.center.memory.baselines.running')}</p>
          )}

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
                  {t('debug.center.memory.coverCaches.decoded.value', {
                    count: coverCacheStats?.coverDecodedEstimateEntries ?? 0,
                    mb: ((coverCacheStats?.coverDecodedEstimateTotalBytes ?? 0) / 1024 / 1024).toFixed(1),
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
              <p className="settings-card-label">{t('debug.center.memory.navigation.label')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.navigation.desc')}</p>
              <p className="settings-card-note">
                {t('debug.center.memory.navigation.history.value', {
                  count: navigationHistoryStats.count,
                  kb: (navigationHistoryStats.bytes / 1024).toFixed(1),
                })}
              </p>
            </div>

            <div>
              <p className="settings-card-label">{t('debug.center.memory.baselines.label')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.baselines.desc')}</p>
              {memoryBaselines.length === 0 ? (
                <p className="settings-card-note">{t('debug.center.memory.baselines.empty')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {memoryBaselines.slice(0, 8).map((sample) => (
                    <p className="settings-card-note" key={sample.id}>
                      {t('debug.center.memory.baselines.item', {
                        stage: t(`debug.center.memory.baselines.stage.${sample.stage}`),
                        at: new Date(sample.capturedAtMs).toLocaleString(),
                        jsHeapMb: formatBytesToMb(sample.jsHeapUsedBytes),
                        webview2PrivateMb: formatBytesToMb(sample.webview2PrivateBytes),
                        webview2WsMb: formatBytesToMb(sample.webview2WorkingSetBytes),
                        coverBlobMb: formatBytesToMb(sample.coverBlobUrlTotalBytes),
                        coverDecodedMb: formatBytesToMb(sample.coverDecodedEstimateTotalBytes),
                      })}
                    </p>
                  ))}
                </div>
              )}
              {latestThreeStageDelta && (
                <p className="settings-card-note">
                  {t('debug.center.memory.baselines.lastScenarioDelta', {
                    sampleCount: latestThreeStageDelta.sampleCount,
                    jsHeapDeltaMb: latestThreeStageDelta.jsHeapDeltaMb,
                    webview2PrivateDeltaMb: latestThreeStageDelta.webview2PrivateDeltaMb,
                    webview2WsDeltaMb: latestThreeStageDelta.webview2WsDeltaMb,
                    coverBlobDeltaMb: latestThreeStageDelta.coverBlobDeltaMb,
                    coverDecodedDeltaMb: latestThreeStageDelta.coverDecodedDeltaMb,
                  })}
                </p>
              )}
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
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => navigateTo('debug', { tab: 'perf-monitor' })}
            >
              {t('debug.center.shortcuts.perfMonitor')}
            </button>
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => navigateTo('debug', { tab: 'native-debug' })}
            >
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
