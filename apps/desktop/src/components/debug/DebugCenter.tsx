import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './DebugCenter.css';
import type { TelemetryQueryInput, TelemetryQueryResult, TelemetryRecord } from '../../contracts/telemetry';
import { useKernel } from '../../contexts/KernelContext';
import { getGlobalProcessPerfService } from '../../services/performance-control';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { readJson, usePersistentSetting, writeJson } from '../../modules/storage';
import {
  getDebugConfig,
  getDebugEnvSnapshot,
  getDefaultDebugConfig,
  getProcessPerfTotalsSnapshot,
  getRecentGitCommits,
  queryTelemetryCurrentSession,
  readCurrentTelemetrySession,
  restartApp,
  setDebugConfig,
  type DebugConfig,
  type DebugEnvSnapshot,
  type ProcessPerfTotalsSnapshot,
  type VstSidechainModeOverride,
} from '../../modules/debug';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  MusicLibraryService,
  type UnifiedMusicSource,
  type UnifiedTrackCandidate,
} from '../../services/audio/MusicLibraryService';
import {
  beginPlatformInstanceQrLogin,
  getPlatformInstanceAuthSnapshot,
  getPlatformPackStartupHealth,
  inspectPlatformPackDoctor,
  listPlatformConnectorDefinitions,
  logoutPlatformInstance,
  pollPlatformInstanceQrLogin,
  refreshPlatformInstanceAuthSnapshot,
  resolvePlatformInstanceId,
  subscribePlatformPackStartupHealth,
  subscribePlatformConnectorDefinitions,
  type PlatformConnectorDefinition,
  type PlatformConnectorId,
  type PlatformInstanceAuthSnapshot,
  type PlatformInstanceQrLoginPollResult,
  type PlatformInstanceQrLoginSession,
  type PlatformPackBootStage,
  type PlatformPackDoctorIssue,
  type PlatformPackDoctorReport,
  type PlatformPackDoctorStatus,
  type PlatformPackWorkspaceReadinessDiagnostic,
  type PlatformPackStartupHealth,
  type PlatformPackStartupState,
} from '../../modules/music-platform';
import {
  type NativeLibrarySyncFailureOverview,
  type NativeLibrarySyncFailureSourceSummary,
  type NativeLibrarySyncSchedulerStatus,
  type NativeLibrarySyncStatus,
  type NativeLibrarySyncTickResult,
} from '../../modules/music-library';
import {
  TELEMETRY_SERVICE_TOKEN,
} from '../../services/telemetry/TelemetryService';
import type { TelemetryService, TelemetrySnapshot } from '../../services/telemetry/telemetryTypes';
import {
  buildTelemetryAiContextReport,
  getTelemetryAiContextPreset,
  type TelemetryAiContextPreset,
  type TelemetryAiContextPresetId,
} from '../../services/telemetry/aiContextReport';
import { buildTelemetryScenarioReport } from '../../services/telemetry/scenarioReport';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupTauriListenerWithPayload,
} from '../../utils/windowCommunication';
import { MagnetTelemetryWorkbench } from './MagnetTelemetryWorkbench';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { PmpButton, PmpCard, PmpCheckbox, PmpChoiceButton, PmpSegmented } from '../primitives';

const WINDOW_COMM_DEBUG_KEY = 'pixel-matrix-debug-window-comm';

type TriBool = boolean | null;

type EditorWindowsDebugState = {
  windows: Array<{ windowType: string; exists: boolean; visible: boolean }>;
  cachedHidden?: string | null;
};

type CoverCacheStats = ReturnType<MusicLibraryService['getCoverRuntimeCacheStats']>;
type DesktopCoverLeaseStats = NonNullable<
  Awaited<ReturnType<MusicLibraryService['getDesktopCoverLeaseStats']>>
>;

type MusicLibraryRuntimeMemorySnapshot = {
  timestampMs: number;
  sourceMode: string;
  baseView: string;
  searchQuery: string;
  shouldUseNativeBaseQuery: boolean;
  coverPolicy: string;
  counts: {
    tracks: number;
    nativeBaseTracks: number;
    filteredTracks: number;
    renderedTracks: number;
    groupedRows: number;
  };
  estimatedBytes: {
    tracks: number | null;
    nativeBaseTracks: number | null;
  };
  attribution: {
    trackArrayBytes: number;
    trackedRuntimeBytes: number;
    webview2PrivateResidualBytes: number | null;
    webview2PrivateMinusTrackArraysBytes: number | null;
  };
  process: {
    timestampMs: number | null;
    webview2PrivateBytes: number | null;
    webview2WorkingSetBytes: number | null;
    treePrivateBytes: number | null;
    treeWorkingSetBytes: number | null;
    webview2CpuPercent: number | null;
  };
};

type MusicLibrarySyncStatusEventPayload = {
  source?: string;
  emittedAtMs?: number;
  syncStatus?: NativeLibrarySyncStatus;
  schedulerStatus?: NativeLibrarySyncSchedulerStatus;
  tickResult?: NativeLibrarySyncTickResult;
};

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

type TelemetryArtifactAction =
  | 'session-json'
  | 'scenario-report'
  | 'copy-ai-context'
  | 'export-ai-context';

type TelemetryArtifactFeedback = {
  tone: 'progress' | 'success' | 'error';
  message: string;
};

type DebugWorkspaceId =
  | 'overview'
  | 'platforms'
  | 'runtime'
  | 'telemetry'
  | 'magnets'
  | 'memory';

const MEMORY_BASELINE_MAX_ENTRIES = 20;
const THREE_STAGE_CAPTURE_PLAN: ReadonlyArray<{
  stage: MemoryBaselineSample['stage'];
  delayMs: number;
}> = [
  { stage: 'pre-library', delayMs: 0 },
  { stage: 'post-library', delayMs: 8_000 },
  { stage: 'post-playback', delayMs: 20_000 },
];

const COMMIT_HASH_ENV_KEYS: ReadonlyArray<string> = [
  'PMP_GIT_COMMIT',
  'PMP_COMMIT_SHA',
  'VITE_GIT_COMMIT',
  'VITE_COMMIT_SHA',
  'GIT_COMMIT',
  'COMMIT_SHA',
  'CI_COMMIT_SHA',
  'SOURCE_VERSION',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
];

function formatBytesToMb(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const mb = value / 1024 / 1024;
  const normalized = Object.is(mb, -0) ? 0 : mb;
  return normalized.toFixed(1);
}

function formatTelemetryTimestamp(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Date(value).toLocaleTimeString();
}

function formatTelemetryRecordLine(record: TelemetryRecord): string {
  const parts = [
    `[${formatTelemetryTimestamp(record.ts)}]`,
    record.level.toUpperCase(),
    record.moduleId,
    record.event,
  ];
  const message = typeof record.message === 'string' && record.message.trim().length > 0
    ? record.message.trim()
    : '';
  if (message) {
    parts.push(message);
  }
  return parts.join(' | ');
}

function formatTelemetryQueryFilterList(value: readonly string[] | null | undefined): string {
  if (!Array.isArray(value) || value.length === 0) return 'all';
  return value.join(', ');
}

function formatTelemetryQueryWindow(result: Pick<TelemetryQueryResult, 'firstMatchedTs' | 'lastMatchedTs'>): string {
  if (typeof result.firstMatchedTs !== 'number' || typeof result.lastMatchedTs !== 'number') {
    return 'n/a';
  }
  return `${formatTelemetryTimestamp(result.firstMatchedTs)} -> ${formatTelemetryTimestamp(
    result.lastMatchedTs
  )}`;
}

function formatTelemetryCountList(
  items: ReadonlyArray<{ key: string; count: number }>,
  limit = 6
): string {
  if (items.length === 0) return '-';
  return items
    .slice(0, limit)
    .map((item) => `${item.key} x ${item.count}`)
    .join('\n');
}

function formatDebugTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return new Date(value).toLocaleTimeString();
}

function formatOptionalText(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || '-';
  }
  return '-';
}

function formatNullableToggleState(
  value: boolean | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (value === true) return t('common.state.on');
  if (value === false) return t('common.state.off');
  return t('common.state.unknown');
}

function formatPlatformPackStartupStateLabel(
  state: PlatformPackStartupState,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  switch (state) {
    case 'scheduled':
      return t('debug.center.musicPlatformPack.state.scheduled');
    case 'running':
      return t('debug.center.musicPlatformPack.state.running');
    case 'ready':
      return t('debug.center.musicPlatformPack.state.ready');
    case 'degraded':
      return t('debug.center.musicPlatformPack.state.degraded');
    case 'idle':
    default:
      return t('debug.center.musicPlatformPack.state.idle');
  }
}

function formatPlatformPackBootStageLabel(
  stage: PlatformPackBootStage,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  switch (stage) {
    case 'scheduled':
      return t('debug.center.musicPlatformPack.stage.scheduled');
    case 'restore-store':
      return t('debug.center.musicPlatformPack.stage.restoreStore');
    case 'reconcile-inline':
      return t('debug.center.musicPlatformPack.stage.reconcileInline');
    case 'inspect-store':
      return t('debug.center.musicPlatformPack.stage.inspectStore');
    case 'background-reconcile':
      return t('debug.center.musicPlatformPack.stage.backgroundReconcile');
    case 'completed':
      return t('debug.center.musicPlatformPack.stage.completed');
    case 'idle':
    default:
      return t('debug.center.musicPlatformPack.stage.idle');
  }
}

function formatPlatformPackDoctorStatusLabel(
  status: PlatformPackDoctorStatus,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  switch (status) {
    case 'error':
      return t('debug.center.musicPlatformPack.doctor.status.error');
    case 'degraded':
      return t('debug.center.musicPlatformPack.doctor.status.degraded');
    case 'ready':
    default:
      return t('debug.center.musicPlatformPack.doctor.status.ready');
  }
}

function formatPlatformPackDoctorFlowStatusLabel(
  status: 'ready' | 'degraded' | 'error' | 'unsupported',
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  switch (status) {
    case 'error':
      return t('debug.center.musicPlatformPack.doctor.flow.error');
    case 'degraded':
      return t('debug.center.musicPlatformPack.doctor.flow.degraded');
    case 'unsupported':
      return t('debug.center.musicPlatformPack.doctor.flow.unsupported');
    case 'ready':
    default:
      return t('debug.center.musicPlatformPack.doctor.flow.ready');
  }
}

function formatPlatformWorkspaceOwnershipModeLabel(
  mode: 'legacy' | 'pack' | 'auto',
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  return t(`magnet.platform.workspace.ownership.${mode}`);
}

function formatPlatformWorkspacePathLabel(
  path: 'legacy' | 'pack' | 'none',
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  return t(`magnet.platform.workspace.path.${path}`);
}

function formatPlatformWorkspaceStatusLabel(
  status: 'active' | 'fallback' | 'blocked',
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  return t(`magnet.platform.workspace.status.${status}`);
}

function formatPlatformPackDoctorIssueDetails(issue: PlatformPackDoctorIssue): string {
  const entries = Object.entries(issue.fields ?? {}).filter(([, value]) => value !== null);
  if (entries.length < 1) {
    return '-';
  }
  return entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' | ');
}

function formatPlatformWorkspaceDiagnosticDetails(
  diagnostic: PlatformPackWorkspaceReadinessDiagnostic
): string {
  const entries = Object.entries(diagnostic.fields ?? {}).filter(([, value]) => value !== null);
  if (entries.length < 1) {
    return diagnostic.message || '-';
  }
  return [diagnostic.message, ...entries.map(([key, value]) => `${key}=${String(value)}`)]
    .filter((value) => value.trim().length > 0)
    .join(' | ');
}

function getLatestMusicLibraryRuntimeSnapshot(): MusicLibraryRuntimeMemorySnapshot | null {
  if (typeof window === 'undefined') return null;
  const snapshotWindow = window as Window & {
    __PMP_MUSIC_LIBRARY_GET_SNAPSHOT__?: () => MusicLibraryRuntimeMemorySnapshot;
    __PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__?: MusicLibraryRuntimeMemorySnapshot;
  };

  try {
    const liveSnapshot = snapshotWindow.__PMP_MUSIC_LIBRARY_GET_SNAPSHOT__?.();
    if (liveSnapshot) {
      snapshotWindow.__PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__ = liveSnapshot;
      return liveSnapshot;
    }
  } catch {
    // Ignore getter failures and fall back to the last captured snapshot.
  }

  return snapshotWindow.__PMP_LAST_MUSIC_LIBRARY_SNAPSHOT__ ?? null;
}

function sanitizeFileSegment(value: string, fallback: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return safe || fallback;
}

function resolveCommitHash(snapshot: DebugEnvSnapshot): string {
  for (const key of COMMIT_HASH_ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized) continue;
    return normalized;
  }
  return 'unknown';
}

function shortCommitHash(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return 'unknown';
  if (/^[0-9a-fA-F]{12,40}$/.test(normalized)) {
    return normalized.slice(0, 12);
  }
  return normalized;
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

type SettingsActionButtonProps = Omit<ComponentPropsWithoutRef<typeof PmpButton>, 'className' | 'variant'> & {
  className?: string;
};

type SettingsToggleGroupProps = {
  children: ReactNode;
  className?: string;
};

type SettingsToggleButtonProps = ComponentPropsWithoutRef<typeof PmpChoiceButton>;
type SettingsCheckboxProps = Omit<ComponentPropsWithoutRef<typeof PmpCheckbox>, 'className' | 'variant'> & {
  className?: string;
};
type SettingsCardProps = Omit<ComponentPropsWithoutRef<typeof PmpCard>, 'className' | 'surfaceId'> & {
  className?: string;
  surfaceId?: ComponentPropsWithoutRef<typeof PmpCard>['surfaceId'];
};

function SettingsActionButton({ className, ...props }: SettingsActionButtonProps) {
  return (
    <PmpButton
      variant="default"
      className={['settings-action-btn', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

function SettingsToggleGroup({
  children,
  className = 'settings-toggle',
}: SettingsToggleGroupProps) {
  return (
    <PmpSegmented className={className} surfaceId="primitive.segmented.toggle">
      {children}
    </PmpSegmented>
  );
}

function SettingsToggleButton(props: SettingsToggleButtonProps) {
  return <PmpChoiceButton {...props} />;
}

function SettingsCheckbox({ className, ...props }: SettingsCheckboxProps) {
  return (
    <PmpCheckbox
      variant="settings"
      className={['settings-checkbox', className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}

function SettingsCard({
  className,
  surfaceId = 'primitive.card.settings',
  ...props
}: SettingsCardProps) {
  return (
    <PmpCard
      className={['settings-card', className].filter(Boolean).join(' ')}
      surfaceId={surfaceId}
      {...props}
    />
  );
}

function resolvePreferredDebugConnectorId(
  requestedConnectorId: string | null | undefined,
  definitions: PlatformConnectorDefinition[]
): PlatformConnectorId | null {
  if (definitions.length === 0) return null;

  const normalizedRequested =
    typeof requestedConnectorId === 'string' ? requestedConnectorId.trim().toLowerCase() : '';
  if (!normalizedRequested) {
    return definitions[0]?.connectorId ?? null;
  }

  return (
    definitions.find(
      (definition) => definition.connectorId.trim().toLowerCase() === normalizedRequested
    )?.connectorId ??
    definitions[0]?.connectorId ??
    null
  );
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
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const t = useT();
  const { history } = useNavigation();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const telemetryService = useMemo(
    () => kernel.services.get(TELEMETRY_SERVICE_TOKEN) as TelemetryService,
    [kernel]
  );
  const [config, setConfigState] = useState<DebugConfig>(() => getDefaultDebugConfig());
  const [envSnapshot, setEnvSnapshot] = useState<DebugEnvSnapshot>({});
  const [editorWindowsState, setEditorWindowsState] = useState<EditorWindowsDebugState | null>(null);
  const [coverCacheStats, setCoverCacheStats] = useState<CoverCacheStats | null>(null);
  const [desktopCoverLeaseStats, setDesktopCoverLeaseStats] = useState<DesktopCoverLeaseStats | null>(null);
  const [musicLibrarySnapshot, setMusicLibrarySnapshot] =
    useState<MusicLibraryRuntimeMemorySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<DebugWorkspaceId>('overview');
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [confirmRestartIntoDebug, setConfirmRestartIntoDebug] = useState(false);
  const [confirmDestroyEditorWindows, setConfirmDestroyEditorWindows] = useState(false);
  const [confirmClearCoverCaches, setConfirmClearCoverCaches] = useState(false);
  const [minidumpDirDraft, setMinidumpDirDraft] = useState('');
  const [syncStatus, setSyncStatus] = useState<NativeLibrarySyncStatus | null>(null);
  const [syncSchedulerStatus, setSyncSchedulerStatus] =
    useState<NativeLibrarySyncSchedulerStatus | null>(null);
  const [syncFailureOverview, setSyncFailureOverview] =
    useState<NativeLibrarySyncFailureOverview | null>(null);
  const [selectedSyncFailureSourceIds, setSelectedSyncFailureSourceIds] = useState<string[]>([]);
  const [lastSyncTickResult, setLastSyncTickResult] = useState<NativeLibrarySyncTickResult | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncSchedulerIntervalMs, setSyncSchedulerIntervalMs] = useState(60_000);
  const [unifiedSources, setUnifiedSources] = useState<UnifiedMusicSource[]>([]);
  const [unifiedSearchQuery, setUnifiedSearchQuery] = useState('');
  const [unifiedSearchResults, setUnifiedSearchResults] = useState<UnifiedTrackCandidate[]>([]);
  const [unifiedBusy, setUnifiedBusy] = useState(false);
  const [platformConnectorDefinitions, setPlatformConnectorDefinitions] = useState<
    PlatformConnectorDefinition[]
  >(() => listPlatformConnectorDefinitions());
  const [selectedAuthConnectorId, setSelectedAuthConnectorId] = useState<PlatformConnectorId | null>(
    null
  );
  const [platformAuthStatus, setPlatformAuthStatus] = useState<PlatformInstanceAuthSnapshot | null>(null);
  const [platformQrSession, setPlatformQrSession] = useState<PlatformInstanceQrLoginSession | null>(null);
  const [platformQrPollResult, setPlatformQrPollResult] =
    useState<PlatformInstanceQrLoginPollResult | null>(null);
  const [platformAuthBusy, setPlatformAuthBusy] = useState(false);
  const [platformPackStartupHealth, setPlatformPackStartupHealth] =
    useState<PlatformPackStartupHealth>(() => getPlatformPackStartupHealth());
  const [platformPackDoctorReport, setPlatformPackDoctorReport] =
    useState<PlatformPackDoctorReport | null>(null);
  const [platformPackDoctorBusy, setPlatformPackDoctorBusy] = useState(false);
  const [platformPackDoctorError, setPlatformPackDoctorError] = useState<string | null>(null);
  const [memoryBaselines, setMemoryBaselines] = useState<MemoryBaselineSample[]>(() =>
    readJson<MemoryBaselineSample[]>(STORAGE_KEYS.MEMORY_BASELINE_SAMPLES_V1, [])
  );
  const [threeStageBaselineRunning, setThreeStageBaselineRunning] = useState(false);
  const [lastThreeStageScenarioId, setLastThreeStageScenarioId] = useState<string | null>(null);
  const [pendingAutoWriteScenarioId, setPendingAutoWriteScenarioId] = useState<string | null>(null);
  const threeStageCaptureTimersRef = useRef<number[]>([]);

  const [windowCommDebug, setWindowCommDebug] = usePersistentSetting<string>(
    WINDOW_COMM_DEBUG_KEY,
    '0',
    { format: 'string' }
  );
  const windowCommDebugEnabled = windowCommDebug === '1';
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot>(() =>
    telemetryService.getSnapshot()
  );
  const [telemetryQueryPresetId, setTelemetryQueryPresetId] = useState<TelemetryAiContextPresetId>('general');
  const [telemetryQueryResult, setTelemetryQueryResult] = useState<TelemetryQueryResult | null>(null);
  const [telemetryQueryBusy, setTelemetryQueryBusy] = useState(false);
  const [telemetryQueryError, setTelemetryQueryError] = useState<string | null>(null);
  const [telemetryArtifactBusyAction, setTelemetryArtifactBusyAction] =
    useState<TelemetryArtifactAction | null>(null);
  const [telemetryArtifactFeedback, setTelemetryArtifactFeedback] =
    useState<TelemetryArtifactFeedback | null>(null);
  const telemetryQueryPreset = useMemo(
    () => getTelemetryAiContextPreset(telemetryQueryPresetId),
    [telemetryQueryPresetId]
  );
  const telemetryQueryPresetOptions = useMemo(
    () =>
      [
        { id: 'magnets' as const, label: t('debug.center.telemetry.query.preset.magnets') },
        { id: 'plugins' as const, label: t('debug.center.telemetry.query.preset.plugins') },
        { id: 'performance' as const, label: t('debug.center.telemetry.query.preset.performance') },
        {
          id: 'music-platform' as const,
          label: t('debug.center.telemetry.query.preset.musicPlatform'),
        },
        { id: 'general' as const, label: t('debug.center.telemetry.query.preset.general') },
      ] satisfies Array<{ id: TelemetryAiContextPresetId; label: string }>,
    [t]
  );
  const workspaceOptions = useMemo(
    () =>
      [
        {
          id: 'overview' as const,
          label: t('debug.center.workspace.tab.overview'),
          desc: t('debug.center.workspace.desc.overview'),
        },
        {
          id: 'platforms' as const,
          label: t('debug.center.workspace.tab.platforms'),
          desc: t('debug.center.workspace.desc.platforms'),
        },
        {
          id: 'runtime' as const,
          label: t('debug.center.workspace.tab.runtime'),
          desc: t('debug.center.workspace.desc.runtime'),
        },
        {
          id: 'telemetry' as const,
          label: t('debug.center.workspace.tab.telemetry'),
          desc: t('debug.center.workspace.desc.telemetry'),
        },
        {
          id: 'magnets' as const,
          label: t('debug.center.workspace.tab.magnets'),
          desc: t('debug.center.workspace.desc.magnets'),
        },
        {
          id: 'memory' as const,
          label: t('debug.center.workspace.tab.memory'),
          desc: t('debug.center.workspace.desc.memory'),
        },
      ] satisfies Array<{ id: DebugWorkspaceId; label: string; desc: string }>,
    [t]
  );
  const activeWorkspaceOption = useMemo(
    () => workspaceOptions.find((option) => option.id === activeWorkspace) ?? workspaceOptions[0],
    [activeWorkspace, workspaceOptions]
  );
  const qrAuthConnectorDefinitions = useMemo(
    () =>
      platformConnectorDefinitions.filter(
        (definition) => definition.enabled !== false && definition.authFlow === 'qr'
      ),
    [platformConnectorDefinitions]
  );
  const selectedAuthConnectorDefinition = useMemo(
    () =>
      qrAuthConnectorDefinitions.find(
        (definition) => definition.connectorId === selectedAuthConnectorId
      ) ??
      qrAuthConnectorDefinitions[0] ??
      null,
    [qrAuthConnectorDefinitions, selectedAuthConnectorId]
  );
  const selectedAuthConnectorDisplayName = useMemo(() => {
    const snapshotDisplayName = platformAuthStatus?.displayName?.trim();
    if (snapshotDisplayName) return snapshotDisplayName;
    const definitionDisplayName = selectedAuthConnectorDefinition?.displayName?.trim();
    if (definitionDisplayName) return definitionDisplayName;
    const connectorId = selectedAuthConnectorDefinition?.connectorId?.trim() ?? '';
    return connectorId.replace(/^connector\.platform\./, '') || 'Platform';
  }, [platformAuthStatus?.displayName, selectedAuthConnectorDefinition]);
  const selectedAuthInstanceId = useMemo(
    () =>
      selectedAuthConnectorDefinition
        ? resolvePlatformInstanceId({
            connectorId: selectedAuthConnectorDefinition.connectorId,
          }) ?? null
        : null,
    [selectedAuthConnectorDefinition]
  );

  useEffect(() => {
    setTelemetrySnapshot(telemetryService.getSnapshot());
    return telemetryService.subscribe((snapshot: TelemetrySnapshot) => {
      setTelemetrySnapshot(snapshot);
    });
  }, [telemetryService]);

  useEffect(() => {
    setPlatformConnectorDefinitions(listPlatformConnectorDefinitions());
    return subscribePlatformConnectorDefinitions((definitions) => {
      setPlatformConnectorDefinitions(definitions);
    });
  }, []);

  useEffect(() => {
    setPlatformPackStartupHealth(getPlatformPackStartupHealth());
    return subscribePlatformPackStartupHealth((health) => {
      setPlatformPackStartupHealth(health);
    });
  }, []);

  const refreshPlatformPackDoctor = useCallback(async () => {
    setPlatformPackDoctorBusy(true);
    setPlatformPackDoctorError(null);
    try {
      const report = await inspectPlatformPackDoctor();
      setPlatformPackDoctorReport(report);
    } catch (error) {
      setPlatformPackDoctorReport(null);
      setPlatformPackDoctorError(error instanceof Error ? error.message : String(error));
    } finally {
      setPlatformPackDoctorBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshPlatformPackDoctor();
  }, [
    refreshPlatformPackDoctor,
    platformPackStartupHealth.currentStage,
    platformPackStartupHealth.registeredBuiltinCount,
  ]);

  useEffect(() => {
    setSelectedAuthConnectorId((current) =>
      resolvePreferredDebugConnectorId(current, qrAuthConnectorDefinitions)
    );
  }, [qrAuthConnectorDefinitions]);

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
    const service = MusicLibraryService.getInstance();
    const coverStats = service.getCoverRuntimeCacheStats();
    setCoverCacheStats(coverStats);
    setMusicLibrarySnapshot(getLatestMusicLibraryRuntimeSnapshot());

    if (!isTauri) {
      setDesktopCoverLeaseStats(null);
      setEditorWindowsState(null);
      return;
    }

    setDesktopCoverLeaseStats(await service.getDesktopCoverLeaseStats());

    try {
      const state = await invokeWithTelemetry<EditorWindowsDebugState>(
        'debug_get_editor_windows_state',
        undefined,
        {
          moduleId: 'debug',
          component: 'DebugCenter',
          event: 'debug.editor-windows.state',
        }
      );
      setEditorWindowsState(state);
    } catch {
      setEditorWindowsState(null);
    }
  }, [isTauri]);

  const refreshTelemetryRuntime = useCallback(async () => {
    setError(null);
    try {
      const snapshot = await telemetryService.refreshRuntime();
      setTelemetrySnapshot(snapshot);
      setStatusMessage('Telemetry runtime refreshed.');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [telemetryService]);

  const flushTelemetryRuntime = useCallback(async () => {
    setError(null);
    try {
      await telemetryService.flushNow();
      setStatusMessage('Telemetry queue flushed.');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [telemetryService]);

  const clearTelemetryRuntimeSession = useCallback(async () => {
    setError(null);
    try {
      await telemetryService.clearSession();
      setTelemetryQueryResult(null);
      setTelemetryQueryError(null);
      setStatusMessage('Telemetry session cleared.');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [telemetryService]);

  const runTelemetryPresetQuery = useCallback(
    async (presetId: TelemetryAiContextPresetId) => {
      setTelemetryQueryPresetId(presetId);
      if (!isTauri) {
        setTelemetryQueryResult(null);
        setTelemetryQueryError(t('debug.center.telemetry.query.unavailable'));
        return;
      }

      setTelemetryQueryBusy(true);
      setTelemetryQueryError(null);
      try {
        const preset = getTelemetryAiContextPreset(presetId);
        const result = await queryTelemetryCurrentSession(preset.query);
        if (!result) {
          throw new Error(t('debug.center.telemetry.query.failed'));
        }
        setTelemetryQueryResult(result);
      } catch (queryError) {
        setTelemetryQueryResult(null);
        setTelemetryQueryError(
          queryError instanceof Error ? queryError.message : t('debug.center.telemetry.query.failed')
        );
      } finally {
        setTelemetryQueryBusy(false);
      }
    },
    [isTauri, t]
  );

  const refreshTelemetryPresetQuery = useCallback(async () => {
    await runTelemetryPresetQuery(telemetryQueryPresetId);
  }, [runTelemetryPresetQuery, telemetryQueryPresetId]);

  useEffect(() => {
    if (!isTauri) return;
    void runTelemetryPresetQuery('plugins');
  }, [isTauri, runTelemetryPresetQuery]);

  const refreshSyncOrchestrator = useCallback(async () => {
    if (!isTauri) {
      setSyncStatus(null);
      setSyncSchedulerStatus(null);
      setSyncFailureOverview(null);
      return;
    }

    const service = MusicLibraryService.getInstance();
    const [status, schedulerStatus, failureOverview] = await Promise.all([
      service.getSyncOrchestratorStatus(),
      service.getSyncSchedulerStatus(),
      service.getSyncFailureOverview(200),
    ]);

    setSyncStatus(status);
    setSyncSchedulerStatus(schedulerStatus);
    setSyncFailureOverview(failureOverview);
    if (typeof schedulerStatus?.intervalMs === 'number' && Number.isFinite(schedulerStatus.intervalMs)) {
      setSyncSchedulerIntervalMs(Math.max(5_000, Math.floor(schedulerStatus.intervalMs)));
    }
  }, [isTauri]);

  const runSyncTick = useCallback(async () => {
    if (!isTauri || syncBusy) return;
    setSyncBusy(true);
    setError(null);

    try {
      const service = MusicLibraryService.getInstance();
      const result = await service.runSyncOrchestratorTick('debug-manual');
      if (!result) {
        setError(t('debug.center.sync.status.actionFailed'));
        return;
      }

      setLastSyncTickResult(result);
      setStatusMessage(
        t('debug.center.sync.status.tickDone', {
          scanned: result.scannedSources,
          changed: result.changedSources,
          queued: result.enqueuedMetadataJobs,
        })
      );
      await refreshSyncOrchestrator();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debug.center.sync.status.actionFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [isTauri, refreshSyncOrchestrator, syncBusy, t]);

  const startSyncScheduler = useCallback(async () => {
    if (!isTauri || syncBusy) return;
    setSyncBusy(true);
    setError(null);

    try {
      const intervalMs = Math.max(5_000, Math.min(60 * 60 * 1_000, Math.floor(syncSchedulerIntervalMs)));
      const service = MusicLibraryService.getInstance();
      const status = await service.startSyncScheduler(intervalMs);
      if (!status) {
        setError(t('debug.center.sync.status.actionFailed'));
        return;
      }

      setSyncSchedulerStatus(status);
      setStatusMessage(t('debug.center.sync.status.schedulerStarted', { intervalMs: status.intervalMs }));
      await refreshSyncOrchestrator();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debug.center.sync.status.actionFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [isTauri, refreshSyncOrchestrator, syncBusy, syncSchedulerIntervalMs, t]);

  const stopSyncScheduler = useCallback(async () => {
    if (!isTauri || syncBusy) return;
    setSyncBusy(true);
    setError(null);

    try {
      const service = MusicLibraryService.getInstance();
      const status = await service.stopSyncScheduler();
      if (!status) {
        setError(t('debug.center.sync.status.actionFailed'));
        return;
      }

      setSyncSchedulerStatus(status);
      setStatusMessage(t('debug.center.sync.status.schedulerStopped'));
      await refreshSyncOrchestrator();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debug.center.sync.status.actionFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [isTauri, refreshSyncOrchestrator, syncBusy, t]);

  const retrySyncFailedSources = useCallback(async () => {
    if (!isTauri || syncBusy) return;
    setSyncBusy(true);
    setError(null);

    try {
      const sourceIds =
        selectedSyncFailureSourceIds.length > 0 ? selectedSyncFailureSourceIds : undefined;
      const service = MusicLibraryService.getInstance();
      const result = await service.retrySyncFailedSources({
        sourceIds,
        reason: 'debug-retry-failed-sources',
      });
      if (!result) {
        setError(t('debug.center.sync.status.actionFailed'));
        return;
      }

      setLastSyncTickResult(result.tickResult);
      setStatusMessage(
        t('debug.center.sync.status.retryDone', {
          cleared: result.clearedSources,
          selected: sourceIds?.length ?? 0,
          scanned: result.tickResult.scannedSources,
          changed: result.tickResult.changedSources,
        })
      );
      await refreshSyncOrchestrator();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debug.center.sync.status.actionFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [isTauri, refreshSyncOrchestrator, selectedSyncFailureSourceIds, syncBusy, t]);

  const clearSyncFailedSources = useCallback(async () => {
    if (!isTauri || syncBusy) return;
    setSyncBusy(true);
    setError(null);

    try {
      const sourceIds =
        selectedSyncFailureSourceIds.length > 0 ? selectedSyncFailureSourceIds : undefined;
      const service = MusicLibraryService.getInstance();
      const result = await service.clearSyncFailedSources({
        sourceIds,
      });
      if (!result) {
        setError(t('debug.center.sync.status.actionFailed'));
        return;
      }

      setStatusMessage(
        t('debug.center.sync.status.clearDone', {
          cleared: result.clearedSources,
          selected: sourceIds?.length ?? 0,
        })
      );
      await refreshSyncOrchestrator();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debug.center.sync.status.actionFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [isTauri, refreshSyncOrchestrator, selectedSyncFailureSourceIds, syncBusy, t]);

  const refreshUnifiedSources = useCallback(async () => {
    if (!isTauri) {
      setUnifiedSources([]);
      return;
    }

    try {
      const service = MusicLibraryService.getInstance();
      const items = await service.listUnifiedMusicSources();
      setUnifiedSources(items);
    } catch {
      setUnifiedSources([]);
    }
  }, [isTauri]);

  const runUnifiedSearch = useCallback(async () => {
    if (!isTauri || unifiedBusy) return;
    const query = unifiedSearchQuery.trim();
    if (!query) {
      setUnifiedSearchResults([]);
      return;
    }

    setUnifiedBusy(true);
    try {
      const service = MusicLibraryService.getInstance();
      const items = await service.searchUnifiedTracks({ query, limit: 30 });
      setUnifiedSearchResults(items);
    } catch {
      setUnifiedSearchResults([]);
    } finally {
      setUnifiedBusy(false);
    }
  }, [isTauri, unifiedBusy, unifiedSearchQuery]);

  const resolveSelectedPlatformInstanceId = useCallback(
    (preferredInstanceId?: string | null) => {
      const connectorId = selectedAuthConnectorDefinition?.connectorId ?? null;
      if (!connectorId) return null;

      const explicitInstanceId =
        typeof preferredInstanceId === 'string' ? preferredInstanceId.trim() : '';
      return (
        resolvePlatformInstanceId({
          instanceId: explicitInstanceId || null,
          connectorId,
        }) ?? null
      );
    },
    [selectedAuthConnectorDefinition?.connectorId]
  );

  const refreshSelectedPlatformAuthStatus = useCallback(async () => {
    if (!isTauri || !selectedAuthConnectorDefinition) {
      setPlatformAuthStatus(null);
      return;
    }

    const instanceId = resolveSelectedPlatformInstanceId();
    if (!instanceId) {
      setPlatformAuthStatus(null);
      return;
    }

    try {
      const status =
        (await refreshPlatformInstanceAuthSnapshot(instanceId)) ??
        getPlatformInstanceAuthSnapshot(instanceId);
      setPlatformAuthStatus(status);
    } catch {
      setPlatformAuthStatus(getPlatformInstanceAuthSnapshot(instanceId));
    }
  }, [isTauri, resolveSelectedPlatformInstanceId, selectedAuthConnectorDefinition]);

  const pollSelectedPlatformQrSession = useCallback(
    async (sessionId?: string) => {
      if (!isTauri || platformAuthBusy) return;

      const targetSessionId = (sessionId ?? platformQrSession?.sessionId ?? '').trim();
      const targetInstanceId = resolveSelectedPlatformInstanceId(platformQrSession?.instanceId);
      if (!targetSessionId || !targetInstanceId) return;

      setPlatformAuthBusy(true);
      try {
        const result = await pollPlatformInstanceQrLogin(targetInstanceId, targetSessionId);
        setPlatformQrPollResult(result);

        if (!result) {
          setError(
            t('debug.center.sourceFacade.auth.pollFailed', {
              platform: selectedAuthConnectorDisplayName,
            })
          );
          return;
        }

        if (result.state === 'authorized') {
          setStatusMessage(
            t('debug.center.sourceFacade.auth.authorized', {
              platform: selectedAuthConnectorDisplayName,
              accountUid: result.accountUid ?? '-',
            })
          );
          setPlatformQrSession(null);
          await refreshUnifiedSources();
        }

        if (
          result.state === 'authorized' ||
          result.state === 'expired' ||
          result.state === 'failed'
        ) {
          setPlatformQrSession(null);
        }

        await refreshSelectedPlatformAuthStatus();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('debug.center.sourceFacade.auth.pollFailed', {
                platform: selectedAuthConnectorDisplayName,
              })
        );
      } finally {
        setPlatformAuthBusy(false);
      }
    },
    [
      isTauri,
      platformAuthBusy,
      platformQrSession?.instanceId,
      platformQrSession?.sessionId,
      refreshSelectedPlatformAuthStatus,
      refreshUnifiedSources,
      resolveSelectedPlatformInstanceId,
      selectedAuthConnectorDisplayName,
      t,
    ]
  );

  const generateSelectedPlatformQrSession = useCallback(async () => {
    if (!isTauri || platformAuthBusy) return;

    setPlatformAuthBusy(true);
    try {
      const instanceId = resolveSelectedPlatformInstanceId();
      if (!instanceId) {
        setError(
          t('debug.center.sourceFacade.auth.generateFailed', {
            platform: selectedAuthConnectorDisplayName,
          })
        );
        return;
      }

      const session = await beginPlatformInstanceQrLogin(instanceId);
      if (!session) {
        setError(
          t('debug.center.sourceFacade.auth.generateFailed', {
            platform: selectedAuthConnectorDisplayName,
          })
        );
        return;
      }

      setPlatformQrSession(session);
      setPlatformQrPollResult(null);
      setStatusMessage(
        t('debug.center.sourceFacade.auth.generated', {
          platform: selectedAuthConnectorDisplayName,
        })
      );
      await refreshSelectedPlatformAuthStatus();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('debug.center.sourceFacade.auth.generateFailed', {
              platform: selectedAuthConnectorDisplayName,
            })
      );
    } finally {
      setPlatformAuthBusy(false);
    }
  }, [
    isTauri,
    platformAuthBusy,
    refreshSelectedPlatformAuthStatus,
    resolveSelectedPlatformInstanceId,
    selectedAuthConnectorDisplayName,
    t,
  ]);

  const logoutSelectedPlatformAuth = useCallback(async () => {
    if (!isTauri || platformAuthBusy) return;

    setPlatformAuthBusy(true);
    try {
      const instanceId = resolveSelectedPlatformInstanceId();
      if (!instanceId) {
        setPlatformAuthStatus(null);
        setPlatformQrSession(null);
        setPlatformQrPollResult(null);
        setStatusMessage(
          t('debug.center.sourceFacade.auth.loggedOut', {
            platform: selectedAuthConnectorDisplayName,
          })
        );
        return;
      }

      const status = await logoutPlatformInstance(instanceId);
      setPlatformAuthStatus(status);
      setPlatformQrSession(null);
      setPlatformQrPollResult(null);
      setStatusMessage(
        t('debug.center.sourceFacade.auth.loggedOut', {
          platform: selectedAuthConnectorDisplayName,
        })
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('debug.center.sourceFacade.auth.logoutFailed', {
              platform: selectedAuthConnectorDisplayName,
            })
      );
    } finally {
      setPlatformAuthBusy(false);
    }
  }, [
    isTauri,
    platformAuthBusy,
    resolveSelectedPlatformInstanceId,
    selectedAuthConnectorDisplayName,
    t,
  ]);

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
      processTotals = await (
        getGlobalProcessPerfService()?.refreshTotalsSnapshot() ??
        getProcessPerfTotalsSnapshot()
      );
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
    setPendingAutoWriteScenarioId(null);
    setThreeStageBaselineRunning(true);

    for (const [index, item] of THREE_STAGE_CAPTURE_PLAN.entries()) {
      const isLast = index === THREE_STAGE_CAPTURE_PLAN.length - 1;
      const timer = window.setTimeout(() => {
        void captureMemoryBaseline({ stage: item.stage, scenarioId }).finally(() => {
          if (isLast) {
            setThreeStageBaselineRunning(false);
            setPendingAutoWriteScenarioId(scenarioId);
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
    setPendingAutoWriteScenarioId(null);
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
    void refreshSyncOrchestrator();
    if (!isTauri) return;

    const timer = window.setInterval(() => {
      void refreshSyncOrchestrator();
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isTauri, refreshSyncOrchestrator]);

  useEffect(() => {
    void refreshUnifiedSources();
    if (!isTauri) return;

    const timer = window.setInterval(() => {
      void refreshUnifiedSources();
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isTauri, refreshUnifiedSources]);

  useEffect(() => {
    setPlatformAuthStatus(null);
    setPlatformQrSession(null);
    setPlatformQrPollResult(null);
  }, [selectedAuthConnectorDefinition?.connectorId]);

  useEffect(() => {
    void refreshSelectedPlatformAuthStatus();
    if (!isTauri) return;

    const timer = window.setInterval(() => {
      void refreshSelectedPlatformAuthStatus();
    }, 20_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isTauri, refreshSelectedPlatformAuthStatus]);

  useEffect(() => {
    if (!isTauri) return;
    const sessionId = platformQrSession?.sessionId;
    if (!sessionId) return;

    const timer = window.setInterval(() => {
      void pollSelectedPlatformQrSession(sessionId);
    }, 1_800);

    return () => {
      window.clearInterval(timer);
    };
  }, [platformQrSession?.sessionId, isTauri, pollSelectedPlatformQrSession]);

  useEffect(() => {
    if (!isTauri) return;

    let active = true;
    let unlisten: (() => void) | null = null;

    void setupTauriListenerWithPayload<MusicLibrarySyncStatusEventPayload>(
      TAURI_EVENTS.MUSIC_LIBRARY_SYNC_STATUS_UPDATED,
      (payload) => {
        if (!active || !payload) return;

        if (payload.syncStatus) {
          setSyncStatus(payload.syncStatus);
        }

        if (payload.schedulerStatus) {
          setSyncSchedulerStatus(payload.schedulerStatus);
          if (
            typeof payload.schedulerStatus.intervalMs === 'number' &&
            Number.isFinite(payload.schedulerStatus.intervalMs)
          ) {
            setSyncSchedulerIntervalMs(
              Math.max(5_000, Math.floor(payload.schedulerStatus.intervalMs))
            );
          }
        }

        if (payload.tickResult) {
          setLastSyncTickResult(payload.tickResult);

          void MusicLibraryService.getInstance()
            .getSyncFailureOverview(200)
            .then((overview) => {
              if (!active) return;
              setSyncFailureOverview(overview);
            })
            .catch(() => {
              if (!active) return;
              setSyncFailureOverview(null);
            });
        }
      }
    ).then((off) => {
      if (!active) {
        off();
        return;
      }
      unlisten = off;
    });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isTauri]);

  useEffect(() => {
    return () => {
      clearThreeStageCaptureTimers();
    };
  }, [clearThreeStageCaptureTimers]);

  const scenarioComparisons = useMemo(
    () => computeScenarioComparisons(memoryBaselines),
    [memoryBaselines]
  );

  const latestThreeStageComparison = useMemo(() => {
    if (scenarioComparisons.length === 0) return null;
    if (!lastThreeStageScenarioId) return scenarioComparisons[0];
    return (
      scenarioComparisons.find((item) => item.scenarioId === lastThreeStageScenarioId) ??
      scenarioComparisons[0]
    );
  }, [lastThreeStageScenarioId, scenarioComparisons]);

  const latestThreeStageDelta = useMemo(() => {
    const comparison = latestThreeStageComparison;
    if (!comparison) return null;
    return {
      sampleCount: comparison.sampleCount,
      jsHeapDeltaMb: formatBytesToMb(comparison.deltaJsHeapUsedBytes),
      webview2PrivateDeltaMb: formatBytesToMb(comparison.deltaWebview2PrivateBytes),
      webview2WsDeltaMb: formatBytesToMb(comparison.deltaWebview2WorkingSetBytes),
      coverBlobDeltaMb: formatBytesToMb(comparison.deltaCoverBlobUrlTotalBytes),
      coverDecodedDeltaMb: formatBytesToMb(comparison.deltaCoverDecodedEstimateTotalBytes),
    };
  }, [latestThreeStageComparison]);

  const latestSyncTickResult = useMemo(
    () => lastSyncTickResult ?? syncSchedulerStatus?.lastTickResult ?? null,
    [lastSyncTickResult, syncSchedulerStatus?.lastTickResult]
  );

  const syncFailedSourceItems = useMemo<NativeLibrarySyncFailureSourceSummary[]>(
    () => syncFailureOverview?.items ?? [],
    [syncFailureOverview]
  );

  const selectedSyncFailureSourceIdSet = useMemo(
    () => new Set(selectedSyncFailureSourceIds),
    [selectedSyncFailureSourceIds]
  );

  const hasSelectedSyncFailureSources = selectedSyncFailureSourceIds.length > 0;

  useEffect(() => {
    if (syncFailedSourceItems.length === 0) {
      if (selectedSyncFailureSourceIds.length > 0) {
        setSelectedSyncFailureSourceIds([]);
      }
      return;
    }

    const availableSourceIds = new Set(syncFailedSourceItems.map((item) => item.sourceId));
    const nextSelected = selectedSyncFailureSourceIds.filter((sourceId) =>
      availableSourceIds.has(sourceId)
    );

    if (nextSelected.length !== selectedSyncFailureSourceIds.length) {
      setSelectedSyncFailureSourceIds(nextSelected);
    }
  }, [selectedSyncFailureSourceIds, syncFailedSourceItems]);

  const toggleSyncFailureSourceSelection = useCallback((sourceId: string) => {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) return;

    setSelectedSyncFailureSourceIds((prev) => {
      if (prev.includes(normalizedSourceId)) {
        return prev.filter((item) => item !== normalizedSourceId);
      }
      return [...prev, normalizedSourceId];
    });
  }, []);

  const selectAllSyncFailureSources = useCallback(() => {
    if (syncFailedSourceItems.length === 0) {
      setSelectedSyncFailureSourceIds([]);
      return;
    }
    setSelectedSyncFailureSourceIds(syncFailedSourceItems.map((item) => item.sourceId));
  }, [syncFailedSourceItems]);

  const clearSelectedSyncFailureSources = useCallback(() => {
    setSelectedSyncFailureSourceIds([]);
  }, []);

  const handleCopyLatestScenarioSummary = useCallback(async () => {
    const comparison = latestThreeStageComparison;
    if (!comparison) {
      setError(t('debug.center.memory.baselines.copySummary.emptyError'));
      setStatusMessage(null);
      return;
    }

    const summary = t('debug.center.memory.baselines.copySummary.line', {
      scenarioId: comparison.scenarioId,
      sampleCount: comparison.sampleCount,
      startAt: new Date(comparison.startAtMs).toLocaleString(),
      endAt: new Date(comparison.endAtMs).toLocaleString(),
      startStage: t(`debug.center.memory.baselines.stage.${comparison.startStage}`),
      endStage: t(`debug.center.memory.baselines.stage.${comparison.endStage}`),
      jsHeapDeltaMb: formatBytesToMb(comparison.deltaJsHeapUsedBytes),
      webview2PrivateDeltaMb: formatBytesToMb(comparison.deltaWebview2PrivateBytes),
      webview2WsDeltaMb: formatBytesToMb(comparison.deltaWebview2WorkingSetBytes),
      coverBlobDeltaMb: formatBytesToMb(comparison.deltaCoverBlobUrlTotalBytes),
      coverDecodedDeltaMb: formatBytesToMb(comparison.deltaCoverDecodedEstimateTotalBytes),
    });

    try {
      await navigator.clipboard.writeText(summary);
      setError(null);
      setStatusMessage(t('debug.center.memory.baselines.copySummary.copied'));
    } catch {
      setError(t('debug.center.memory.baselines.copySummary.copyFailed'));
      setStatusMessage(null);
    }
  }, [latestThreeStageComparison, t]);

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

  const saveDebugArtifact = useCallback(async (
    fileName: string,
    content: string,
    mimeType: string
  ) => {
    if (!isTauri) {
      downloadTextFile(fileName, content, mimeType);
      return { kind: 'download' as const, path: `downloads/${fileName}` };
    }

    const fs = await import('@tauri-apps/api/fs');
    const relativePath = `logs/${fileName}`;
    await fs.createDir('logs', { dir: fs.BaseDirectory.AppData, recursive: true });
    await fs.writeFile({ path: relativePath, contents: content }, { dir: fs.BaseDirectory.AppData });
    return { kind: 'saved' as const, path: `appData/${relativePath}` };
  }, [downloadTextFile, isTauri]);

  const beginTelemetryArtifactAction = useCallback((
    action: TelemetryArtifactAction,
    mode: 'copy' | 'export'
  ) => {
    const labelKey =
      action === 'session-json'
        ? 'debug.center.telemetry.artifacts.label.sessionJson'
        : action === 'scenario-report'
          ? 'debug.center.telemetry.artifacts.label.scenarioReport'
          : 'debug.center.telemetry.artifacts.label.aiContext';
    setTelemetryArtifactBusyAction(action);
    setTelemetryArtifactFeedback({
      tone: 'progress',
      message: t(
        mode === 'copy'
          ? 'debug.center.telemetry.artifacts.feedback.copying'
          : 'debug.center.telemetry.artifacts.feedback.exporting',
        { label: t(labelKey) }
      ),
    });
  }, [t]);

  const completeTelemetryArtifactAction = useCallback((
    action: TelemetryArtifactAction,
    message: string
  ) => {
    setTelemetryArtifactBusyAction((current) => (current === action ? null : current));
    setTelemetryArtifactFeedback({ tone: 'success', message });
    setError(null);
    setStatusMessage(message);
  }, []);

  const failTelemetryArtifactAction = useCallback((
    action: TelemetryArtifactAction,
    mode: 'copy' | 'export',
    err: unknown
  ) => {
    const message = err instanceof Error ? err.message : String(err);
    setTelemetryArtifactBusyAction((current) => (current === action ? null : current));
    setTelemetryArtifactFeedback({
      tone: 'error',
      message: t(
        mode === 'copy'
          ? 'debug.center.telemetry.artifacts.feedback.copyFailed'
          : 'debug.center.telemetry.artifacts.feedback.exportFailed',
        { message }
      ),
    });
    setStatusMessage(null);
    setError(message);
  }, [t]);

  const handleExportTelemetrySessionJson = useCallback(async () => {
    const action: TelemetryArtifactAction = 'session-json';
    setError(null);
    beginTelemetryArtifactAction(action, 'export');
    try {
      const session = await readCurrentTelemetrySession();
      if (!session || session.records.length === 0) {
        const message = t('debug.center.telemetry.artifacts.feedback.sessionEmpty', {
          label: t('debug.center.telemetry.artifacts.label.sessionJson'),
        });
        setTelemetryArtifactBusyAction(null);
        setTelemetryArtifactFeedback({ tone: 'error', message });
        setStatusMessage(null);
        setError(message);
        return;
      }

      const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sanitizeFileSegment(session.status.currentSessionId, 'session');
      const content = JSON.stringify(session, null, 2);
      const fileName = `telemetry-session-${safeTs}-${safeSessionId}.json`;
      const result = await saveDebugArtifact(fileName, content, 'application/json;charset=utf-8');
      completeTelemetryArtifactAction(
        action,
        result.kind === 'saved'
          ? t('debug.center.telemetry.artifacts.feedback.exportedTo', {
              label: t('debug.center.telemetry.artifacts.label.sessionJson'),
              path: result.path,
            })
          : t('debug.center.telemetry.artifacts.feedback.downloadStarted', {
              label: t('debug.center.telemetry.artifacts.label.sessionJson'),
            })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'export', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, saveDebugArtifact, t]);

  const handleExportTelemetryScenarioReport = useCallback(async () => {
    const action: TelemetryArtifactAction = 'scenario-report';
    setError(null);
    beginTelemetryArtifactAction(action, 'export');
    try {
      const session = await readCurrentTelemetrySession();
      if (!session || session.records.length === 0) {
        const message = t('debug.center.telemetry.artifacts.feedback.sessionEmpty', {
          label: t('debug.center.telemetry.artifacts.label.scenarioReport'),
        });
        setTelemetryArtifactBusyAction(null);
        setTelemetryArtifactFeedback({ tone: 'error', message });
        setStatusMessage(null);
        setError(message);
        return;
      }

      const perfTotals = isTauri
        ? await (
            getGlobalProcessPerfService()?.refreshTotalsSnapshot() ??
            getProcessPerfTotalsSnapshot()
          )
        : null;
      const report = buildTelemetryScenarioReport({ session, perfTotals });
      const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sanitizeFileSegment(session.status.currentSessionId, 'session');
      const fileName = `telemetry-scenario-${safeTs}-${safeSessionId}.md`;
      const result = await saveDebugArtifact(fileName, report, 'text/markdown;charset=utf-8');
      completeTelemetryArtifactAction(
        action,
        result.kind === 'saved'
          ? t('debug.center.telemetry.artifacts.feedback.exportedTo', {
              label: t('debug.center.telemetry.artifacts.label.scenarioReport'),
              path: result.path,
            })
          : t('debug.center.telemetry.artifacts.feedback.downloadStarted', {
              label: t('debug.center.telemetry.artifacts.label.scenarioReport'),
            })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'export', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, isTauri, saveDebugArtifact, t]);

  const loadTelemetryAiContextArtifact = useCallback(async (
    presetId: TelemetryAiContextPresetId = 'general'
  ): Promise<{
    preset: TelemetryAiContextPreset;
    query: TelemetryQueryInput;
    report: string;
    sessionId: string;
  }> => {
    const preset = getTelemetryAiContextPreset(presetId);
    const query = preset.query;
    const result = await queryTelemetryCurrentSession(query);
    if (!result || result.matchedRecordCount === 0) {
      throw new Error('Telemetry AI context is empty.');
    }

    const perfTotals = isTauri
      ? await (
          getGlobalProcessPerfService()?.refreshTotalsSnapshot() ??
          getProcessPerfTotalsSnapshot()
        )
      : null;
    const report = buildTelemetryAiContextReport({
      query,
      result,
      perfTotals,
    });

    return {
      preset,
      query,
      report,
      sessionId: result.status.currentSessionId,
    };
  }, [isTauri]);

  const handleCopyTelemetryAiContext = useCallback(async (
    presetId: TelemetryAiContextPresetId = 'general'
  ) => {
    const action: TelemetryArtifactAction = 'copy-ai-context';
    setError(null);
    beginTelemetryArtifactAction(action, 'copy');
    try {
      const artifact = await loadTelemetryAiContextArtifact(presetId);
      await navigator.clipboard.writeText(artifact.report);
      completeTelemetryArtifactAction(
        action,
        t('debug.center.telemetry.artifacts.feedback.copiedFromSession', {
          label: t('debug.center.telemetry.artifacts.label.aiContext'),
          sessionId: artifact.sessionId,
        })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'copy', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, loadTelemetryAiContextArtifact, t]);

  const handleExportTelemetryAiContext = useCallback(async (
    presetId: TelemetryAiContextPresetId = 'general'
  ) => {
    const action: TelemetryArtifactAction = 'export-ai-context';
    setError(null);
    beginTelemetryArtifactAction(action, 'export');
    try {
      const artifact = await loadTelemetryAiContextArtifact(presetId);
      const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sanitizeFileSegment(artifact.sessionId, 'session');
      const fileName = `telemetry-${artifact.preset.fileStem}-${safeTs}-${safeSessionId}.md`;
      const result = await saveDebugArtifact(fileName, artifact.report, 'text/markdown;charset=utf-8');
      completeTelemetryArtifactAction(
        action,
        result.kind === 'saved'
          ? t('debug.center.telemetry.artifacts.feedback.exportedTo', {
              label: t('debug.center.telemetry.artifacts.label.aiContext'),
              path: result.path,
            })
          : t('debug.center.telemetry.artifacts.feedback.downloadStarted', {
              label: t('debug.center.telemetry.artifacts.label.aiContext'),
            })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'export', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, loadTelemetryAiContextArtifact, saveDebugArtifact, t]);

  const handleExportBaselinesJson = useCallback(() => {
    if (memoryBaselines.length === 0) {
      setError(t('debug.center.memory.baselines.export.emptyError'));
      setStatusMessage(null);
      return;
    }

    const payload = buildMemoryBaselineExportPayload(memoryBaselines);
    const json = JSON.stringify(payload, null, 2);
    downloadTextFile(
      `memory-baselines-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      json,
      'application/json;charset=utf-8'
    );
    setError(null);
    setStatusMessage(t('debug.center.memory.baselines.export.jsonDone'));
  }, [downloadTextFile, memoryBaselines, t]);

  const handleExportBaselinesCsv = useCallback(() => {
    if (memoryBaselines.length === 0) {
      setError(t('debug.center.memory.baselines.export.emptyError'));
      setStatusMessage(null);
      return;
    }

    const payload = buildMemoryBaselineExportPayload(memoryBaselines);
    const csv = buildMemoryBaselineCsv(payload);
    downloadTextFile(
      `memory-baselines-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
      csv,
      'text/csv;charset=utf-8'
    );
    setError(null);
    setStatusMessage(t('debug.center.memory.baselines.export.csvDone'));
  }, [downloadTextFile, memoryBaselines, t]);

  const handleWriteLatestScenarioReport = useCallback(async (options?: {
    scenarioId?: string;
    suppressEmptyError?: boolean;
  }) => {
    const comparison = options?.scenarioId
      ? scenarioComparisons.find((item) => item.scenarioId === options.scenarioId) ?? null
      : latestThreeStageComparison;
    if (!comparison) {
      if (!options?.suppressEmptyError) {
        setError(t('debug.center.memory.baselines.writeReport.emptyError'));
        setStatusMessage(null);
      }
      return;
    }

    const commitFromEnv = shortCommitHash(resolveCommitHash(envSnapshot));
    const recentCommits = await getRecentGitCommits(3).catch(() => []);
    const commit =
      recentCommits.length > 0
        ? shortCommitHash(recentCommits[0]?.shortHash || recentCommits[0]?.hash || commitFromEnv)
        : commitFromEnv;
    const reportAtMs = Date.now();
    const reportAtIso = new Date(reportAtMs).toISOString();
    const scenarioSamples = memoryBaselines
      .filter((item) => item.scenarioId === comparison.scenarioId)
      .slice()
      .sort((left, right) => left.capturedAtMs - right.capturedAtMs);

    const summaryLine = t('debug.center.memory.baselines.copySummary.line', {
      scenarioId: comparison.scenarioId,
      sampleCount: comparison.sampleCount,
      startAt: new Date(comparison.startAtMs).toLocaleString(),
      endAt: new Date(comparison.endAtMs).toLocaleString(),
      startStage: t(`debug.center.memory.baselines.stage.${comparison.startStage}`),
      endStage: t(`debug.center.memory.baselines.stage.${comparison.endStage}`),
      jsHeapDeltaMb: formatBytesToMb(comparison.deltaJsHeapUsedBytes),
      webview2PrivateDeltaMb: formatBytesToMb(comparison.deltaWebview2PrivateBytes),
      webview2WsDeltaMb: formatBytesToMb(comparison.deltaWebview2WorkingSetBytes),
      coverBlobDeltaMb: formatBytesToMb(comparison.deltaCoverBlobUrlTotalBytes),
      coverDecodedDeltaMb: formatBytesToMb(comparison.deltaCoverDecodedEstimateTotalBytes),
    });

    const lines: string[] = [
      '# PMP Memory Baseline Scenario Report',
      '',
      `- generated_at: ${reportAtIso}`,
      `- commit: ${commit}`,
      `- scenario_id: ${comparison.scenarioId}`,
      `- sample_count: ${comparison.sampleCount}`,
      '',
      '## Recent Git Commits (best-effort)',
      '',
      ...(recentCommits.length > 0
        ? recentCommits.map(
            (item) =>
              `- ${shortCommitHash(item.shortHash || item.hash)} @ ${item.committedAtIso} :: ${item.subject}`
          )
        : ['- unavailable']),
      '',
      '## Summary',
      '',
      summaryLine,
      '',
      '## Deltas (bytes)',
      '',
      `- navigation_history_bytes: ${comparison.deltaNavigationHistoryBytes}`,
      `- cover_blob_bytes: ${comparison.deltaCoverBlobUrlTotalBytes}`,
      `- cover_decoded_bytes: ${comparison.deltaCoverDecodedEstimateTotalBytes}`,
      `- js_heap_bytes: ${comparison.deltaJsHeapUsedBytes ?? 'n/a'}`,
      `- webview2_private_bytes: ${comparison.deltaWebview2PrivateBytes ?? 'n/a'}`,
      `- webview2_working_set_bytes: ${comparison.deltaWebview2WorkingSetBytes ?? 'n/a'}`,
      `- tree_private_bytes: ${comparison.deltaTreePrivateBytes ?? 'n/a'}`,
      `- tree_working_set_bytes: ${comparison.deltaTreeWorkingSetBytes ?? 'n/a'}`,
      '',
      '## Samples',
      '',
      '| stage | captured_at | js_heap_mb | webview2_private_mb | webview2_ws_mb | cover_blob_mb | cover_decoded_mb |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...scenarioSamples.map(
        (sample) =>
          `| ${sample.stage} | ${new Date(sample.capturedAtMs).toISOString()} | ${formatBytesToMb(
            sample.jsHeapUsedBytes
          )} | ${formatBytesToMb(sample.webview2PrivateBytes)} | ${formatBytesToMb(
            sample.webview2WorkingSetBytes
          )} | ${formatBytesToMb(sample.coverBlobUrlTotalBytes)} | ${formatBytesToMb(
            sample.coverDecodedEstimateTotalBytes
          )} |`
      ),
      '',
    ];

    const reportText = lines.join('\n');
    const safeTs = new Date(reportAtMs).toISOString().replace(/[:.]/g, '-');
    const safeScenario = sanitizeFileSegment(comparison.scenarioId, 'scenario');
    const safeCommit = sanitizeFileSegment(commit, 'unknown');
    const fileName = `memory-baseline-${safeTs}-${safeScenario}-${safeCommit}.md`;

    if (isTauri) {
      try {
        const fs = await import('@tauri-apps/api/fs');
        const relativePath = `logs/${fileName}`;
        await fs.createDir('logs', { dir: fs.BaseDirectory.AppData, recursive: true });
        await fs.writeFile({ path: relativePath, contents: reportText }, { dir: fs.BaseDirectory.AppData });
        setError(null);
        setStatusMessage(
          t('debug.center.memory.baselines.writeReport.saved', {
            path: relativePath,
            commit,
          })
        );
        return;
      } catch {
        setError(t('debug.center.memory.baselines.writeReport.failed'));
        setStatusMessage(null);
        return;
      }
    }

    downloadTextFile(fileName, reportText, 'text/markdown;charset=utf-8');
    setError(null);
    setStatusMessage(t('debug.center.memory.baselines.writeReport.downloaded', { commit }));
  }, [
    downloadTextFile,
    envSnapshot,
    isTauri,
    latestThreeStageComparison,
    memoryBaselines,
    scenarioComparisons,
    t,
  ]);

  useEffect(() => {
    if (!isTauri) return;
    if (!pendingAutoWriteScenarioId) return;

    const target = scenarioComparisons.find((item) => item.scenarioId === pendingAutoWriteScenarioId);
    if (!target || target.sampleCount < THREE_STAGE_CAPTURE_PLAN.length) return;

    setPendingAutoWriteScenarioId(null);
    void handleWriteLatestScenarioReport({
      scenarioId: target.scenarioId,
      suppressEmptyError: true,
    });
  }, [
    handleWriteLatestScenarioReport,
    isTauri,
    pendingAutoWriteScenarioId,
    scenarioComparisons,
  ]);

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
      await dispatchRequiredCommand(
        commands,
        'app:open-debug-editor-window',
        'Debug editor command service is not available.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [commands]);

  const handleOpenVstManager = useCallback(async () => {
    try {
      await dispatchRequiredCommand(
        commands,
        'app:open-vst3-plugin-manager',
        'VST3 Plugin Manager command service is not available.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [commands]);

  const handleOpenPerfMonitor = useCallback(async () => {
    try {
      await dispatchRequiredCommand(
        commands,
        'app:navigate-perf-monitor',
        'Performance Monitor command service is not available.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [commands]);

  const handleOpenNativeDebug = useCallback(async () => {
    try {
      await dispatchRequiredCommand(
        commands,
        'app:navigate-native-debug',
        'Native Debug command service is not available.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [commands]);

  const handleOpenDspRack = useCallback(async () => {
    try {
      await dispatchRequiredCommand(
        commands,
        'app:navigate-dsp-rack',
        'DSP Rack command service is not available.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [commands]);

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

      try {
        await restartApp();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [config, isTauri]
  );

  const headerActions = (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <SettingsActionButton type="button" onClick={() => setConfirmRestart(true)} disabled={!isTauri}>
        {t('debug.center.actions.restart')}
      </SettingsActionButton>
      <SettingsActionButton
        type="button"
        onClick={() => setConfirmRestartIntoDebug(true)}
        disabled={!isTauri}
      >
        {t('debug.center.actions.restartAndOpen')}
      </SettingsActionButton>
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
        <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.workspace.label')}</p>
              <p className="settings-card-desc">{t('debug.center.workspace.desc')}</p>
            </div>
            <span className="settings-card-badge">{activeWorkspaceOption?.label ?? '-'}</span>
          </div>

          <SettingsToggleGroup className="settings-toggle debug-center-workspace-toggle">
            {workspaceOptions.map((option) => (
              <SettingsToggleButton
                key={option.id}
                type="button"
                active={activeWorkspace === option.id}
                onClick={() => setActiveWorkspace(option.id)}
              >
                {option.label}
              </SettingsToggleButton>
            ))}
          </SettingsToggleGroup>

          <p className="settings-card-note">{activeWorkspaceOption?.desc ?? ''}</p>
        </SettingsCard>

        {activeWorkspace === 'overview' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.mode.label')}</p>
              <p className="settings-card-desc">{t('debug.center.mode.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {config.enabled ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>

          <SettingsToggleGroup>
            <SettingsToggleButton
              type="button"
              active={!config.enabled}
              onClick={() => updateConfig((prev) => ({ ...prev, enabled: false }))}
            >
              {t('common.state.off')}
            </SettingsToggleButton>
            <SettingsToggleButton
              type="button"
              active={config.enabled}
              onClick={() => updateConfig((prev) => ({ ...prev, enabled: true }))}
            >
              {t('common.state.on')}
            </SettingsToggleButton>
          </SettingsToggleGroup>

          {pendingRestart ? <p className="settings-card-note">{t('debug.center.mode.note.restartRequired')}</p> : null}
          {busy ? <p className="settings-card-note">{t('debug.center.mode.note.saving')}</p> : null}
          {statusMessage ? (
            <p className="settings-card-note" style={{ color: 'rgba(140,255,190,0.9)' }}>
              {statusMessage}
            </p>
          ) : null}
          {error ? <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.9)' }}>{error}</p> : null}
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'platforms' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.sourceFacade.title')}</p>
              <p className="settings-card-desc">{t('debug.center.sourceFacade.desc')}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void refreshUnifiedSources();
                }}
                disabled={unifiedBusy}
              >
                {t('common.action.refresh')}
              </SettingsActionButton>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <p className="settings-card-note">
              {t('debug.center.sourceFacade.summary', { total: unifiedSources.length })}
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                type="text"
                value={unifiedSearchQuery}
                onChange={(event) => {
                  setUnifiedSearchQuery(event.target.value);
                }}
                placeholder={t('debug.center.sourceFacade.searchPlaceholder')}
                style={{
                  minWidth: 260,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(0,0,0,0.18)',
                  color: 'rgba(255,255,255,0.9)',
                }}
              />
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void runUnifiedSearch();
                }}
                disabled={unifiedBusy}
              >
                {t('debug.center.sourceFacade.searchAction')}
              </SettingsActionButton>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(0,0,0,0.18)',
              }}
            >
              <p className="settings-card-note">{t('debug.center.sourceFacade.auth.title')}</p>
              {qrAuthConnectorDefinitions.length > 1 ? (
                <SettingsToggleGroup>
                  {qrAuthConnectorDefinitions.map((definition) => (
                    <SettingsToggleButton
                      key={definition.connectorId}
                      active={definition.connectorId === selectedAuthConnectorDefinition?.connectorId}
                      onClick={() => setSelectedAuthConnectorId(definition.connectorId)}
                    >
                      {definition.displayName}
                    </SettingsToggleButton>
                  ))}
                </SettingsToggleGroup>
              ) : null}
              {selectedAuthConnectorDefinition ? (
                <>
                  <p className="settings-card-note">
                    {t('debug.center.sourceFacade.auth.authStatus', {
                      platform: selectedAuthConnectorDisplayName,
                      authState: platformAuthStatus?.authState ?? 'unauthorized',
                      accountUid: platformAuthStatus?.accountUid ?? '-',
                      instanceId: platformAuthStatus?.instanceId ?? selectedAuthInstanceId ?? '-',
                    })}
                  </p>
                  {!selectedAuthInstanceId ? (
                    <p className="settings-card-note">
                      {t('debug.center.sourceFacade.auth.noInstance', {
                        platform: selectedAuthConnectorDisplayName,
                      })}
                    </p>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <SettingsActionButton
                      type="button"
                      onClick={() => {
                        void generateSelectedPlatformQrSession();
                      }}
                      disabled={platformAuthBusy || !selectedAuthInstanceId}
                    >
                      {t('debug.center.sourceFacade.auth.generateAction')}
                    </SettingsActionButton>
                    <SettingsActionButton
                      type="button"
                      onClick={() => {
                        void pollSelectedPlatformQrSession();
                      }}
                      disabled={platformAuthBusy || !platformQrSession}
                    >
                      {t('debug.center.sourceFacade.auth.pollAction')}
                    </SettingsActionButton>
                    <SettingsActionButton
                      type="button"
                      onClick={() => {
                        void logoutSelectedPlatformAuth();
                      }}
                      disabled={platformAuthBusy || !selectedAuthInstanceId}
                    >
                      {t('debug.center.sourceFacade.auth.logoutAction')}
                    </SettingsActionButton>
                  </div>
                  {platformQrSession ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <img
                        src={platformQrSession.qrImageDataUrl}
                        alt={t('debug.center.sourceFacade.auth.qrAlt', {
                          platform: selectedAuthConnectorDisplayName,
                        })}
                        style={{ width: 180, height: 180, borderRadius: 8, background: '#fff' }}
                      />
                      <p className="settings-card-note">
                        {t('debug.center.sourceFacade.auth.qrExpires', {
                          expiresAt: new Date(platformQrSession.expiresAtMs).toLocaleString(),
                        })}
                      </p>
                      <p className="settings-card-note">
                        {t('debug.center.sourceFacade.auth.qrHint', {
                          platform: selectedAuthConnectorDisplayName,
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="settings-card-note">{t('debug.center.sourceFacade.auth.noQr')}</p>
                  )}
                  {platformQrPollResult ? (
                    <p className="settings-card-note">
                      {t('debug.center.sourceFacade.auth.pollState', {
                        state: platformQrPollResult.state,
                        message: platformQrPollResult.stateMessage,
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="settings-card-note">{t('debug.center.sourceFacade.auth.noConnectors')}</p>
              )}
            </div>

            {unifiedSources.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {unifiedSources.slice(0, 8).map((item) => (
                  <p className="settings-card-note" key={`${item.sourceId}:${item.connectorId}`}>
                    {t('debug.center.sourceFacade.sourceItem', {
                      sourceId: item.sourceId,
                      kind: item.kind,
                      driver: item.driver,
                      status: item.status,
                      name: item.displayName,
                    })}
                  </p>
                ))}
              </div>
            ) : (
              <p className="settings-card-note">{t('debug.center.sourceFacade.empty')}</p>
            )}

            {unifiedSearchResults.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p className="settings-card-note">
                  {t('debug.center.sourceFacade.searchResultSummary', {
                    count: unifiedSearchResults.length,
                  })}
                </p>
                {unifiedSearchResults.slice(0, 8).map((item) => (
                  <p className="settings-card-note" key={`${item.trackId}:${item.sourceId}`}>
                    {t('debug.center.sourceFacade.searchResultItem', {
                      title: item.title ?? '-',
                      artist: item.artist ?? '-',
                      sourceId: item.sourceId,
                      availability: item.availability,
                    })}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'platforms' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.sync.title')}</p>
              <p className="settings-card-desc">{t('debug.center.sync.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {syncSchedulerStatus?.running ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void refreshSyncOrchestrator();
              }}
              disabled={syncBusy}
            >
              {t('common.action.refresh')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void runSyncTick();
              }}
              disabled={syncBusy}
            >
              {t('debug.center.sync.actions.tick')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void retrySyncFailedSources();
              }}
              disabled={syncBusy}
            >
              {t('debug.center.sync.actions.retryFailedSources')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void clearSyncFailedSources();
              }}
              disabled={syncBusy}
            >
              {t('debug.center.sync.actions.clearFailedSources')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void startSyncScheduler();
              }}
              disabled={syncBusy}
            >
              {t('debug.center.sync.actions.startScheduler')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => {
                void stopSyncScheduler();
              }}
              disabled={syncBusy}
            >
              {t('debug.center.sync.actions.stopScheduler')}
            </SettingsActionButton>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <div>
              <p className="settings-card-label">{t('debug.center.sync.scheduler.intervalLabel')}</p>
              <p className="settings-card-desc">{t('debug.center.sync.scheduler.intervalDesc')}</p>
              <input
                type="number"
                min={5000}
                max={3600000}
                step={1000}
                value={syncSchedulerIntervalMs}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) return;
                  setSyncSchedulerIntervalMs(Math.max(5_000, Math.min(60 * 60 * 1_000, Math.floor(next))));
                }}
                style={{
                  marginTop: 6,
                  width: 180,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(0,0,0,0.18)',
                  color: 'rgba(255,255,255,0.9)',
                }}
              />
            </div>

            <p className="settings-card-note">
              {t('debug.center.sync.scheduler.status', {
                running: syncSchedulerStatus?.running === true ? t('common.state.on') : t('common.state.off'),
                intervalMs:
                  typeof syncSchedulerStatus?.intervalMs === 'number'
                    ? syncSchedulerStatus.intervalMs
                    : syncSchedulerIntervalMs,
                nextRunAt:
                  typeof syncSchedulerStatus?.nextRunAtMs === 'number'
                    ? new Date(syncSchedulerStatus.nextRunAtMs).toLocaleString()
                    : '-',
              })}
            </p>

            <p className="settings-card-note">
              {t('debug.center.sync.orchestrator.status', {
                running: syncStatus?.running === true ? t('common.state.on') : t('common.state.off'),
                totalTicks: syncStatus?.totalTicks ?? 0,
                lastReason: syncStatus?.lastTickReason ?? '-',
                lastError: syncStatus?.lastError ?? '-',
              })}
            </p>

            {latestSyncTickResult ? (
              <p className="settings-card-note">
                {t('debug.center.sync.lastTick.result', {
                  startedAt: new Date(latestSyncTickResult.startedAtMs).toLocaleString(),
                  scanned: latestSyncTickResult.scannedSources,
                  changed: latestSyncTickResult.changedSources,
                  failed: latestSyncTickResult.failedSources,
                  queued: latestSyncTickResult.enqueuedMetadataJobs,
                })}
              </p>
            ) : null}

            <div>
              <p className="settings-card-label">{t('debug.center.sync.failedSources.title')}</p>
              <p className="settings-card-note">
                {t('debug.center.sync.failedSources.summary', {
                  total: syncFailureOverview?.totalFailedSources ?? 0,
                  backoff: syncFailureOverview?.backoffActiveSources ?? 0,
                })}
              </p>
              {syncFailedSourceItems.length > 0 ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, marginBottom: 6 }}>
                  <SettingsActionButton
                    type="button"
                    onClick={selectAllSyncFailureSources}
                    disabled={syncBusy}
                  >
                    {t('debug.center.sync.failedSources.selectAll')}
                  </SettingsActionButton>
                  <SettingsActionButton
                    type="button"
                    onClick={clearSelectedSyncFailureSources}
                    disabled={syncBusy || !hasSelectedSyncFailureSources}
                  >
                    {t('debug.center.sync.failedSources.clearSelection')}
                  </SettingsActionButton>
                  <p className="settings-card-note" style={{ margin: 0, alignSelf: 'center' }}>
                    {t('debug.center.sync.failedSources.selectedSummary', {
                      selected: selectedSyncFailureSourceIds.length,
                    })}
                  </p>
                </div>
              ) : null}
              {syncFailedSourceItems.length === 0 ? (
                <p className="settings-card-note">{t('debug.center.sync.failedSources.empty')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {syncFailedSourceItems.slice(0, 8).map((item) => {
                    const backoffSeconds =
                      typeof item.backoffRemainingMs === 'number'
                        ? Math.max(0, Math.ceil(item.backoffRemainingMs / 1000))
                        : 0;

                    return (
                      <SettingsCheckbox
                        className="settings-checkbox--note"
                        key={`${item.sourceId}:${item.updatedAtMs}:${item.lastError ?? '-'}`}
                        checked={selectedSyncFailureSourceIdSet.has(item.sourceId)}
                        onCheckedChange={() => {
                          toggleSyncFailureSourceSelection(item.sourceId);
                        }}
                        disabled={syncBusy}
                        style={{
                          alignItems: 'flex-start',
                          color: 'var(--settings-text-dim)',
                        }}
                      >
                        {t('debug.center.sync.failedSources.itemSummary', {
                          sourceId: item.sourceId,
                          sourceDisplayName: item.sourceDisplayName ?? '-',
                          connectorId: item.connectorId,
                          path: item.sourcePath,
                          error: item.lastError ?? '-',
                          lastScanAt:
                            typeof item.incrementalScanAtMs === 'number'
                              ? new Date(item.incrementalScanAtMs).toLocaleString()
                              : '-',
                          updatedAt: new Date(item.updatedAtMs).toLocaleString(),
                          backoffSeconds,
                        })}
                      </SettingsCheckbox>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'runtime' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.vstBridge.title')}</p>
              <p className="settings-card-desc">{t('debug.center.vstBridge.desc')}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <SettingsActionButton type="button" onClick={() => void refresh()} disabled={!isTauri}>
                {t('debug.center.actions.refreshEnv')}
              </SettingsActionButton>
              <SettingsActionButton type="button" onClick={handleCopyPowerShell}>
                {t('debug.center.actions.copyPowershell')}
              </SettingsActionButton>
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
              <SettingsToggleGroup>
                <SettingsToggleButton
                  type="button"
                  active={!config.vstBridge.stderr}
                  onClick={() => updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, stderr: false } }))}
                >
                  {t('common.state.off')}
                </SettingsToggleButton>
                <SettingsToggleButton
                  type="button"
                  active={config.vstBridge.stderr}
                  onClick={() => updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, stderr: true } }))}
                >
                  {t('common.state.on')}
                </SettingsToggleButton>
              </SettingsToggleGroup>
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
              <SettingsToggleGroup>
                <SettingsToggleButton
                  type="button"
                  active={!config.vstBridge.logEditor}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, logEditor: false } }))
                  }
                >
                  {t('common.state.off')}
                </SettingsToggleButton>
                <SettingsToggleButton
                  type="button"
                  active={config.vstBridge.logEditor}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, logEditor: true } }))
                  }
                >
                  {t('common.state.on')}
                </SettingsToggleButton>
              </SettingsToggleGroup>
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
              <SettingsToggleGroup>
                <SettingsToggleButton
                  type="button"
                  active={!config.vstBridge.minidump}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidump: false } }))
                  }
                >
                  {t('common.state.off')}
                </SettingsToggleButton>
                <SettingsToggleButton
                  type="button"
                  active={config.vstBridge.minidump}
                  onClick={() =>
                    updateConfig((prev) => ({ ...prev, vstBridge: { ...prev.vstBridge, minidump: true } }))
                  }
                >
                  {t('common.state.on')}
                </SettingsToggleButton>
              </SettingsToggleGroup>

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
                <SettingsActionButton type="button" onClick={() => void handlePickMinidumpDir()}>
                  {t('debug.center.vstBridge.minidumpDir.pick')}
                </SettingsActionButton>
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

              <SettingsToggleGroup>
                {(['auto', 'on', 'off'] as const).map((mode) => (
                  <SettingsToggleButton
                    key={mode}
                    type="button"
                    active={formatTriBool(config.vstBridge.editorSafeMode) === mode}
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        vstBridge: { ...prev.vstBridge, editorSafeMode: normalizeTriBool(mode) },
                      }))
                    }
                  >
                    {t(`debug.center.vstBridge.editorSafeMode.option.${mode}`)}
                  </SettingsToggleButton>
                ))}
              </SettingsToggleGroup>
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

              <SettingsToggleGroup>
                {(['auto', 'disabled', 'silence', 'self'] as const).map((mode) => (
                  <SettingsToggleButton
                    key={mode}
                    type="button"
                    active={(config.vstBridge.sidechainMode ?? 'auto') === mode}
                    onClick={() =>
                      updateConfig((prev) => ({
                        ...prev,
                        vstBridge: { ...prev.vstBridge, sidechainMode: normalizeSidechainMode(mode) },
                      }))
                    }
                  >
                    {t(`debug.center.vstBridge.sidechainMode.option.${mode}`)}
                  </SettingsToggleButton>
                ))}
              </SettingsToggleGroup>
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
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'runtime' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.windowComm.title')}</p>
              <p className="settings-card-desc">{t('debug.center.windowComm.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {windowCommDebugEnabled ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>
          <SettingsToggleGroup>
            <SettingsToggleButton type="button" active={!windowCommDebugEnabled} onClick={() => setWindowCommDebug('0')}>
              {t('common.state.off')}
            </SettingsToggleButton>
            <SettingsToggleButton type="button" active={windowCommDebugEnabled} onClick={() => setWindowCommDebug('1')}>
              {t('common.state.on')}
            </SettingsToggleButton>
          </SettingsToggleGroup>
          <p className="settings-card-note">{t('debug.center.windowComm.note')}</p>
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'telemetry' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.telemetry.runtime.title')}</p>
              <p className="settings-card-desc">{t('debug.center.telemetry.runtime.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {telemetrySnapshot.transportAvailable ? 'transport:on' : 'transport:off'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <SettingsActionButton type="button" onClick={() => void refreshTelemetryRuntime()}>
              {t('debug.center.telemetry.runtime.action.refresh')}
            </SettingsActionButton>
            <SettingsActionButton type="button" onClick={() => void flushTelemetryRuntime()}>
              {t('debug.center.telemetry.runtime.action.flush')}
            </SettingsActionButton>
            <SettingsActionButton type="button" onClick={() => void clearTelemetryRuntimeSession()}>
              {t('debug.center.telemetry.runtime.action.clearSession')}
            </SettingsActionButton>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="settings-card-desc">
              session={telemetrySnapshot.status.currentSessionId} | bootstrap={telemetrySnapshot.bootstrapState} |
              enabled={telemetrySnapshot.policy.enabled ? 'on' : 'off'} | uiTail=
              {telemetrySnapshot.policy.uiTailEnabled ? 'on' : 'off'}
            </p>
            <p className="settings-card-desc">
              localBuffered={telemetrySnapshot.bufferedRecords} | localDropped(queue)=
              {telemetrySnapshot.queueDroppedRecords} | localDropped(tail)=
              {telemetrySnapshot.tailDroppedRecords}
            </p>
            <p className="settings-card-desc">
              backendFlushed={telemetrySnapshot.status.flushedRecords} | backendDropped=
              {telemetrySnapshot.status.droppedRecords} | file=
              {formatBytesToMb(telemetrySnapshot.status.currentFileBytes)} MB
            </p>
            <p className="settings-card-note">
              frontendMin={telemetrySnapshot.status.frontendMinLevel} | backendMin=
              {telemetrySnapshot.status.backendMinLevel} | persistMin=
              {telemetrySnapshot.status.persistMinLevel} | flushEvery=
              {telemetrySnapshot.policy.batchFlushMs}ms / {telemetrySnapshot.policy.batchMaxItems} items
            </p>
            {telemetrySnapshot.status.currentFilePath ? (
              <p className="settings-card-note">filePath={telemetrySnapshot.status.currentFilePath}</p>
            ) : null}
            {telemetrySnapshot.status.lastError ? (
              <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.9)' }}>
                lastError={telemetrySnapshot.status.lastError}
              </p>
            ) : null}
          </div>

          <div style={{ marginTop: 14 }}>
            <p className="settings-card-label">{t('debug.center.telemetry.runtime.recentTail')}</p>
            {telemetrySnapshot.tail.length === 0 ? (
              <p className="settings-card-note">{t('debug.center.telemetry.runtime.empty')}</p>
            ) : (
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 10,
                  background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  overflowX: 'auto',
                  maxHeight: 220,
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.88)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {telemetrySnapshot.tail
                  .slice(-12)
                  .reverse()
                  .map((record) => formatTelemetryRecordLine(record))
                  .join('\n')}
              </pre>
            )}
          </div>
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div className="settings-card-header">
              <div>
                <p className="settings-card-label">{t('debug.center.musicPlatformPack.title')}</p>
                <p className="settings-card-desc">{t('debug.center.musicPlatformPack.desc')}</p>
              </div>
              <span className="settings-card-badge">
                {formatPlatformPackStartupStateLabel(platformPackStartupHealth.state, t)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <p className="settings-card-desc">
                {t('debug.center.musicPlatformPack.summary', {
                  state: formatPlatformPackStartupStateLabel(platformPackStartupHealth.state, t),
                  stage: formatPlatformPackBootStageLabel(platformPackStartupHealth.currentStage, t),
                  registered: platformPackStartupHealth.registeredBuiltinCount,
                  expected: platformPackStartupHealth.expectedBuiltinCount,
                })}
              </p>
              <p className="settings-card-note">
                {t('debug.center.musicPlatformPack.timing', {
                  scheduled: formatNullableToggleState(platformPackStartupHealth.bootScheduled, t),
                  startedAt: formatDebugTimestamp(platformPackStartupHealth.bootStartedAtMs),
                  finishedAt: formatDebugTimestamp(platformPackStartupHealth.bootFinishedAtMs),
                  duration:
                    typeof platformPackStartupHealth.durationMs === 'number'
                      ? `${platformPackStartupHealth.durationMs}ms`
                      : '-',
                })}
              </p>
              <p className="settings-card-note">
                {t('debug.center.musicPlatformPack.storeStatus', {
                  bootstrapFailed: formatNullableToggleState(
                    platformPackStartupHealth.storeBootstrapFailed,
                    t
                  ),
                  indexAvailable: formatNullableToggleState(
                    platformPackStartupHealth.storeIndexAvailable,
                    t
                  ),
                  readyWithoutIndex: formatNullableToggleState(
                    platformPackStartupHealth.storeReadyWithoutIndex,
                    t
                  ),
                  current: formatNullableToggleState(platformPackStartupHealth.storeAlreadyCurrent, t),
                })}
              </p>
              <p className="settings-card-note">
                {t('debug.center.musicPlatformPack.reconcileStatus', {
                  scheduled: formatNullableToggleState(
                    platformPackStartupHealth.backgroundReconcileScheduled,
                    t
                  ),
                  running: formatNullableToggleState(
                    platformPackStartupHealth.backgroundReconcileRunning,
                    t
                  ),
                  staleConnectorIds:
                    platformPackStartupHealth.staleConnectorIds.length > 0
                      ? platformPackStartupHealth.staleConnectorIds.join(', ')
                      : '-',
                  relaxedDevConnectorIds:
                    platformPackStartupHealth.relaxedDevConnectorIds.length > 0
                      ? platformPackStartupHealth.relaxedDevConnectorIds.join(', ')
                      : '-',
                })}
              </p>
              {platformPackStartupHealth.lastError ? (
                <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.9)' }}>
                  {t('debug.center.musicPlatformPack.lastError', {
                    message: platformPackStartupHealth.lastError,
                  })}
                </p>
              ) : null}
            </div>

            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: 'rgba(0,0,0,0.14)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <p className="settings-card-label">
                    {t('debug.center.musicPlatformPack.doctor.title')}
                  </p>
                  <p className="settings-card-desc">
                    {t('debug.center.musicPlatformPack.doctor.desc')}
                  </p>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span className="settings-card-badge">
                    {platformPackDoctorReport
                      ? formatPlatformPackDoctorStatusLabel(platformPackDoctorReport.status, t)
                      : t('common.state.unknown')}
                  </span>
                  <SettingsActionButton
                    type="button"
                    onClick={() => {
                      void refreshPlatformPackDoctor();
                    }}
                    disabled={platformPackDoctorBusy}
                  >
                    {platformPackDoctorBusy
                      ? t('debug.center.musicPlatformPack.doctor.actionRefreshing')
                      : t('debug.center.musicPlatformPack.doctor.actionRefresh')}
                  </SettingsActionButton>
                </div>
              </div>

              {platformPackDoctorReport ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  <p className="settings-card-note">
                    {t('debug.center.musicPlatformPack.doctor.summary', {
                      status: formatPlatformPackDoctorStatusLabel(
                        platformPackDoctorReport.status,
                        t
                      ),
                      total: platformPackDoctorReport.connectors.length,
                      installations: platformPackDoctorReport.installationCount,
                      instances: platformPackDoctorReport.instanceCount,
                      ready: platformPackDoctorReport.readyConnectorCount,
                      degraded: platformPackDoctorReport.degradedConnectorCount,
                      error: platformPackDoctorReport.errorConnectorCount,
                      globalIssues: platformPackDoctorReport.issues.length,
                    })}
                  </p>
                  <p className="settings-card-note">
                    {t('debug.center.musicPlatformPack.doctor.refreshedAt', {
                      refreshedAt: formatDebugTimestamp(platformPackDoctorReport.generatedAtMs),
                      duration: `${platformPackDoctorReport.durationMs}ms`,
                    })}
                  </p>
                  {platformPackDoctorError ? (
                    <p className="settings-card-note" style={{ color: 'rgba(255,120,120,0.9)' }}>
                      {t('debug.center.musicPlatformPack.doctor.error', {
                        message: platformPackDoctorError,
                      })}
                    </p>
                  ) : null}
                  {platformPackDoctorReport.issues.length > 0 ? (
                    <pre
                      style={{
                        marginTop: 2,
                        padding: 12,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        overflowX: 'auto',
                        maxHeight: 160,
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.88)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {platformPackDoctorReport.issues
                        .map((issue) =>
                          t('debug.center.musicPlatformPack.doctor.issueLine', {
                            severity: issue.severity.toUpperCase(),
                            code: issue.code,
                            details: formatPlatformPackDoctorIssueDetails(issue),
                          })
                        )
                        .join('\n')}
                    </pre>
                  ) : null}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {platformPackDoctorReport.connectors.map((connector) => (
                      <div
                        key={connector.connectorId}
                        style={{
                          padding: 10,
                          borderRadius: 10,
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <p className="settings-card-note" style={{ fontWeight: 600 }}>
                              {connector.displayName}
                            </p>
                            <p className="settings-card-note">{connector.connectorId}</p>
                          </div>
                          <span className="settings-card-badge">
                            {formatPlatformPackDoctorStatusLabel(connector.status, t)}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            marginTop: 8,
                          }}
                        >
                          <p className="settings-card-note">
                            {t('debug.center.musicPlatformPack.doctor.connectorState', {
                              builtin: formatNullableToggleState(connector.expectedBuiltin, t),
                              installed: formatNullableToggleState(
                                connector.installedRecord.installedAtMs !== null,
                                t
                              ),
                              registration: formatNullableToggleState(
                                connector.registrationPresent,
                                t
                              ),
                              descriptor: formatNullableToggleState(connector.descriptorPresent, t),
                              definition: formatNullableToggleState(
                                connector.connectorDefinitionPresent,
                                t
                              ),
                            })}
                          </p>
                          <p className="settings-card-note">
                            {t('debug.center.musicPlatformPack.doctor.connectorFlows', {
                              recommendations: formatPlatformPackDoctorFlowStatusLabel(
                                connector.requiredFlows.recommendations,
                                t
                              ),
                              quality: formatPlatformPackDoctorFlowStatusLabel(
                                connector.requiredFlows.quality,
                                t
                              ),
                              pages: formatPlatformPackDoctorFlowStatusLabel(
                                connector.requiredFlows.pages,
                                t
                              ),
                            })}
                          </p>
                          <p className="settings-card-note">
                            {t('debug.center.musicPlatformPack.doctor.connectorWorkspace', {
                              mode: formatPlatformWorkspaceOwnershipModeLabel(
                                connector.workspaceRouting.ownershipMode,
                                t
                              ),
                              path: formatPlatformWorkspacePathLabel(
                                connector.workspaceRouting.path,
                                t
                              ),
                              status: formatPlatformWorkspaceStatusLabel(
                                connector.workspaceRouting.status,
                                t
                              ),
                              packReady: formatNullableToggleState(
                                connector.workspaceRouting.packWorkspaceReady,
                                t
                              ),
                            })}
                          </p>
                          {connector.workspaceRouting.fallbackReasonCode ||
                          connector.workspaceRouting.fallbackReasonMessage ? (
                            <p className="settings-card-note">
                              {t('debug.center.musicPlatformPack.doctor.connectorWorkspaceFallback', {
                                code:
                                  connector.workspaceRouting.fallbackReasonCode ??
                                  t('common.state.unknown'),
                                message:
                                  connector.workspaceRouting.fallbackReasonMessage ??
                                  t('common.state.unknown'),
                              })}
                            </p>
                          ) : null}
                          {connector.workspaceRouting.diagnostics.length > 0 ? (
                            <pre
                              style={{
                                marginTop: 2,
                                padding: 10,
                                borderRadius: 8,
                                background: 'rgba(0,0,0,0.16)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                overflowX: 'auto',
                                maxHeight: 140,
                                fontSize: 12,
                                color: 'rgba(255,255,255,0.88)',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {connector.workspaceRouting.diagnostics
                                .map((diagnostic) =>
                                  t('debug.center.musicPlatformPack.doctor.workspaceDiagnosticLine', {
                                    severity: diagnostic.severity.toUpperCase(),
                                    code: diagnostic.code,
                                    details: formatPlatformWorkspaceDiagnosticDetails(diagnostic),
                                  })
                                )
                                .join('\n')}
                            </pre>
                          ) : null}
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 8,
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <p className="settings-card-note" style={{ fontWeight: 600 }}>
                              {t('debug.center.musicPlatformPack.doctor.installationsTitle', {
                                count: connector.installations.length,
                              })}
                            </p>
                            {connector.installations.length > 0 ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 8,
                                  marginTop: 8,
                                }}
                              >
                                {connector.installations.map((installation) => (
                                  <div
                                    key={installation.installationId}
                                    style={{
                                      padding: 10,
                                      borderRadius: 8,
                                      background: 'rgba(0,0,0,0.16)',
                                      border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: 8,
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <div>
                                        <p className="settings-card-note" style={{ fontWeight: 600 }}>
                                          {t('debug.center.musicPlatformPack.doctor.installationHeader', {
                                            installationId: installation.installationId,
                                          })}
                                        </p>
                                        <p className="settings-card-note">
                                          {t('debug.center.musicPlatformPack.doctor.installationIdentity', {
                                            connectorId: installation.connectorId,
                                            platformId: installation.platformId,
                                            packId: installation.packId,
                                            packVersion: installation.packVersion,
                                          })}
                                        </p>
                                      </div>
                                      <span className="settings-card-badge">
                                        {formatPlatformPackDoctorStatusLabel(installation.status, t)}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                        marginTop: 8,
                                      }}
                                    >
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationSource', {
                                          sourceType: formatOptionalText(installation.sourceType),
                                          source: formatOptionalText(installation.source),
                                          installedAt: formatDebugTimestamp(installation.installedAtMs),
                                          activeRegistration: formatNullableToggleState(
                                            installation.activeConnectorRegistration,
                                            t
                                          ),
                                          registration: formatNullableToggleState(
                                            installation.registrationPresent,
                                            t
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t(
                                          'debug.center.musicPlatformPack.doctor.installationPackageDigest',
                                          {
                                            packageDigest: formatOptionalText(
                                              installation.packageDigest
                                            ),
                                          }
                                        )}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationArtifacts', {
                                          artifactRoot: formatOptionalText(
                                            installation.artifactRoot.path
                                          ),
                                          artifactRootResolved: formatNullableToggleState(
                                            installation.artifactRoot.resolved,
                                            t
                                          ),
                                          artifactsPresent: formatNullableToggleState(
                                            installation.artifactsPresent,
                                            t
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationRuntime', {
                                          runtimeResolved: formatNullableToggleState(
                                            installation.runtime.resolved,
                                            t
                                          ),
                                          runtimePath: formatOptionalText(installation.runtime.path),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationIcon', {
                                          iconResolved: formatNullableToggleState(
                                            installation.icon.resolved,
                                            t
                                          ),
                                          iconPath: formatOptionalText(installation.icon.path),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationWorkspace', {
                                          surfaceResolved: formatNullableToggleState(
                                            installation.workspaceSurface.resolved,
                                            t
                                          ),
                                          source: formatOptionalText(
                                            installation.workspaceSurface.source
                                          ),
                                          rootViewId: formatOptionalText(
                                            installation.workspaceSurface.rootViewId
                                          ),
                                          viewType: formatOptionalText(
                                            installation.workspaceSurface.viewType
                                          ),
                                          runtimeCarrier: formatOptionalText(
                                            installation.workspaceSurface.requiredRuntimeCarrier
                                          ),
                                          runtimeImportUrl: formatOptionalText(
                                            installation.workspaceSurface.runtimeImportUrl
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.installationReadiness', {
                                          ready: formatNullableToggleState(
                                            installation.workspaceReadiness.ready,
                                            t
                                          ),
                                          registration: formatNullableToggleState(
                                            installation.workspaceReadiness.registrationPresent,
                                            t
                                          ),
                                          contract: formatNullableToggleState(
                                            installation.workspaceReadiness.contractPresent,
                                            t
                                          ),
                                          runtime: formatNullableToggleState(
                                            installation.workspaceReadiness.runtimePresent,
                                            t
                                          ),
                                          ownership: formatNullableToggleState(
                                            installation.workspaceReadiness.workspaceOwnershipDeclared,
                                            t
                                          ),
                                          mount: formatNullableToggleState(
                                            installation.workspaceReadiness.mountSurfaceDeclared,
                                            t
                                          ),
                                        })}
                                      </p>
                                      {installation.workspaceReadiness.diagnostics.length > 0 ? (
                                        <pre
                                          style={{
                                            marginTop: 2,
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            overflowX: 'auto',
                                            maxHeight: 140,
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.88)',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {installation.workspaceReadiness.diagnostics
                                            .map((diagnostic) =>
                                              t(
                                                'debug.center.musicPlatformPack.doctor.workspaceDiagnosticLine',
                                                {
                                                  severity: diagnostic.severity.toUpperCase(),
                                                  code: diagnostic.code,
                                                  details:
                                                    formatPlatformWorkspaceDiagnosticDetails(
                                                      diagnostic
                                                    ),
                                                }
                                              )
                                            )
                                            .join('\n')}
                                        </pre>
                                      ) : null}
                                      {installation.issues.length > 0 ? (
                                        <pre
                                          style={{
                                            marginTop: 2,
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            overflowX: 'auto',
                                            maxHeight: 140,
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.88)',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {installation.issues
                                            .map((issue) =>
                                              t('debug.center.musicPlatformPack.doctor.issueLine', {
                                                severity: issue.severity.toUpperCase(),
                                                code: issue.code,
                                                details:
                                                  formatPlatformPackDoctorIssueDetails(issue),
                                              })
                                            )
                                            .join('\n')}
                                        </pre>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="settings-card-note" style={{ marginTop: 8 }}>
                                {t('debug.center.musicPlatformPack.doctor.emptyInstallations')}
                              </p>
                            )}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              padding: 10,
                              borderRadius: 8,
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <p className="settings-card-note" style={{ fontWeight: 600 }}>
                              {t('debug.center.musicPlatformPack.doctor.instancesTitle', {
                                count: connector.instances.length,
                              })}
                            </p>
                            {connector.instances.length > 0 ? (
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 8,
                                  marginTop: 8,
                                }}
                              >
                                {connector.instances.map((instance) => (
                                  <div
                                    key={instance.instanceId}
                                    style={{
                                      padding: 10,
                                      borderRadius: 8,
                                      background: 'rgba(0,0,0,0.16)',
                                      border: '1px solid rgba(255,255,255,0.06)',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: 8,
                                        justifyContent: 'space-between',
                                        alignItems: 'flex-start',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <div>
                                        <p className="settings-card-note" style={{ fontWeight: 600 }}>
                                          {t('debug.center.musicPlatformPack.doctor.instanceHeader', {
                                            instanceId: instance.instanceId,
                                          })}
                                        </p>
                                        <p className="settings-card-note">
                                          {t('debug.center.musicPlatformPack.doctor.instanceIdentity', {
                                            installationId: formatOptionalText(
                                              instance.installationId
                                            ),
                                            connectorId: instance.connectorId,
                                            platformId: instance.platformId,
                                          })}
                                        </p>
                                      </div>
                                      <span className="settings-card-badge">
                                        {formatPlatformPackDoctorStatusLabel(instance.status, t)}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 6,
                                        marginTop: 8,
                                      }}
                                    >
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.instanceState', {
                                          displayName: formatOptionalText(instance.displayName),
                                          instanceLabel: formatOptionalText(instance.instanceLabel),
                                          imported: formatNullableToggleState(instance.imported, t),
                                          importedRegistry: formatNullableToggleState(
                                            instance.importedRegistryPresent,
                                            t
                                          ),
                                          instanceRecord: formatNullableToggleState(
                                            instance.instanceRecordPresent,
                                            t
                                          ),
                                          descriptor: formatNullableToggleState(
                                            instance.descriptorPresent,
                                            t
                                          ),
                                          installationPresent: formatNullableToggleState(
                                            instance.installationPresent,
                                            t
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.instanceSource', {
                                          sourceType: formatOptionalText(instance.sourceType),
                                          source: formatOptionalText(instance.source),
                                          authState: formatOptionalText(instance.authState),
                                          availability: formatOptionalText(instance.availability),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.instanceWorkspace', {
                                          mode: formatPlatformWorkspaceOwnershipModeLabel(
                                            instance.workspaceRouting.ownershipMode,
                                            t
                                          ),
                                          path: formatPlatformWorkspacePathLabel(
                                            instance.workspaceRouting.path,
                                            t
                                          ),
                                          status: formatPlatformWorkspaceStatusLabel(
                                            instance.workspaceRouting.status,
                                            t
                                          ),
                                          packReady: formatNullableToggleState(
                                            instance.workspaceRouting.packWorkspaceReady,
                                            t
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.instanceMount', {
                                          resolutionSource: formatOptionalText(
                                            instance.workspaceMount.resolutionSource
                                          ),
                                          installationId: formatOptionalText(
                                            instance.workspaceMount.installationId
                                          ),
                                          sourceType: formatOptionalText(
                                            instance.workspaceMount.sourceType
                                          ),
                                          source: formatOptionalText(
                                            instance.workspaceMount.source
                                          ),
                                          pack:
                                            instance.workspaceMount.packId ||
                                            instance.workspaceMount.packVersion
                                              ? `${formatOptionalText(
                                                  instance.workspaceMount.packId
                                                )}@${formatOptionalText(
                                                  instance.workspaceMount.packVersion
                                                )}`
                                              : '-',
                                          packageDigest: formatOptionalText(
                                            instance.workspaceMount.packageDigest
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t('debug.center.musicPlatformPack.doctor.instanceMountPaths', {
                                          artifactRoot: formatOptionalText(
                                            instance.workspaceMount.artifactRootPath
                                          ),
                                          runtimePath: formatOptionalText(
                                            instance.workspaceMount.runtimePath
                                          ),
                                          runtimeImportUrl: formatOptionalText(
                                            instance.workspaceMount.runtimeImportUrl
                                          ),
                                          iconPath: formatOptionalText(
                                            instance.workspaceMount.iconPath
                                          ),
                                          surfaceResolved: formatNullableToggleState(
                                            instance.workspaceMount.surfaceResolved,
                                            t
                                          ),
                                          surfaceSource: formatOptionalText(
                                            instance.workspaceMount.surfaceSource
                                          ),
                                          rootViewId: formatOptionalText(
                                            instance.workspaceMount.rootViewId
                                          ),
                                          viewType: formatOptionalText(
                                            instance.workspaceMount.viewType
                                          ),
                                        })}
                                      </p>
                                      <p className="settings-card-note">
                                        {t(
                                          'debug.center.musicPlatformPack.doctor.instanceRenderSelectionCurrent',
                                          {
                                            registryReady: formatNullableToggleState(
                                              instance.renderSelection.registryInitialized,
                                              t
                                            ),
                                            present: formatNullableToggleState(
                                              instance.renderSelection.currentPresent,
                                              t
                                            ),
                                            mounted: formatNullableToggleState(
                                              instance.renderSelection.currentMounted,
                                              t
                                            ),
                                            mountedAt: formatDebugTimestamp(
                                              instance.renderSelection.currentMountedAtMs
                                            ),
                                            order: formatOptionalText(
                                              instance.renderSelection.currentOrder
                                            ),
                                          }
                                        )}
                                      </p>
                                      <p className="settings-card-note">
                                        {t(
                                          'debug.center.musicPlatformPack.doctor.instanceRenderSelectionPersisted',
                                          {
                                            present: formatNullableToggleState(
                                              instance.renderSelection.persistedPresent,
                                              t
                                            ),
                                            mounted: formatNullableToggleState(
                                              instance.renderSelection.persistedMounted,
                                              t
                                            ),
                                            mountedAt: formatDebugTimestamp(
                                              instance.renderSelection.persistedMountedAtMs
                                            ),
                                            order: formatOptionalText(
                                              instance.renderSelection.persistedOrder
                                            ),
                                            inSync: formatNullableToggleState(
                                              instance.renderSelection.inSync,
                                              t
                                            ),
                                          }
                                        )}
                                      </p>
                                      {instance.workspaceRouting.fallbackReasonCode ||
                                      instance.workspaceRouting.fallbackReasonMessage ? (
                                        <p className="settings-card-note">
                                          {t(
                                            'debug.center.musicPlatformPack.doctor.connectorWorkspaceFallback',
                                            {
                                              code:
                                                instance.workspaceRouting.fallbackReasonCode ??
                                                t('common.state.unknown'),
                                              message:
                                                instance.workspaceRouting
                                                  .fallbackReasonMessage ??
                                                t('common.state.unknown'),
                                            }
                                          )}
                                        </p>
                                      ) : null}
                                      {instance.workspaceRouting.diagnostics.length > 0 ? (
                                        <pre
                                          style={{
                                            marginTop: 2,
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            overflowX: 'auto',
                                            maxHeight: 140,
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.88)',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {instance.workspaceRouting.diagnostics
                                            .map((diagnostic) =>
                                              t(
                                                'debug.center.musicPlatformPack.doctor.workspaceDiagnosticLine',
                                                {
                                                  severity: diagnostic.severity.toUpperCase(),
                                                  code: diagnostic.code,
                                                  details:
                                                    formatPlatformWorkspaceDiagnosticDetails(
                                                      diagnostic
                                                    ),
                                                }
                                              )
                                            )
                                            .join('\n')}
                                        </pre>
                                      ) : null}
                                      {instance.issues.length > 0 ? (
                                        <pre
                                          style={{
                                            marginTop: 2,
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                            overflowX: 'auto',
                                            maxHeight: 140,
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.88)',
                                            whiteSpace: 'pre-wrap',
                                          }}
                                        >
                                          {instance.issues
                                            .map((issue) =>
                                              t('debug.center.musicPlatformPack.doctor.issueLine', {
                                                severity: issue.severity.toUpperCase(),
                                                code: issue.code,
                                                details:
                                                  formatPlatformPackDoctorIssueDetails(issue),
                                              })
                                            )
                                            .join('\n')}
                                        </pre>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="settings-card-note" style={{ marginTop: 8 }}>
                                {t('debug.center.musicPlatformPack.doctor.emptyInstances')}
                              </p>
                            )}
                          </div>
                          {connector.issues.length > 0 ? (
                            <pre
                              style={{
                                marginTop: 2,
                                padding: 10,
                                borderRadius: 8,
                                background: 'rgba(0,0,0,0.16)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                overflowX: 'auto',
                                maxHeight: 160,
                                fontSize: 12,
                                color: 'rgba(255,255,255,0.88)',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {connector.issues
                                .map((issue) =>
                                  t('debug.center.musicPlatformPack.doctor.issueLine', {
                                    severity: issue.severity.toUpperCase(),
                                    code: issue.code,
                                    details: formatPlatformPackDoctorIssueDetails(issue),
                                  })
                                )
                                .join('\n')}
                            </pre>
                          ) : (
                            <p className="settings-card-note">
                              {t('debug.center.musicPlatformPack.doctor.emptyConnectorIssues')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : platformPackDoctorError ? (
                <p
                  className="settings-card-note"
                  style={{ marginTop: 10, color: 'rgba(255,120,120,0.9)' }}
                >
                  {t('debug.center.musicPlatformPack.doctor.error', {
                    message: platformPackDoctorError,
                  })}
                </p>
              ) : (
                <p className="settings-card-note" style={{ marginTop: 10 }}>
                  {t('debug.center.musicPlatformPack.doctor.empty')}
                </p>
              )}
            </div>

            <div style={{ marginTop: 12 }}>
              <p className="settings-card-note">{t('debug.center.musicPlatformPack.recentStages')}</p>
              {platformPackStartupHealth.recentStages.length === 0 ? (
                <p className="settings-card-note" style={{ marginTop: 8 }}>
                  {t('debug.center.musicPlatformPack.emptyStages')}
                </p>
              ) : (
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflowX: 'auto',
                    maxHeight: 220,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.88)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {platformPackStartupHealth.recentStages
                    .slice(-8)
                    .reverse()
                    .map((entry) =>
                      [
                        `[${formatDebugTimestamp(entry.ts)}]`,
                        entry.level.toUpperCase(),
                        formatPlatformPackStartupStateLabel(entry.state, t),
                        formatPlatformPackBootStageLabel(entry.stage, t),
                        entry.message,
                      ]
                        .filter((part) => typeof part === 'string' && part.length > 0)
                        .join(' | ')
                    )
                    .join('\n')}
                </pre>
              )}
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                gap: 12,
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <p className="settings-card-label">{t('debug.center.telemetry.query.title')}</p>
                <p className="settings-card-desc">{t('debug.center.telemetry.query.desc')}</p>
              </div>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void refreshTelemetryPresetQuery();
                }}
                disabled={!isTauri || telemetryQueryBusy}
              >
                {telemetryQueryBusy ? t('common.state.loading') : t('common.action.refresh')}
              </SettingsActionButton>
            </div>

            <div style={{ marginTop: 12 }}>
              <SettingsToggleGroup>
                {telemetryQueryPresetOptions.map((option) => (
                  <SettingsToggleButton
                    key={option.id}
                    type="button"
                    active={telemetryQueryPresetId === option.id}
                    onClick={() => {
                      void runTelemetryPresetQuery(option.id);
                    }}
                  >
                    {option.label}
                  </SettingsToggleButton>
                ))}
              </SettingsToggleGroup>
            </div>

            <p className="settings-card-note" style={{ marginTop: 12 }}>
              {t('debug.center.telemetry.query.filters', {
                events: formatTelemetryQueryFilterList(telemetryQueryPreset.query.eventPrefixes),
                modules: formatTelemetryQueryFilterList(telemetryQueryPreset.query.moduleIds),
                levels: formatTelemetryQueryFilterList(telemetryQueryPreset.query.levels),
                limit:
                  typeof telemetryQueryPreset.query.limit === 'number'
                    ? telemetryQueryPreset.query.limit
                    : 'all',
              })}
            </p>

            {telemetryQueryError ? (
              <p className="settings-card-note" style={{ marginTop: 10, color: 'rgba(255,120,120,0.9)' }}>
                {telemetryQueryError}
              </p>
            ) : null}

            {telemetryQueryResult ? (
              <>
                <p className="settings-card-desc" style={{ marginTop: 12 }}>
                  {t('debug.center.telemetry.query.results', {
                    matched: telemetryQueryResult.matchedRecordCount,
                    scanned: telemetryQueryResult.scannedRecordCount,
                    sessionId: telemetryQueryResult.status.currentSessionId,
                    window: formatTelemetryQueryWindow(telemetryQueryResult),
                  })}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                    marginTop: 12,
                  }}
                >
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topEvents')}</p>
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        minHeight: 92,
                        whiteSpace: 'pre-wrap',
                        overflowX: 'auto',
                      }}
                    >
                      {formatTelemetryCountList(telemetryQueryResult.eventCounts)}
                    </pre>
                  </div>
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topModules')}</p>
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        minHeight: 92,
                        whiteSpace: 'pre-wrap',
                        overflowX: 'auto',
                      }}
                    >
                      {formatTelemetryCountList(telemetryQueryResult.moduleCounts)}
                    </pre>
                  </div>
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topLevels')}</p>
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 10,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        minHeight: 92,
                        whiteSpace: 'pre-wrap',
                        overflowX: 'auto',
                      }}
                    >
                      {formatTelemetryCountList(telemetryQueryResult.levelCounts)}
                    </pre>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <p className="settings-card-note">{t('debug.center.telemetry.query.recentRecords')}</p>
                  {telemetryQueryResult.records.length === 0 ? (
                    <p className="settings-card-note" style={{ marginTop: 8 }}>
                      {t('debug.center.telemetry.query.empty')}
                    </p>
                  ) : (
                    <pre
                      style={{
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 10,
                        background: 'rgba(0,0,0,0.25)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        overflowX: 'auto',
                        maxHeight: 220,
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.88)',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {telemetryQueryResult.records
                        .slice(-10)
                        .reverse()
                        .map((record) => formatTelemetryRecordLine(record))
                        .join('\n')}
                    </pre>
                  )}
                </div>
              </>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <SettingsActionButton
              type="button"
              disabled={telemetryArtifactBusyAction !== null}
              onClick={() => {
                void handleExportTelemetrySessionJson();
              }}
            >
              {t('debug.center.telemetry.artifacts.action.exportSessionJson')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              disabled={telemetryArtifactBusyAction !== null}
              onClick={() => {
                void handleExportTelemetryScenarioReport();
              }}
            >
              {t('debug.center.telemetry.artifacts.action.exportScenarioReport')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              disabled={telemetryArtifactBusyAction !== null}
              onClick={() => {
                void handleCopyTelemetryAiContext(telemetryQueryPresetId);
              }}
            >
              {t('debug.center.telemetry.artifacts.action.copyAiContext')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              disabled={telemetryArtifactBusyAction !== null}
              onClick={() => {
                void handleExportTelemetryAiContext(telemetryQueryPresetId);
              }}
            >
              {t('debug.center.telemetry.artifacts.action.exportAiContext')}
            </SettingsActionButton>
          </div>
          {telemetryArtifactFeedback ? (
            <p
              className="settings-card-note"
              style={{
                marginTop: 10,
                color:
                  telemetryArtifactFeedback.tone === 'error'
                    ? 'rgba(255,140,140,0.95)'
                    : telemetryArtifactFeedback.tone === 'progress'
                      ? 'rgba(255,225,150,0.95)'
                      : 'rgba(140,255,190,0.95)',
              }}
            >
              {telemetryArtifactFeedback.message}
            </p>
          ) : null}
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'magnets' ? <MagnetTelemetryWorkbench active /> : null}

        {activeWorkspace === 'memory' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.memory.title')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.desc')}</p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void refreshMemory();
                }}
              >
                {t('common.action.refresh')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void captureMemoryBaseline();
                }}
              >
                {t('debug.center.memory.actions.captureBaseline')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void runThreeStageBaselineCapture();
                }}
                disabled={threeStageBaselineRunning}
              >
                {t('debug.center.memory.actions.captureThreeStage')}
              </SettingsActionButton>
              <SettingsActionButton type="button" onClick={clearMemoryBaselines}>
                {t('debug.center.memory.actions.clearBaselines')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={handleExportBaselinesJson}
                disabled={memoryBaselines.length === 0}
              >
                {t('debug.center.memory.actions.exportBaselinesJson')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={handleExportBaselinesCsv}
                disabled={memoryBaselines.length === 0}
              >
                {t('debug.center.memory.actions.exportBaselinesCsv')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void handleCopyLatestScenarioSummary();
                }}
                disabled={!latestThreeStageComparison}
              >
                {t('debug.center.memory.actions.copyLatestScenarioSummary')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={() => {
                  void handleWriteLatestScenarioReport();
                }}
                disabled={!latestThreeStageComparison}
              >
                {t('debug.center.memory.actions.writeLatestScenarioReport')}
              </SettingsActionButton>
              <SettingsActionButton type="button" onClick={() => setConfirmClearCoverCaches(true)}>
                {t('debug.center.memory.actions.clearCoverCaches')}
              </SettingsActionButton>
              <SettingsActionButton
                type="button"
                onClick={() => setConfirmDestroyEditorWindows(true)}
                disabled={!isTauri}
              >
                {t('debug.center.memory.actions.destroyEditorWindows')}
              </SettingsActionButton>
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
                <p className="settings-card-desc">
                  {t('debug.center.memory.coverCaches.leases.value', {
                    leased: desktopCoverLeaseStats?.leasedEntries ?? 0,
                    active: desktopCoverLeaseStats?.activeEntries ?? 0,
                    tracked: desktopCoverLeaseStats?.trackedEntries ?? 0,
                    mb: ((desktopCoverLeaseStats?.trackedBytes ?? 0) / 1024 / 1024).toFixed(1),
                  })}
                </p>
              </div>
            </div>

            <div>
              <p className="settings-card-label">{t('debug.center.memory.musicLibrary.label')}</p>
              <p className="settings-card-desc">{t('debug.center.memory.musicLibrary.desc')}</p>
              {musicLibrarySnapshot ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <p className="settings-card-note">
                    {t('debug.center.memory.musicLibrary.captured', {
                      at: new Date(musicLibrarySnapshot.timestampMs).toLocaleString(),
                    })}
                  </p>
                  <p className="settings-card-desc">
                    {t('debug.center.memory.musicLibrary.mode', {
                      sourceMode: musicLibrarySnapshot.sourceMode,
                      baseView: musicLibrarySnapshot.baseView,
                      searchQuery: musicLibrarySnapshot.searchQuery || '-',
                      nativeBase: t(
                        `common.state.${musicLibrarySnapshot.shouldUseNativeBaseQuery ? 'on' : 'off'}`
                      ),
                      coverPolicy: musicLibrarySnapshot.coverPolicy,
                    })}
                  </p>
                  <p className="settings-card-desc">
                    {t('debug.center.memory.musicLibrary.counts', {
                      tracks: musicLibrarySnapshot.counts.tracks,
                      nativeBaseTracks: musicLibrarySnapshot.counts.nativeBaseTracks,
                      filteredTracks: musicLibrarySnapshot.counts.filteredTracks,
                      renderedTracks: musicLibrarySnapshot.counts.renderedTracks,
                      groupedRows: musicLibrarySnapshot.counts.groupedRows,
                    })}
                  </p>
                  <p className="settings-card-desc">
                    {t('debug.center.memory.musicLibrary.arrays', {
                      trackArrayMb: formatBytesToMb(musicLibrarySnapshot.attribution.trackArrayBytes),
                      tracksMb: formatBytesToMb(musicLibrarySnapshot.estimatedBytes.tracks),
                      nativeBaseMb: formatBytesToMb(musicLibrarySnapshot.estimatedBytes.nativeBaseTracks),
                    })}
                  </p>
                  <p className="settings-card-desc">
                    {t('debug.center.memory.musicLibrary.attribution', {
                      trackedRuntimeMb: formatBytesToMb(
                        musicLibrarySnapshot.attribution.trackedRuntimeBytes
                      ),
                      residualMb: formatBytesToMb(
                        musicLibrarySnapshot.attribution.webview2PrivateResidualBytes
                      ),
                      privateMinusTrackArraysMb: formatBytesToMb(
                        musicLibrarySnapshot.attribution.webview2PrivateMinusTrackArraysBytes
                      ),
                    })}
                  </p>
                  <p className="settings-card-note">
                    {t('debug.center.memory.musicLibrary.process', {
                      webview2PrivateMb: formatBytesToMb(
                        musicLibrarySnapshot.process.webview2PrivateBytes
                      ),
                      webview2WsMb: formatBytesToMb(
                        musicLibrarySnapshot.process.webview2WorkingSetBytes
                      ),
                      treePrivateMb: formatBytesToMb(musicLibrarySnapshot.process.treePrivateBytes),
                      treeWsMb: formatBytesToMb(musicLibrarySnapshot.process.treeWorkingSetBytes),
                      webview2Cpu:
                        typeof musicLibrarySnapshot.process.webview2CpuPercent === 'number' &&
                        Number.isFinite(musicLibrarySnapshot.process.webview2CpuPercent)
                          ? musicLibrarySnapshot.process.webview2CpuPercent.toFixed(1)
                          : '-',
                    })}
                  </p>
                </div>
              ) : (
                <p className="settings-card-note">{t('debug.center.memory.musicLibrary.empty')}</p>
              )}
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
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'overview' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.shortcuts.title')}</p>
              <p className="settings-card-desc">{t('debug.center.shortcuts.desc')}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <SettingsActionButton
              type="button"
              onClick={() => void handleOpenPerfMonitor()}
            >
              {t('debug.center.shortcuts.perfMonitor')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => void handleOpenNativeDebug()}
            >
              {t('debug.center.shortcuts.nativeDebug')}
            </SettingsActionButton>
            <SettingsActionButton type="button" onClick={() => void handleOpenDspRack()}>
              {t('debug.center.shortcuts.dspRack')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => void handleOpenVstManager()}
              disabled={!isTauri}
            >
              {t('debug.center.shortcuts.vstManager')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => void handleOpenThemeDebugWindow()}
              disabled={!isTauri}
            >
              {t('debug.center.shortcuts.themeDebug')}
            </SettingsActionButton>
          </div>
          </SettingsCard>
        ) : null}
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
          void invokeWithTelemetry('close_all_editor_windows', undefined, {
            moduleId: 'debug',
            component: 'DebugCenter',
            event: 'debug.editor-windows.close-all',
            successLevel: 'info',
          })
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
