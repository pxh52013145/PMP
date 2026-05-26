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
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { getGlobalProcessPerfService } from '../../services/performance-control';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { readJson, removeKey, usePersistentSetting, writeJson } from '../../modules/storage';
import {
  getDebugConfig,
  getDebugEnvSnapshot,
  getDefaultDebugConfig,
  getProcessPerfTotalsSnapshot,
  getRecentGitCommits,
  exportTelemetryBundle,
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
import { MusicLibraryService } from '../../services/audio/MusicLibraryService';
import {
  TELEMETRY_SERVICE_TOKEN,
} from '../../services/telemetry/TelemetryService';
import type { TelemetryService, TelemetrySnapshot } from '../../services/telemetry/telemetryTypes';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
  type RuntimeCapsuleManagerSnapshot,
} from '../../services/runtime-capsules';
import {
  SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN,
  type SpaceRuntimeGovernanceService,
  type SpaceRuntimeGovernanceSnapshot,
} from '../../services/governance';
import {
  buildTelemetryDiagnosticContextReport,
  getTelemetryDiagnosticContextPreset,
  type TelemetryDiagnosticContextPreset,
  type TelemetryDiagnosticContextPresetId,
} from '../../services/telemetry/aiContextReport';
import { buildTelemetryScenarioReport } from '../../services/telemetry/scenarioReport';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  readPersistedStartupMemoryTrace,
  type StartupMemoryCheckpoint,
  type StartupMemoryTraceSession,
} from '../../modules/startup/startupMemoryTrace';
import { MagnetTelemetryWorkbench } from './MagnetTelemetryWorkbench';
import { ConfirmDialog } from '../magnet/ConfirmDialog';
import { PmpButton, PmpCard, PmpChoiceButton, PmpSegmented } from '../primitives';

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
    webview2PrivateWorkingSetBytes: number | null;
    webview2PrivateBytes: number | null;
    webview2WorkingSetBytes: number | null;
    treePrivateWorkingSetBytes: number | null;
    treePrivateBytes: number | null;
    treeWorkingSetBytes: number | null;
    webview2CpuPercent: number | null;
  };
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
  webview2PrivateWorkingSetBytes?: number;
  webview2WorkingSetBytes?: number;
  webview2PrivateBytes?: number;
  treePrivateWorkingSetBytes?: number;
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
  deltaWebview2PrivateWorkingSetBytes?: number;
  deltaWebview2WorkingSetBytes?: number;
  deltaWebview2PrivateBytes?: number;
  deltaTreePrivateWorkingSetBytes?: number;
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
  | 'bundle-json'
  | 'scenario-report'
  | 'copy-diagnostic-context'
  | 'export-diagnostic-context';

type TelemetryArtifactFeedback = {
  tone: 'progress' | 'success' | 'error';
  message: string;
};

type StartupMemoryTraceFeedback = {
  tone: 'success' | 'error';
  message: string;
};

type StartupMemoryTraceDelta = {
  id: 'pixel' | 'ornaments';
  checkpoint: StartupMemoryCheckpoint;
  previous: StartupMemoryCheckpoint | null;
  treeWorkingSetDeltaBytes: number | null;
  treePrivateDeltaBytes: number | null;
  webview2WorkingSetDeltaBytes: number | null;
  webview2PrivateDeltaBytes: number | null;
};

export type DebugWorkspaceId =
  | 'overview'
  | 'runtime'
  | 'telemetry'
  | 'magnets'
  | 'memory';

type DebugCenterProps = {
  variant?: 'page' | 'settings';
  initialWorkspace?: DebugWorkspaceId;
  activeWorkspace?: DebugWorkspaceId;
  onWorkspaceChange?: (workspace: DebugWorkspaceId) => void;
  hideWorkspaceNav?: boolean;
  title?: string;
  subtitle?: string;
};

const MEMORY_BASELINE_MAX_ENTRIES = 20;
const TELEMETRY_TAIL_VISIBLE_LIMIT = 80;
const TELEMETRY_QUERY_RECORD_VISIBLE_LIMIT = 80;
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

function formatBytesToMbLabel(value: number | undefined | null): string {
  const mb = formatBytesToMb(value);
  return mb === '-' ? '-' : `${mb}MB`;
}

function formatCount(value: number | undefined | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-';
}

function formatSignedBytesToMb(value: number | undefined | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const mb = value / 1024 / 1024;
  const normalized = Object.is(mb, -0) ? 0 : mb;
  const prefix = normalized > 0 ? '+' : '';
  return `${prefix}${normalized.toFixed(1)}`;
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

function formatDebugDateTime(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return new Date(value).toLocaleString();
}

function formatElapsedMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '-';
  return `${Math.round(value)}ms`;
}

function diffTraceNumber(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (typeof current !== 'number' || !Number.isFinite(current)) return null;
  if (typeof previous !== 'number' || !Number.isFinite(previous)) return null;
  return current - previous;
}

function summarizeStartupCheckpointFields(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return '-';
  return entries
    .slice(0, 8)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' | ');
}

function buildStartupTraceDelta(
  checkpoints: readonly StartupMemoryCheckpoint[],
  id: StartupMemoryTraceDelta['id'],
  label: string
): StartupMemoryTraceDelta | null {
  const index = checkpoints.findIndex((checkpoint) => checkpoint.label === label);
  if (index < 0) return null;

  const checkpoint = checkpoints[index];
  if (!checkpoint) return null;
  const previous = index > 0 ? checkpoints[index - 1] ?? null : null;

  return {
    id,
    checkpoint,
    previous,
    treeWorkingSetDeltaBytes: diffTraceNumber(
      checkpoint.process?.totals.workingSetBytes,
      previous?.process?.totals.workingSetBytes
    ),
    treePrivateDeltaBytes: diffTraceNumber(
      checkpoint.process?.totals.privateBytes,
      previous?.process?.totals.privateBytes
    ),
    webview2WorkingSetDeltaBytes: diffTraceNumber(
      checkpoint.process?.totals.webview2WorkingSetBytes,
      previous?.process?.totals.webview2WorkingSetBytes
    ),
    webview2PrivateDeltaBytes: diffTraceNumber(
      checkpoint.process?.totals.webview2PrivateBytes,
      previous?.process?.totals.webview2PrivateBytes
    ),
  };
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
      deltaWebview2PrivateWorkingSetBytes: diffOptionalNumber(
        end.webview2PrivateWorkingSetBytes,
        start.webview2PrivateWorkingSetBytes
      ),
      deltaWebview2WorkingSetBytes: diffOptionalNumber(
        end.webview2WorkingSetBytes,
        start.webview2WorkingSetBytes
      ),
      deltaWebview2PrivateBytes: diffOptionalNumber(end.webview2PrivateBytes, start.webview2PrivateBytes),
      deltaTreePrivateWorkingSetBytes: diffOptionalNumber(
        end.treePrivateWorkingSetBytes,
        start.treePrivateWorkingSetBytes
      ),
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

type DebugMemoryActionGroupProps = {
  label: string;
  children: ReactNode;
};

function DebugMemoryActionGroup({ label, children }: DebugMemoryActionGroupProps) {
  return (
    <div className="debug-center-memory-action-group">
      <div className="debug-center-memory-action-title">{label}</div>
      <div className="debug-center-memory-actions">{children}</div>
    </div>
  );
}

type DebugMemoryMetricProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  muted?: boolean;
};

function DebugMemoryMetric({ label, value, detail, muted = false }: DebugMemoryMetricProps) {
  return (
    <div className={['debug-center-memory-metric', muted ? 'debug-center-memory-metric--muted' : ''].filter(Boolean).join(' ')}>
      <span className="debug-center-memory-metric-label">{label}</span>
      <strong className="debug-center-memory-metric-value">{value}</strong>
      {detail ? <span className="debug-center-memory-metric-detail">{detail}</span> : null}
    </div>
  );
}

type DebugMemoryTokenProps = {
  children: ReactNode;
  muted?: boolean;
};

function DebugMemoryToken({ children, muted = false }: DebugMemoryTokenProps) {
  return (
    <span className={['debug-center-memory-token', muted ? 'debug-center-memory-token--muted' : ''].filter(Boolean).join(' ')}>
      {children}
    </span>
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
    'webview2_private_working_set_bytes',
    'webview2_working_set_bytes',
    'webview2_private_bytes',
    'tree_private_working_set_bytes',
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
    sample.webview2PrivateWorkingSetBytes,
    sample.webview2WorkingSetBytes,
    sample.webview2PrivateBytes,
    sample.treePrivateWorkingSetBytes,
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
    'delta_webview2_private_working_set_bytes',
    'delta_webview2_working_set_bytes',
    'delta_webview2_private_bytes',
    'delta_tree_private_working_set_bytes',
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
    item.deltaWebview2PrivateWorkingSetBytes,
    item.deltaWebview2WorkingSetBytes,
    item.deltaWebview2PrivateBytes,
    item.deltaTreePrivateWorkingSetBytes,
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

export function DebugCenter({
  variant = 'page',
  initialWorkspace = 'overview',
  activeWorkspace: controlledActiveWorkspace,
  onWorkspaceChange,
  hideWorkspaceNav = false,
  title,
  subtitle,
}: DebugCenterProps) {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const t = useT();
  const { history } = useNavigation();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { isVisible, renderMode } = useWindowActivity();
  const debugPollingAllowed = isVisible && renderMode !== 'pause';
  const telemetryService = useMemo(
    () => kernel.services.get(TELEMETRY_SERVICE_TOKEN) as TelemetryService,
    [kernel]
  );
  const runtimeCapsuleManager = useMemo(
    () =>
      kernel.services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null,
    [kernel]
  );
  const spaceRuntimeGovernance = useMemo(
    () =>
      kernel.services.getOptional(
        SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN
      ) as SpaceRuntimeGovernanceService | null,
    [kernel]
  );
  const [config, setConfigState] = useState<DebugConfig>(() => getDefaultDebugConfig());
  const [envSnapshot, setEnvSnapshot] = useState<DebugEnvSnapshot>({});
  const [editorWindowsState, setEditorWindowsState] = useState<EditorWindowsDebugState | null>(null);
  const [coverCacheStats, setCoverCacheStats] = useState<CoverCacheStats | null>(null);
  const [desktopCoverLeaseStats, setDesktopCoverLeaseStats] = useState<DesktopCoverLeaseStats | null>(null);
  const [musicLibrarySnapshot, setMusicLibrarySnapshot] =
    useState<MusicLibraryRuntimeMemorySnapshot | null>(null);
  const [runtimeCapsuleSnapshot, setRuntimeCapsuleSnapshot] =
    useState<RuntimeCapsuleManagerSnapshot | null>(() =>
      runtimeCapsuleManager?.collectSnapshot() ?? null
    );
  const [spaceRuntimeSnapshot, setSpaceRuntimeSnapshot] =
    useState<SpaceRuntimeGovernanceSnapshot | null>(() =>
      spaceRuntimeGovernance?.collectSnapshot() ?? null
    );
  const [busy, setBusy] = useState(false);
  const [pendingRestart, setPendingRestart] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [internalActiveWorkspace, setInternalActiveWorkspace] =
    useState<DebugWorkspaceId>(initialWorkspace);
  const activeWorkspace = controlledActiveWorkspace ?? internalActiveWorkspace;
  const setActiveWorkspace = useCallback(
    (workspace: DebugWorkspaceId) => {
      if (controlledActiveWorkspace === undefined) {
        setInternalActiveWorkspace(workspace);
      }
      onWorkspaceChange?.(workspace);
    },
    [controlledActiveWorkspace, onWorkspaceChange]
  );
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
  const [pendingAutoWriteScenarioId, setPendingAutoWriteScenarioId] = useState<string | null>(null);
  const threeStageCaptureTimersRef = useRef<number[]>([]);

  const [windowCommDebug, setWindowCommDebug] = usePersistentSetting<string>(
    WINDOW_COMM_DEBUG_KEY,
    '0',
    { format: 'string' }
  );
  const windowCommDebugEnabled = windowCommDebug === '1';
  const [startupMemoryTraceEnabledSetting, setStartupMemoryTraceEnabledSetting] =
    usePersistentSetting<string>(STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED, 'false', {
      format: 'string',
      listenStorageEvents: true,
    });
  const normalizedStartupMemoryTraceSetting = startupMemoryTraceEnabledSetting.trim().toLowerCase();
  const startupMemoryTraceEnabled =
    normalizedStartupMemoryTraceSetting === '1' ||
    normalizedStartupMemoryTraceSetting === 'true' ||
    normalizedStartupMemoryTraceSetting === 'yes' ||
    normalizedStartupMemoryTraceSetting === 'on';
  const [startupMemoryTrace, setStartupMemoryTrace] = useState<StartupMemoryTraceSession | null>(() =>
    readPersistedStartupMemoryTrace()
  );
  const [startupMemoryTraceFeedback, setStartupMemoryTraceFeedback] =
    useState<StartupMemoryTraceFeedback | null>(null);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot>(() =>
    telemetryService.getSnapshot()
  );
  const [telemetryQueryPresetId, setTelemetryQueryPresetId] =
    useState<TelemetryDiagnosticContextPresetId>('general');
  const [telemetryQueryResult, setTelemetryQueryResult] = useState<TelemetryQueryResult | null>(null);
  const [telemetryQueryBusy, setTelemetryQueryBusy] = useState(false);
  const [telemetryQueryError, setTelemetryQueryError] = useState<string | null>(null);
  const [telemetryArtifactBusyAction, setTelemetryArtifactBusyAction] =
    useState<TelemetryArtifactAction | null>(null);
  const [telemetryArtifactFeedback, setTelemetryArtifactFeedback] =
    useState<TelemetryArtifactFeedback | null>(null);
  useEffect(() => {
    if (!runtimeCapsuleManager) {
      setRuntimeCapsuleSnapshot(null);
      return;
    }
    return runtimeCapsuleManager.subscribe(setRuntimeCapsuleSnapshot);
  }, [runtimeCapsuleManager]);

  useEffect(() => {
    if (!spaceRuntimeGovernance) {
      setSpaceRuntimeSnapshot(null);
      return;
    }

    const refresh = () => setSpaceRuntimeSnapshot(spaceRuntimeGovernance.collectSnapshot());
    refresh();
    if (activeWorkspace !== 'memory' || !debugPollingAllowed) return;

    const interval = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(interval);
  }, [activeWorkspace, debugPollingAllowed, spaceRuntimeGovernance]);

  useEffect(() => {
    if (activeWorkspace !== 'memory') return;
    if (!debugPollingAllowed) return;
    if (!runtimeCapsuleManager) return;

    const lease = runtimeCapsuleManager.acquireLease({
      capabilityId: 'debug.process-perf',
      ownerKind: 'debug',
      ownerId: 'debug-center:memory',
      priority: 'foreground',
      reason: {
        routeId: 'debug-center',
        detail: 'debug center memory workspace active',
      },
    });

    return () => {
      if (!lease) return;
      runtimeCapsuleManager.releaseLease(lease.id, {
        kind: 'lease-expired',
        detail: 'debug center memory workspace released',
      });
    };
  }, [activeWorkspace, debugPollingAllowed, runtimeCapsuleManager]);

  const telemetryQueryPreset = useMemo(
    () => getTelemetryDiagnosticContextPreset(telemetryQueryPresetId),
    [telemetryQueryPresetId]
  );
  const startupMemoryTraceSummary = useMemo<{
    latest: StartupMemoryCheckpoint | null;
    idle15: StartupMemoryCheckpoint | null;
    visualDeltas: StartupMemoryTraceDelta[];
  }>(() => {
    const checkpoints = startupMemoryTrace?.checkpoints ?? [];
    const visualDeltas = [
      buildStartupTraceDelta(checkpoints, 'pixel', 'pixel.renderer.created'),
      buildStartupTraceDelta(checkpoints, 'ornaments', 'ornaments.overlay.opened'),
    ].filter((item): item is StartupMemoryTraceDelta => Boolean(item));

    return {
      latest: checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] ?? null : null,
      idle15: checkpoints.find((checkpoint) => checkpoint.label === 'startup.idle.15s') ?? null,
      visualDeltas,
    };
  }, [startupMemoryTrace]);
  const startupMemoryTraceLatest = startupMemoryTraceSummary.latest;
  const startupMemoryTraceIdle15 = startupMemoryTraceSummary.idle15;
  const startupMemoryTraceVisualDeltas = startupMemoryTraceSummary.visualDeltas;
  const telemetryQueryPresetOptions = useMemo(
    () =>
      [
        { id: 'magnets' as const, label: t('debug.center.telemetry.query.preset.magnets') },
        { id: 'plugins' as const, label: t('debug.center.telemetry.query.preset.plugins') },
        { id: 'performance' as const, label: t('debug.center.telemetry.query.preset.performance') },
        { id: 'general' as const, label: t('debug.center.telemetry.query.preset.general') },
      ] satisfies Array<{ id: TelemetryDiagnosticContextPresetId; label: string }>,
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
          id: 'telemetry' as const,
          label: t('debug.center.workspace.tab.telemetry'),
          desc: t('debug.center.workspace.desc.telemetry'),
        },
        {
          id: 'memory' as const,
          label: t('debug.center.workspace.tab.memory'),
          desc: t('debug.center.workspace.desc.memory'),
        },
        {
          id: 'runtime' as const,
          label: t('debug.center.workspace.tab.runtime'),
          desc: t('debug.center.workspace.desc.runtime'),
        },
        {
          id: 'magnets' as const,
          label: t('debug.center.workspace.tab.magnets'),
          desc: t('debug.center.workspace.desc.magnets'),
        },
      ] satisfies Array<{ id: DebugWorkspaceId; label: string; desc: string }>,
    [t]
  );
  const activeWorkspaceOption = useMemo(
    () => workspaceOptions.find((option) => option.id === activeWorkspace) ?? workspaceOptions[0],
    [activeWorkspace, workspaceOptions]
  );

  useEffect(() => {
    setTelemetrySnapshot(telemetryService.getSnapshot());
    return telemetryService.subscribe((snapshot: TelemetrySnapshot) => {
      setTelemetrySnapshot(snapshot);
    });
  }, [telemetryService]);





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
    async (presetId: TelemetryDiagnosticContextPresetId) => {
      setTelemetryQueryPresetId(presetId);
      if (!isTauri) {
        setTelemetryQueryResult(null);
        setTelemetryQueryError(t('debug.center.telemetry.query.unavailable'));
        return;
      }

      setTelemetryQueryBusy(true);
      setTelemetryQueryError(null);
      try {
        const preset = getTelemetryDiagnosticContextPreset(presetId);
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
      webview2PrivateWorkingSetBytes: processTotals?.totals.webview2PrivateWorkingSetBytes,
      webview2WorkingSetBytes: processTotals?.totals.webview2WorkingSetBytes,
      webview2PrivateBytes: processTotals?.totals.webview2PrivateBytes,
      treePrivateWorkingSetBytes: processTotals?.totals.privateWorkingSetBytes,
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

  const refreshStartupMemoryTrace = useCallback(() => {
    setStartupMemoryTrace(readPersistedStartupMemoryTrace());
    setStartupMemoryTraceFeedback(null);
  }, []);

  const clearStartupMemoryTrace = useCallback(() => {
    removeKey(STORAGE_KEYS.STARTUP_MEMORY_TRACE_V1);
    setStartupMemoryTrace(null);
    setStartupMemoryTraceFeedback({
      tone: 'success',
      message: t('debug.center.startupMemoryTrace.status.cleared'),
    });
  }, [t]);

  const copyStartupMemoryTraceJson = useCallback(async () => {
    if (!startupMemoryTrace) {
      setStartupMemoryTraceFeedback({
        tone: 'error',
        message: t('debug.center.startupMemoryTrace.status.copyEmpty'),
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(startupMemoryTrace, null, 2));
      setStartupMemoryTraceFeedback({
        tone: 'success',
        message: t('debug.center.startupMemoryTrace.status.copied'),
      });
    } catch {
      setStartupMemoryTraceFeedback({
        tone: 'error',
        message: t('debug.center.startupMemoryTrace.status.copyFailed'),
      });
    }
  }, [startupMemoryTrace, t]);

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
    if (activeWorkspace !== 'memory') return;
    if (!debugPollingAllowed) return;
    void refreshMemory();
  }, [activeWorkspace, debugPollingAllowed, refreshMemory]);


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
        : action === 'bundle-json'
          ? 'debug.center.telemetry.artifacts.label.bundleJson'
        : action === 'scenario-report'
          ? 'debug.center.telemetry.artifacts.label.scenarioReport'
          : 'debug.center.telemetry.artifacts.label.diagnosticContext';
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

  const handleExportTelemetryBundleJson = useCallback(async () => {
    const action: TelemetryArtifactAction = 'bundle-json';
    setError(null);
    beginTelemetryArtifactAction(action, 'export');
    try {
      const bundle = await exportTelemetryBundle(telemetryQueryPreset.query);
      if (!bundle) {
        throw new Error(t('debug.center.telemetry.query.unavailable'));
      }

      const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sanitizeFileSegment(bundle.sessionId, 'session');
      const content = JSON.stringify(bundle, null, 2);
      const fileName = `telemetry-bundle-${safeTs}-${safeSessionId}.json`;
      const result = await saveDebugArtifact(fileName, content, 'application/json;charset=utf-8');
      completeTelemetryArtifactAction(
        action,
        result.kind === 'saved'
          ? t('debug.center.telemetry.artifacts.feedback.exportedTo', {
              label: t('debug.center.telemetry.artifacts.label.bundleJson'),
              path: result.path,
            })
          : t('debug.center.telemetry.artifacts.feedback.downloadStarted', {
              label: t('debug.center.telemetry.artifacts.label.bundleJson'),
            })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'export', err);
    }
  }, [
    beginTelemetryArtifactAction,
    completeTelemetryArtifactAction,
    failTelemetryArtifactAction,
    saveDebugArtifact,
    t,
    telemetryQueryPreset.query,
  ]);

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

  const loadTelemetryDiagnosticContextArtifact = useCallback(async (
    presetId: TelemetryDiagnosticContextPresetId = 'general'
  ): Promise<{
    preset: TelemetryDiagnosticContextPreset;
    query: TelemetryQueryInput;
    report: string;
    sessionId: string;
  }> => {
    const preset = getTelemetryDiagnosticContextPreset(presetId);
    const query = preset.query;
    const result = await queryTelemetryCurrentSession(query);
    if (!result || result.matchedRecordCount === 0) {
      throw new Error('Telemetry diagnostic context is empty.');
    }

    const perfTotals = isTauri
      ? await (
          getGlobalProcessPerfService()?.refreshTotalsSnapshot() ??
          getProcessPerfTotalsSnapshot()
        )
      : null;
    const report = buildTelemetryDiagnosticContextReport({
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

  const handleCopyTelemetryDiagnosticContext = useCallback(async (
    presetId: TelemetryDiagnosticContextPresetId = 'general'
  ) => {
    const action: TelemetryArtifactAction = 'copy-diagnostic-context';
    setError(null);
    beginTelemetryArtifactAction(action, 'copy');
    try {
      const artifact = await loadTelemetryDiagnosticContextArtifact(presetId);
      await navigator.clipboard.writeText(artifact.report);
      completeTelemetryArtifactAction(
        action,
        t('debug.center.telemetry.artifacts.feedback.copiedFromSession', {
          label: t('debug.center.telemetry.artifacts.label.diagnosticContext'),
          sessionId: artifact.sessionId,
        })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'copy', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, loadTelemetryDiagnosticContextArtifact, t]);

  const handleExportTelemetryDiagnosticContext = useCallback(async (
    presetId: TelemetryDiagnosticContextPresetId = 'general'
  ) => {
    const action: TelemetryArtifactAction = 'export-diagnostic-context';
    setError(null);
    beginTelemetryArtifactAction(action, 'export');
    try {
      const artifact = await loadTelemetryDiagnosticContextArtifact(presetId);
      const safeTs = new Date().toISOString().replace(/[:.]/g, '-');
      const safeSessionId = sanitizeFileSegment(artifact.sessionId, 'session');
      const fileName = `telemetry-${artifact.preset.fileStem}-${safeTs}-${safeSessionId}.md`;
      const result = await saveDebugArtifact(fileName, artifact.report, 'text/markdown;charset=utf-8');
      completeTelemetryArtifactAction(
        action,
        result.kind === 'saved'
          ? t('debug.center.telemetry.artifacts.feedback.exportedTo', {
              label: t('debug.center.telemetry.artifacts.label.diagnosticContext'),
              path: result.path,
            })
          : t('debug.center.telemetry.artifacts.feedback.downloadStarted', {
              label: t('debug.center.telemetry.artifacts.label.diagnosticContext'),
            })
      );
    } catch (err) {
      failTelemetryArtifactAction(action, 'export', err);
    }
  }, [beginTelemetryArtifactAction, completeTelemetryArtifactAction, failTelemetryArtifactAction, loadTelemetryDiagnosticContextArtifact, saveDebugArtifact, t]);

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
    <div className="debug-center-actions">
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
  const headerTitle = title ?? t('pages.debug-center.title');
  const headerSubtitle = subtitle ?? t('pages.debug-center.subtitle');
  const editorWindowCounts = editorWindowsState
    ? {
        alive: editorWindowsState.windows.filter((windowState) => windowState.exists).length,
        visible: editorWindowsState.windows.filter(
          (windowState) => windowState.exists && windowState.visible
        ).length,
      }
    : null;
  const editorHiddenCount = editorWindowCounts
    ? Math.max(0, editorWindowCounts.alive - editorWindowCounts.visible)
    : null;
  const coverCachesEmpty = coverCacheStats
    ? coverCacheStats.coverBlobUrlCacheEntries === 0 &&
      coverCacheStats.coverBlobUrlTotalBytes === 0 &&
      coverCacheStats.coverDecodedEstimateEntries === 0 &&
      coverCacheStats.coverDecodedEstimateTotalBytes === 0 &&
      coverCacheStats.coverUrlCacheEntries === 0 &&
      coverCacheStats.coverUrlInflight === 0 &&
      coverCacheStats.albumCoverUrlCacheEntries === 0 &&
      coverCacheStats.albumCoverUrlInflight === 0
    : false;
  const desktopCoverLeaseSnapshotAvailable = desktopCoverLeaseStats !== null;
  const desktopCoverLeasesEmpty = desktopCoverLeaseStats
    ? desktopCoverLeaseStats.trackedEntries === 0 &&
      desktopCoverLeaseStats.activeEntries === 0 &&
      desktopCoverLeaseStats.leasedEntries === 0 &&
      desktopCoverLeaseStats.trackedBytes === 0
    : false;
  const memoryCoverCachesEmpty =
    coverCachesEmpty && (!desktopCoverLeaseSnapshotAvailable || desktopCoverLeasesEmpty);
  const coverCacheSummaryText = !coverCacheStats
    ? t('debug.center.memory.coverCaches.pending')
    : memoryCoverCachesEmpty
      ? t('debug.center.memory.coverCaches.emptyNormal')
      : t('debug.center.memory.coverCaches.blobUrls.value', {
          count: formatCount(coverCacheStats.coverBlobUrlCacheEntries),
          mb: formatBytesToMb(coverCacheStats.coverBlobUrlTotalBytes),
        });
  const telemetryDroppedTotal =
    telemetrySnapshot.status.droppedRecords +
    telemetrySnapshot.queueDroppedRecords +
    telemetrySnapshot.tailDroppedRecords;
  const debugEnvInjectedCount = Object.values(envSnapshot).filter((value) => value).length;
  const startupEnvDetail = pendingRestart
    ? t('debug.center.overview.status.startupEnvDetail.pending')
    : t('debug.center.overview.status.startupEnvDetail.clean', {
        count: debugEnvInjectedCount,
      });

  const header =
    variant === 'page' ? (
      <div className="debug-center-header">
        <div className="debug-center-header-copy">
          <h1 className="debug-center-title">{headerTitle}</h1>
          {headerSubtitle ? (
            <p className="debug-center-subtitle">{headerSubtitle}</p>
          ) : null}
        </div>
        {headerActions}
      </div>
    ) : (
      <div className="debug-center-header debug-center-header--settings">{headerActions}</div>
    );

  return (
    <div className={['debug-center-root', variant === 'page' ? 'debug-center-root--page' : ''].filter(Boolean).join(' ')}>
      {header}

      {!isTauri ? (
        <div className="settings-card-note debug-center-runtime-note">
          {t('debug.center.note.requireTauri')}
        </div>
      ) : null}

      <div className="debug-center-stack">
        {!hideWorkspaceNav ? (
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
        ) : null}

        {statusMessage || error ? (
          <div className="debug-center-feedback-strip">
            {statusMessage ? (
              <p className="settings-card-note debug-center-feedback debug-center-feedback--success">
                {statusMessage}
              </p>
            ) : null}
            {error ? (
              <p className="settings-card-note debug-center-feedback debug-center-feedback--error">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        {activeWorkspace === 'overview' ? (
          <>
            <SettingsCard className="debug-center-overview-card">
              <div className="settings-card-header">
                <div>
                  <p className="settings-card-label">{t('debug.center.overview.status.title')}</p>
                  <p className="settings-card-desc">{t('debug.center.overview.status.desc')}</p>
                </div>
              </div>

              <div className="debug-center-status-grid">
                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.runtime')}
                  </span>
                  <strong className="debug-center-status-value">
                    {isTauri
                      ? t('debug.center.overview.status.runtime.tauri')
                      : t('debug.center.overview.status.runtime.web')}
                  </strong>
                  <span className="debug-center-status-detail">
                    {debugPollingAllowed
                      ? t('debug.center.overview.status.polling.active')
                      : t('debug.center.overview.status.polling.paused')}
                  </span>
                </div>

                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.telemetry')}
                  </span>
                  <strong className="debug-center-status-value">
                    {telemetrySnapshot.policy.enabled ? t('common.state.on') : t('common.state.off')}
                  </strong>
                  <span className="debug-center-status-detail">
                    {t('debug.center.overview.status.telemetryDetail', {
                      tail: telemetrySnapshot.tail.length,
                      dropped: telemetryDroppedTotal,
                    })}
                  </span>
                </div>

                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.session')}
                  </span>
                  <strong className="debug-center-status-value">
                    {telemetrySnapshot.status.currentSessionId || '-'}
                  </strong>
                  <span className="debug-center-status-detail">
                    {t('debug.center.overview.status.sessionDetail', {
                      size: formatBytesToMbLabel(telemetrySnapshot.status.currentFileBytes),
                      level: telemetrySnapshot.status.persistMinLevel,
                    })}
                  </span>
                </div>

                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.startupEnv')}
                  </span>
                  <strong className="debug-center-status-value">
                    {config.enabled ? t('common.state.on') : t('common.state.off')}
                  </strong>
                  <span className="debug-center-status-detail">{startupEnvDetail}</span>
                </div>

                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.memory')}
                  </span>
                  <strong className="debug-center-status-value">{memoryBaselines.length}</strong>
                  <span className="debug-center-status-detail">
                    {t('debug.center.overview.status.memoryDetail', {
                      trace: startupMemoryTraceEnabled ? t('common.state.on') : t('common.state.off'),
                    })}
                  </span>
                </div>

                <div className="debug-center-status-item">
                  <span className="debug-center-status-label">
                    {t('debug.center.overview.status.windowComm')}
                  </span>
                  <strong className="debug-center-status-value">
                    {windowCommDebugEnabled ? t('common.state.on') : t('common.state.off')}
                  </strong>
                  <span className="debug-center-status-detail">
                    {t('debug.center.overview.status.windowCommDetail')}
                  </span>
                </div>
              </div>
            </SettingsCard>

            <SettingsCard>
              <div className="settings-card-header">
                <div>
                  <p className="settings-card-label">{t('debug.center.shortcuts.title')}</p>
                  <p className="settings-card-desc">{t('debug.center.shortcuts.desc')}</p>
                </div>
              </div>

              <div className="debug-center-actions debug-center-actions--start debug-center-actions--cluster">
                <SettingsActionButton type="button" onClick={() => setActiveWorkspace('telemetry')}>
                  {t('debug.center.shortcuts.telemetry')}
                </SettingsActionButton>
                <SettingsActionButton
                  type="button"
                  onClick={() => void handleOpenPerfMonitor()}
                >
                  {t('debug.center.shortcuts.perfMonitor')}
                </SettingsActionButton>
                <SettingsActionButton type="button" onClick={() => setActiveWorkspace('memory')}>
                  {t('debug.center.shortcuts.memory')}
                </SettingsActionButton>
                <SettingsActionButton type="button" onClick={() => setActiveWorkspace('runtime')}>
                  {t('debug.center.shortcuts.runtime')}
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
          </>
        ) : null}


        {activeWorkspace === 'runtime' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.startupEnv.label')}</p>
              <p className="settings-card-desc">{t('debug.center.startupEnv.desc')}</p>
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

          {pendingRestart ? (
            <p className="settings-card-note">{t('debug.center.startupEnv.note.restartRequired')}</p>
          ) : null}
          {busy ? <p className="settings-card-note">{t('debug.center.startupEnv.note.saving')}</p> : null}
          </SettingsCard>
        ) : null}


        {activeWorkspace === 'runtime' ? (
          <SettingsCard>
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.vstBridge.title')}</p>
              <p className="settings-card-desc">{t('debug.center.vstBridge.desc')}</p>
            </div>
            <div className="debug-center-actions">
              <SettingsActionButton type="button" onClick={() => void refresh()} disabled={!isTauri}>
                {t('debug.center.actions.refreshEnv')}
              </SettingsActionButton>
              <SettingsActionButton type="button" onClick={handleCopyPowerShell}>
                {t('debug.center.actions.copyPowershell')}
              </SettingsActionButton>
            </div>
          </div>

          <div className="debug-center-setting-stack">
            <div>
              <div className="debug-center-setting-row">
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
              <div className="debug-center-setting-row">
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
              <div className="debug-center-setting-row">
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

              <div className="debug-center-field-row">
                <input
                  type="text"
                  value={minidumpDirDraft}
                  onChange={(e) => setMinidumpDirDraft(e.target.value)}
                  onBlur={handleMinidumpDirBlur}
                  placeholder={t('debug.center.vstBridge.minidumpDir.placeholder')}
                  className="debug-center-text-input"
                  disabled={!isTauri}
                />
                <SettingsActionButton type="button" onClick={() => void handlePickMinidumpDir()}>
                  {t('debug.center.vstBridge.minidumpDir.pick')}
                </SettingsActionButton>
              </div>
            </div>

            <div>
              <div className="debug-center-setting-row">
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
              <div className="debug-center-setting-row">
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
              <pre className="debug-center-code-block">
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
              <p className="settings-card-label">{t('debug.center.startupMemoryTrace.title')}</p>
              <p className="settings-card-desc">{t('debug.center.startupMemoryTrace.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {startupMemoryTraceEnabled ? t('common.state.on') : t('common.state.off')}
            </span>
          </div>

          <SettingsToggleGroup>
            <SettingsToggleButton
              type="button"
              active={!startupMemoryTraceEnabled}
              onClick={() => {
                setStartupMemoryTraceEnabledSetting('false');
                setStartupMemoryTraceFeedback({
                  tone: 'success',
                  message: t('debug.center.startupMemoryTrace.status.disabled'),
                });
              }}
            >
              {t('common.state.off')}
            </SettingsToggleButton>
            <SettingsToggleButton
              type="button"
              active={startupMemoryTraceEnabled}
              onClick={() => {
                setStartupMemoryTraceEnabledSetting('true');
                setStartupMemoryTraceFeedback({
                  tone: 'success',
                  message: t('debug.center.startupMemoryTrace.status.enabled'),
                });
              }}
            >
              {t('common.state.on')}
            </SettingsToggleButton>
          </SettingsToggleGroup>

          <p className="settings-card-note">
            {t('debug.center.startupMemoryTrace.note', {
              key: STORAGE_KEYS.STARTUP_MEMORY_TRACE_ENABLED,
            })}
          </p>

          <div className="debug-center-actions debug-center-actions--start">
            <SettingsActionButton type="button" onClick={refreshStartupMemoryTrace}>
              {t('common.action.refresh')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              onClick={() => void copyStartupMemoryTraceJson()}
              disabled={!startupMemoryTrace}
            >
              {t('debug.center.startupMemoryTrace.action.copyJson')}
            </SettingsActionButton>
            <SettingsActionButton type="button" onClick={clearStartupMemoryTrace} disabled={!startupMemoryTrace}>
              {t('debug.center.startupMemoryTrace.action.clear')}
            </SettingsActionButton>
          </div>

          {startupMemoryTrace ? (
            <div className="debug-center-note-stack">
              <p className="settings-card-desc">
                {t('debug.center.startupMemoryTrace.summary', {
                  sessionId: startupMemoryTrace.sessionId,
                  count: startupMemoryTrace.checkpoints.length,
                  startedAt: formatDebugDateTime(startupMemoryTrace.startedAtMs),
                })}
              </p>
              {startupMemoryTraceLatest ? (
                <p className="settings-card-desc">
                  {t('debug.center.startupMemoryTrace.latest', {
                    label: startupMemoryTraceLatest.label,
                    at: formatElapsedMs(startupMemoryTraceLatest.performanceNowMs),
                    treeWsMb: formatBytesToMb(startupMemoryTraceLatest.process?.totals.workingSetBytes),
                    webview2PrivateMb: formatBytesToMb(
                      startupMemoryTraceLatest.process?.totals.webview2PrivateBytes
                    ),
                  })}
                </p>
              ) : null}
              {startupMemoryTraceIdle15 ? (
                <p className="settings-card-desc">
                  {t('debug.center.startupMemoryTrace.idle15', {
                    treeWsMb: formatBytesToMb(startupMemoryTraceIdle15.process?.totals.workingSetBytes),
                    treePrivateMb: formatBytesToMb(startupMemoryTraceIdle15.process?.totals.privateBytes),
                    webview2WsMb: formatBytesToMb(
                      startupMemoryTraceIdle15.process?.totals.webview2WorkingSetBytes
                    ),
                    webview2PrivateMb: formatBytesToMb(
                      startupMemoryTraceIdle15.process?.totals.webview2PrivateBytes
                    ),
                  })}
                </p>
              ) : null}
              {startupMemoryTraceLatest?.backend ? (
                <p className="settings-card-desc">
                  {t('debug.center.startupMemoryTrace.backend', {
                    musicLibrary: startupMemoryTraceLatest.backend.musicLibraryServicesInitialized
                      ? t('common.state.on')
                      : t('common.state.off'),
                    vst: startupMemoryTraceLatest.backend.vstServicesInitialized
                      ? t('common.state.on')
                      : t('common.state.off'),
                  })}
                </p>
              ) : null}
              {startupMemoryTraceLatest ? (
                <p className="settings-card-desc">
                  {t('debug.center.startupMemoryTrace.flags', {
                    audio: startupMemoryTraceLatest.flags.nativeAudioConstructed
                      ? t('common.state.on')
                      : t('common.state.off'),
                    pixel: startupMemoryTraceLatest.flags.pixelRendererCreated
                      ? t('common.state.on')
                      : t('common.state.off'),
                    ornaments: startupMemoryTraceLatest.flags.ornamentsOverlayOpened
                      ? t('common.state.on')
                      : t('common.state.off'),
                  })}
                </p>
              ) : null}
              <div className="debug-center-inset-panel">
                <p className="settings-card-label">
                  {t('debug.center.startupMemoryTrace.visualDeltas.title')}
                </p>
                <p className="settings-card-desc">
                  {t('debug.center.startupMemoryTrace.visualDeltas.desc')}
                </p>
                {startupMemoryTraceVisualDeltas.length === 0 ? (
                  <p className="settings-card-note debug-center-note-offset">
                    {t('debug.center.startupMemoryTrace.visualDeltas.empty')}
                  </p>
                ) : (
                  <div className="debug-center-note-stack debug-center-note-stack--compact">
                    {startupMemoryTraceVisualDeltas.map((delta) => (
                      <p className="settings-card-note" key={delta.id}>
                        {t('debug.center.startupMemoryTrace.visualDeltas.item', {
                          name: t(`debug.center.startupMemoryTrace.visualDeltas.name.${delta.id}`),
                          label: delta.checkpoint.label,
                          previous: delta.previous?.label ?? '-',
                          at: formatElapsedMs(delta.checkpoint.performanceNowMs),
                          treeWsDeltaMb: formatSignedBytesToMb(delta.treeWorkingSetDeltaBytes),
                          treePrivateDeltaMb: formatSignedBytesToMb(delta.treePrivateDeltaBytes),
                          webview2WsDeltaMb: formatSignedBytesToMb(delta.webview2WorkingSetDeltaBytes),
                          webview2PrivateDeltaMb: formatSignedBytesToMb(delta.webview2PrivateDeltaBytes),
                          fields: summarizeStartupCheckpointFields(delta.checkpoint.fields),
                        })}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="settings-card-note debug-center-note-offset">
              {t('debug.center.startupMemoryTrace.empty')}
            </p>
          )}

          {startupMemoryTraceFeedback ? (
            <p
              className="settings-card-note"
              data-tone={startupMemoryTraceFeedback.tone}
            >
              {startupMemoryTraceFeedback.message}
            </p>
          ) : null}
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
          <SettingsCard className="debug-center-telemetry-card">
          <div className="settings-card-header">
            <div>
              <p className="settings-card-label">{t('debug.center.telemetry.runtime.title')}</p>
              <p className="settings-card-desc">{t('debug.center.telemetry.runtime.desc')}</p>
            </div>
            <span className="settings-card-badge">
              {telemetrySnapshot.transportAvailable ? 'transport:on' : 'transport:off'}
            </span>
          </div>

          <div className="debug-center-actions debug-center-actions--start debug-center-actions--spaced">
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

          <div className="debug-center-note-stack">
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
              <p className="settings-card-note debug-center-feedback debug-center-feedback--error">
                lastError={telemetrySnapshot.status.lastError}
              </p>
            ) : null}
          </div>

          <div className="debug-center-section-block">
            <p className="settings-card-label">{t('debug.center.telemetry.runtime.recentTail')}</p>
            {telemetrySnapshot.tail.length === 0 ? (
              <p className="settings-card-note">{t('debug.center.telemetry.runtime.empty')}</p>
            ) : (
              <pre className="debug-center-code-block debug-center-telemetry-log debug-center-code-block--telemetry-tail">
                {telemetrySnapshot.tail
                  .slice(-TELEMETRY_TAIL_VISIBLE_LIMIT)
                  .reverse()
                  .map((record) => formatTelemetryRecordLine(record))
                  .join('\n')}
              </pre>
            )}
          </div>
          <div className="debug-center-inset-panel debug-center-inset-panel--prominent">
            <div className="debug-center-setting-row">
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

            <div className="debug-center-section-block">
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

            <p className="settings-card-note debug-center-note-offset">
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
              <p className="settings-card-note debug-center-feedback debug-center-feedback--error debug-center-note-offset">
                {telemetryQueryError}
              </p>
            ) : null}

            {telemetryQueryResult ? (
              <>
                <p className="settings-card-desc debug-center-note-offset">
                  {t('debug.center.telemetry.query.results', {
                    matched: telemetryQueryResult.matchedRecordCount,
                    scanned: telemetryQueryResult.scannedRecordCount,
                    sessionId: telemetryQueryResult.status.currentSessionId,
                    window: formatTelemetryQueryWindow(telemetryQueryResult),
                  })}
                </p>

                <div className="debug-center-result-grid">
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topEvents')}</p>
                    <pre className="debug-center-code-block debug-center-code-block--compact">
                      {formatTelemetryCountList(telemetryQueryResult.eventCounts)}
                    </pre>
                  </div>
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topModules')}</p>
                    <pre className="debug-center-code-block debug-center-code-block--compact">
                      {formatTelemetryCountList(telemetryQueryResult.moduleCounts)}
                    </pre>
                  </div>
                  <div>
                    <p className="settings-card-note">{t('debug.center.telemetry.query.topLevels')}</p>
                    <pre className="debug-center-code-block debug-center-code-block--compact">
                      {formatTelemetryCountList(telemetryQueryResult.levelCounts)}
                    </pre>
                  </div>
                </div>

                <div className="debug-center-section-block">
                  <p className="settings-card-note">{t('debug.center.telemetry.query.recentRecords')}</p>
                  {telemetryQueryResult.records.length === 0 ? (
                    <p className="settings-card-note debug-center-note-offset">
                      {t('debug.center.telemetry.query.empty')}
                    </p>
                  ) : (
                    <pre className="debug-center-code-block debug-center-telemetry-log debug-center-code-block--telemetry-records">
                      {telemetryQueryResult.records
                        .slice(-TELEMETRY_QUERY_RECORD_VISIBLE_LIMIT)
                        .reverse()
                        .map((record) => formatTelemetryRecordLine(record))
                        .join('\n')}
                    </pre>
                  )}
                </div>
              </>
            ) : null}
          </div>
          <div className="debug-center-actions debug-center-actions--start debug-center-actions--section">
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
                void handleExportTelemetryBundleJson();
              }}
            >
              {t('debug.center.telemetry.artifacts.action.exportBundleJson')}
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
                void handleCopyTelemetryDiagnosticContext(telemetryQueryPresetId);
              }}
            >
              {t('debug.center.telemetry.artifacts.action.copyDiagnosticContext')}
            </SettingsActionButton>
            <SettingsActionButton
              type="button"
              disabled={telemetryArtifactBusyAction !== null}
              onClick={() => {
                void handleExportTelemetryDiagnosticContext(telemetryQueryPresetId);
              }}
            >
              {t('debug.center.telemetry.artifacts.action.exportDiagnosticContext')}
            </SettingsActionButton>
          </div>
          {telemetryArtifactFeedback ? (
            <p
              className="settings-card-note"
              data-tone={telemetryArtifactFeedback.tone}
            >
              {telemetryArtifactFeedback.message}
            </p>
          ) : null}
          </SettingsCard>
        ) : null}

        {activeWorkspace === 'magnets' ? <MagnetTelemetryWorkbench active /> : null}

        {activeWorkspace === 'memory' ? (
          <>
            <SettingsCard className="debug-center-memory-card">
              <div className="settings-card-header debug-center-memory-header">
                <div className="debug-center-memory-copy">
                  <p className="settings-card-label">{t('debug.center.memory.title')}</p>
                  <p className="settings-card-desc">{t('debug.center.memory.desc')}</p>
                </div>
              </div>

              <div className="debug-center-memory-actions-grid">
                <DebugMemoryActionGroup label={t('debug.center.memory.actionGroup.capture')}>
                  <SettingsActionButton type="button" onClick={() => void refreshMemory()}>
                    {t('common.action.refresh')}
                  </SettingsActionButton>
                  <SettingsActionButton type="button" onClick={() => void captureMemoryBaseline()}>
                    {t('debug.center.memory.actions.captureBaseline')}
                  </SettingsActionButton>
                  <SettingsActionButton
                    type="button"
                    onClick={() => void runThreeStageBaselineCapture()}
                    disabled={threeStageBaselineRunning}
                  >
                    {t('debug.center.memory.actions.captureThreeStage')}
                  </SettingsActionButton>
                  <SettingsActionButton type="button" onClick={clearMemoryBaselines}>
                    {t('debug.center.memory.actions.clearBaselines')}
                  </SettingsActionButton>
                </DebugMemoryActionGroup>

                <DebugMemoryActionGroup label={t('debug.center.memory.actionGroup.report')}>
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
                    onClick={() => void handleCopyLatestScenarioSummary()}
                    disabled={!latestThreeStageComparison}
                  >
                    {t('debug.center.memory.actions.copyLatestScenarioSummary')}
                  </SettingsActionButton>
                  <SettingsActionButton
                    type="button"
                    onClick={() => void handleWriteLatestScenarioReport()}
                    disabled={!latestThreeStageComparison}
                  >
                    {t('debug.center.memory.actions.writeLatestScenarioReport')}
                  </SettingsActionButton>
                </DebugMemoryActionGroup>

                <DebugMemoryActionGroup label={t('debug.center.memory.actionGroup.cleanup')}>
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
                </DebugMemoryActionGroup>
              </div>

              {threeStageBaselineRunning ? (
                <p className="settings-card-note">{t('debug.center.memory.baselines.running')}</p>
              ) : null}
            </SettingsCard>

            <div className="debug-center-memory-grid">
              <SettingsCard className="debug-center-memory-section debug-center-memory-section--wide">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.runtimeCapsules.label')}</p>
                    <p className="settings-card-desc">
                      {runtimeCapsuleSnapshot
                        ? t('debug.center.memory.runtimeCapsules.summary', {
                            capsules: runtimeCapsuleSnapshot.capsules.length,
                            leases: runtimeCapsuleSnapshot.activeLeaseCount,
                            capabilities: runtimeCapsuleSnapshot.registeredCapabilityCount,
                          })
                        : t('debug.center.memory.runtimeCapsules.empty')}
                    </p>
                  </div>
                </div>

                {runtimeCapsuleSnapshot ? (
                  <>
                    <div className="debug-center-memory-metric-grid">
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.capsules')}
                        value={runtimeCapsuleSnapshot.capsules.length}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.activeLeases')}
                        value={runtimeCapsuleSnapshot.activeLeaseCount}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.capabilities')}
                        value={runtimeCapsuleSnapshot.registeredCapabilityCount}
                      />
                    </div>
                    <div className="debug-center-memory-list">
                      {runtimeCapsuleSnapshot.capsules.map((capsule) => (
                        <div className="debug-center-memory-list-row" key={capsule.manifest.id}>
                          <span className="debug-center-memory-list-title">
                            {capsule.manifest.id}
                          </span>
                          <div className="debug-center-memory-token-row">
                            <DebugMemoryToken>{capsule.state}</DebugMemoryToken>
                            <DebugMemoryToken muted>
                              {t('debug.center.memory.token.tier', {
                                value: capsule.manifest.memoryTier,
                              })}
                            </DebugMemoryToken>
                            <DebugMemoryToken muted={capsule.activeLeases.length === 0}>
                              {t('debug.center.memory.token.lease', {
                                value: capsule.activeLeases.length,
                              })}
                            </DebugMemoryToken>
                            <DebugMemoryToken muted>
                              {t('debug.center.memory.token.startup', {
                                value: capsule.manifest.startup,
                              })}
                            </DebugMemoryToken>
                            <DebugMemoryToken muted>
                              {t('debug.center.memory.token.background', {
                                value: capsule.manifest.backgroundPolicy,
                              })}
                            </DebugMemoryToken>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section debug-center-memory-section--wide">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.spaceRuntime.label')}</p>
                    <p className="settings-card-desc">
                      {spaceRuntimeSnapshot
                        ? t('debug.center.memory.spaceRuntime.summary', {
                            active: spaceRuntimeSnapshot.activeSpaceId ?? '-',
                            frozen: spaceRuntimeSnapshot.frozenSpaceIds.length,
                            hibernated: spaceRuntimeSnapshot.hibernatedSpaceIds.length,
                            reclaimable: spaceRuntimeSnapshot.reclaimableSpaceIds.length,
                          })
                        : t('debug.center.memory.spaceRuntime.empty')}
                    </p>
                  </div>
                </div>

                {spaceRuntimeSnapshot ? (
                  <>
                    <div className="debug-center-memory-metric-grid">
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.activeSpace')}
                        value={spaceRuntimeSnapshot.activeSpaceId ?? '-'}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.frozen')}
                        value={spaceRuntimeSnapshot.frozenSpaceIds.length}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.hibernated')}
                        value={spaceRuntimeSnapshot.hibernatedSpaceIds.length}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.reclaimable')}
                        value={spaceRuntimeSnapshot.reclaimableSpaceIds.length}
                      />
                    </div>
                    <div className="debug-center-memory-list">
                      {spaceRuntimeSnapshot.descriptors.map((descriptor) => (
                        <div className="debug-center-memory-list-row" key={descriptor.spaceId}>
                          <span className="debug-center-memory-list-title">
                            {descriptor.spaceId}
                          </span>
                          <div className="debug-center-memory-token-row">
                            <DebugMemoryToken>{descriptor.state}</DebugMemoryToken>
                            <DebugMemoryToken muted>{descriptor.kind}</DebugMemoryToken>
                            <DebugMemoryToken muted>
                              {t('debug.center.memory.token.tier', {
                                value: descriptor.memoryTier,
                              })}
                            </DebugMemoryToken>
                            <DebugMemoryToken muted={descriptor.activeAssociationCount === 0}>
                              {t('debug.center.memory.token.associations', {
                                value: descriptor.activeAssociationCount,
                              })}
                            </DebugMemoryToken>
                            <DebugMemoryToken muted={descriptor.participants.length === 0}>
                              {t('debug.center.memory.token.participants', {
                                value: descriptor.participants.length,
                              })}
                            </DebugMemoryToken>
                          </div>
                          {descriptor.participants.length > 0 ? (
                            <div className="debug-center-memory-sublist">
                              {descriptor.participants.map((participant) => (
                                <div className="debug-center-memory-subrow" key={participant.id}>
                                  <span className="debug-center-memory-list-subtitle">
                                    {participant.id}
                                  </span>
                                  <div className="debug-center-memory-token-row">
                                    <DebugMemoryToken>{participant.state}</DebugMemoryToken>
                                    <DebugMemoryToken muted>{participant.capsuleId}</DebugMemoryToken>
                                    <DebugMemoryToken muted>
                                      {t('debug.center.memory.token.timers', {
                                        value: participant.timers ?? 0,
                                      })}
                                    </DebugMemoryToken>
                                    <DebugMemoryToken muted>
                                      {t('debug.center.memory.token.listeners', {
                                        value: participant.listeners ?? 0,
                                      })}
                                    </DebugMemoryToken>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.editorWindows.label')}</p>
                    <p className="settings-card-desc">
                      {editorWindowCounts
                        ? t('debug.center.memory.editorWindows.stats', {
                            alive: editorWindowCounts.alive,
                            visible: editorWindowCounts.visible,
                            hidden: editorHiddenCount ?? 0,
                          })
                        : t('debug.center.memory.editorWindows.unavailable')}
                    </p>
                  </div>
                </div>
                {editorWindowCounts ? (
                  <div className="debug-center-memory-metric-grid">
                    <DebugMemoryMetric
                      label={t('debug.center.memory.metric.alive')}
                      value={editorWindowCounts.alive}
                    />
                    <DebugMemoryMetric
                      label={t('debug.center.memory.metric.visible')}
                      value={editorWindowCounts.visible}
                    />
                    <DebugMemoryMetric
                      label={t('debug.center.memory.metric.hidden')}
                      value={editorHiddenCount ?? 0}
                    />
                    <DebugMemoryMetric
                      label={t('debug.center.memory.metric.cachedHidden')}
                      value={editorWindowsState?.cachedHidden ?? '-'}
                      muted={!editorWindowsState?.cachedHidden}
                    />
                  </div>
                ) : null}
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.coverCaches.label')}</p>
                    <p className="settings-card-desc">{coverCacheSummaryText}</p>
                  </div>
                </div>
                <div className="debug-center-memory-metric-grid">
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.blobUrls')}
                    value={formatCount(coverCacheStats?.coverBlobUrlCacheEntries)}
                    detail={formatBytesToMbLabel(coverCacheStats?.coverBlobUrlTotalBytes)}
                    muted={coverCacheStats?.coverBlobUrlCacheEntries === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.decoded')}
                    value={formatCount(coverCacheStats?.coverDecodedEstimateEntries)}
                    detail={formatBytesToMbLabel(coverCacheStats?.coverDecodedEstimateTotalBytes)}
                    muted={coverCacheStats?.coverDecodedEstimateEntries === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.urlMap')}
                    value={formatCount(coverCacheStats?.coverUrlCacheEntries)}
                    muted={coverCacheStats?.coverUrlCacheEntries === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.inflight')}
                    value={formatCount(coverCacheStats?.coverUrlInflight)}
                    muted={coverCacheStats?.coverUrlInflight === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.albumCovers')}
                    value={formatCount(coverCacheStats?.albumCoverUrlCacheEntries)}
                    muted={coverCacheStats?.albumCoverUrlCacheEntries === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.rustLeases')}
                    value={formatCount(desktopCoverLeaseStats?.leasedEntries)}
                    detail={
                      desktopCoverLeaseSnapshotAvailable
                        ? t('debug.center.memory.metric.rustLeases.detail', {
                            active: desktopCoverLeaseStats?.activeEntries ?? 0,
                            tracked: desktopCoverLeaseStats?.trackedEntries ?? 0,
                            mb: formatBytesToMb(desktopCoverLeaseStats?.trackedBytes),
                          })
                        : t('debug.center.memory.coverCaches.leasesUnavailable')
                    }
                    muted={!desktopCoverLeaseSnapshotAvailable || desktopCoverLeaseStats?.leasedEntries === 0}
                  />
                </div>
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section debug-center-memory-section--wide">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.musicLibrary.label')}</p>
                    <p className="settings-card-desc">{t('debug.center.memory.musicLibrary.desc')}</p>
                  </div>
                </div>
                {musicLibrarySnapshot ? (
                  <>
                    <p className="settings-card-note">
                      {t('debug.center.memory.musicLibrary.captured', {
                        at: new Date(musicLibrarySnapshot.timestampMs).toLocaleString(),
                      })}
                    </p>
                    <div className="debug-center-memory-metric-grid">
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.tracks')}
                        value={musicLibrarySnapshot.counts.tracks}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.renderedTracks')}
                        value={musicLibrarySnapshot.counts.renderedTracks}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.trackArrays')}
                        value={formatBytesToMbLabel(musicLibrarySnapshot.attribution.trackArrayBytes)}
                      />
                      <DebugMemoryMetric
                        label={t('debug.center.memory.metric.webview2Private')}
                        value={formatBytesToMbLabel(
                          musicLibrarySnapshot.process.webview2PrivateBytes
                        )}
                      />
                    </div>
                    <div className="debug-center-memory-note-stack">
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
                    </div>
                  </>
                ) : (
                  <p className="settings-card-note">{t('debug.center.memory.musicLibrary.empty')}</p>
                )}
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.navigation.label')}</p>
                    <p className="settings-card-desc">{t('debug.center.memory.navigation.desc')}</p>
                  </div>
                </div>
                <div className="debug-center-memory-metric-grid">
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.historyEntries')}
                    value={navigationHistoryStats.count}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.historySize')}
                    value={`${(navigationHistoryStats.bytes / 1024).toFixed(1)}KB`}
                  />
                </div>
              </SettingsCard>

              <SettingsCard className="debug-center-memory-section">
                <div className="debug-center-memory-section-header">
                  <div>
                    <p className="settings-card-label">{t('debug.center.memory.baselines.label')}</p>
                    <p className="settings-card-desc">{t('debug.center.memory.baselines.desc')}</p>
                  </div>
                </div>
                <div className="debug-center-memory-metric-grid">
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.baselineCount')}
                    value={memoryBaselines.length}
                    muted={memoryBaselines.length === 0}
                  />
                  <DebugMemoryMetric
                    label={t('debug.center.memory.metric.latestDelta')}
                    value={latestThreeStageDelta ? latestThreeStageDelta.sampleCount : '-'}
                    muted={!latestThreeStageDelta}
                  />
                </div>
                {memoryBaselines.length === 0 ? (
                  <p className="settings-card-note">{t('debug.center.memory.baselines.empty')}</p>
                ) : (
                  <div className="debug-center-memory-list">
                    {memoryBaselines.slice(0, 8).map((sample) => (
                      <div className="debug-center-memory-list-row" key={sample.id}>
                        <span className="debug-center-memory-list-title">
                          {t(`debug.center.memory.baselines.stage.${sample.stage}`)}
                        </span>
                        <span className="debug-center-memory-list-subtitle">
                          {new Date(sample.capturedAtMs).toLocaleString()}
                        </span>
                        <div className="debug-center-memory-token-row">
                          <DebugMemoryToken muted>
                            {t('debug.center.memory.baselines.token.js', {
                              value: formatBytesToMbLabel(sample.jsHeapUsedBytes),
                            })}
                          </DebugMemoryToken>
                          <DebugMemoryToken muted>
                            {t('debug.center.memory.baselines.token.webview2', {
                              value: formatBytesToMbLabel(sample.webview2PrivateBytes),
                            })}
                          </DebugMemoryToken>
                          <DebugMemoryToken muted>
                            {t('debug.center.memory.baselines.token.blob', {
                              value: formatBytesToMbLabel(sample.coverBlobUrlTotalBytes),
                            })}
                          </DebugMemoryToken>
                          <DebugMemoryToken muted>
                            {t('debug.center.memory.baselines.token.decoded', {
                              value: formatBytesToMbLabel(sample.coverDecodedEstimateTotalBytes),
                            })}
                          </DebugMemoryToken>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {latestThreeStageDelta ? (
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
                ) : null}
              </SettingsCard>
            </div>
          </>
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
