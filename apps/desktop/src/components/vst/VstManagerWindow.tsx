import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { readJson, writeJson } from '../../modules/storage';
import { useLocale, useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  readData,
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  setupDualListener,
} from '../../utils/windowCommunication';
import './VstManagerWindow.css';

type VstScanMode = 'fast' | 'full' | 'params';

type VstBufferProfile = 'stable' | 'balanced' | 'low-latency';
type VstSidechainMode = 'disabled' | 'silence' | 'self';

type VstSettings = {
  bufferProfile: VstBufferProfile;
  sidechainMode: VstSidechainMode;
  sidechainChannels: number;
};

type VstMonoInputPolicy = 'sum-average' | 'left-only';
type VstCompatScope = 'plugin' | 'vendor';

type VstCompatRule = {
  editorSafeMode: boolean;
  loadOnUiThread: boolean;
  monoInput: VstMonoInputPolicy;
};

type VstCompatQueryResult = {
  pluginId: string;
  vendor?: string | null;
  effective: VstCompatRule;
  pluginOverride?: VstCompatRule | null;
  vendorOverride?: VstCompatRule | null;
};

type VstScanState = {
  running: boolean;
  runId?: string | null;
  mode?: VstScanMode | null;
  stage?: string | null;
  total: number;
  current: number;
  currentPluginId?: string | null;
  lastError?: string | null;
};

type VstScanProgressPayload = {
  runId: string;
  mode: VstScanMode;
  stage: string;
  total: number;
  current: number;
  currentPluginId?: string | null;
  message?: string | null;
  status: string;
  error?: string | null;
};

type VstScanRun = {
  runId: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  status: string;
  error?: string | null;
};

type VstScanEvent = {
  atMs: number;
  kind: string;
  pluginId?: string | null;
  message: string;
};

type VstScanRunSummary = {
  runId: string;
  mode?: string | null;
  startedAtMs: number;
  finishedAtMs?: number | null;
  durationMs: number;
  status: string;
  error?: string | null;
  eventsTotal: number;
  pluginsSeen: number;
  paramsScanned: number;
  eventCounts: Record<string, number>;
  lastDeadmanHint?: string | null;
};

type LibraryParamDescriptor = {
  key: string;
  title: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string | null;
  scannedAtMs: number;
};

type LibraryPluginDescriptor = {
  id: string;
  name: string;
  vendor?: string | null;
  version?: string | null;
  path?: string | null;
  status?: string | null;
  lastSeenAtMs?: number | null;
  paramsScannedAtMs?: number | null;
  inputChannels?: number | null;
  outputChannels?: number | null;
  paramsCount?: number | null;
  paramsAttemptedAtMs?: number | null;
  paramsFailureCount?: number | null;
};

type VstScanPath = {
  enabled: boolean;
  path: string;
};

type VstScanSettingsV1 = {
  version: 1;
  includeDefaultPaths: boolean;
  scanPaths: VstScanPath[];
};

const LEGACY_VST_SCAN_PATHS_STORAGE_KEY = 'pixel-matrix-vst3-scan-paths-v1';

type DspNodeBase = {
  id: string;
  enabled: boolean;
  type: string;
};

type GainNode = DspNodeBase & { type: 'gain'; db: number };
type VstParamValue = { key: string; value: number };
type VstNode = DspNodeBase & { type: 'vst'; pluginId: string; params?: VstParamValue[] };
type DspNode = GainNode | VstNode | (DspNodeBase & Record<string, unknown>);

type DspGraphConfig = { nodes: DspNode[] };

type RackPluginUsage = {
  total: number;
  enabled: number;
  nodeIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function readStringField(value: unknown, field: string): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const candidate = record[field];
  return typeof candidate === 'string' ? candidate : null;
}

function readNumberField(value: unknown, field: string): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const candidate = record[field];
  return typeof candidate === 'number' && isFinite(candidate) ? candidate : null;
}

function clamp(value: number, min: number, max: number) {
  if (!isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function computeTotalGainDb(nodes: DspNode[]) {
  let sum = 0;
  for (const node of nodes) {
    if (!node.enabled) continue;
    if (node.type !== 'gain') continue;
    const db = readNumberField(node, 'db');
    if (db !== null) sum += db;
  }
  return clamp(sum, -60, 12);
}

function ensureDspGraphConfig(value: unknown): DspGraphConfig {
  const record = asRecord(value);
  if (!record) return { nodes: [] };
  const nodes = record.nodes;
  return { nodes: Array.isArray(nodes) ? (nodes as DspNode[]) : [] };
}

function buildRackUsage(value: unknown): Record<string, RackPluginUsage> {
  const graph = ensureDspGraphConfig(value);
  const out: Record<string, RackPluginUsage> = {};

  for (const node of graph.nodes) {
    const record = asRecord(node);
    if (!record) continue;
    if (record.type !== 'vst') continue;

    const pluginId = readStringField(record, 'pluginId');
    if (!pluginId || !pluginId.trim()) continue;

    const nodeId = readStringField(record, 'id') ?? '';
    const enabled = typeof record.enabled === 'boolean' ? record.enabled : Boolean(record.enabled);

    const entry = out[pluginId] ?? { total: 0, enabled: 0, nodeIds: [] };
    entry.total += 1;
    if (enabled) entry.enabled += 1;
    if (nodeId) entry.nodeIds.push(nodeId);
    out[pluginId] = entry;
  }

  return out;
}

function uniqueNodeId(type: string) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isVstScanMode(value: string): value is VstScanMode {
  return value === 'fast' || value === 'full' || value === 'params';
}

function isVstBufferProfile(value: string): value is VstBufferProfile {
  return value === 'stable' || value === 'balanced' || value === 'low-latency';
}

function isVstSidechainMode(value: string): value is VstSidechainMode {
  return value === 'disabled' || value === 'silence' || value === 'self';
}

function defaultVstSettings(): VstSettings {
  return { bufferProfile: 'stable', sidechainMode: 'disabled', sidechainChannels: 0 };
}

function ensureVstSettings(value: unknown): VstSettings {
  const record = asRecord(value);
  if (!record) return defaultVstSettings();

  const bufferProfile = readStringField(record, 'bufferProfile');
  const sidechainMode = readStringField(record, 'sidechainMode');
  const sidechainChannels = readNumberField(record, 'sidechainChannels');

  return {
    bufferProfile: bufferProfile && isVstBufferProfile(bufferProfile) ? bufferProfile : 'stable',
    sidechainMode: sidechainMode && isVstSidechainMode(sidechainMode) ? sidechainMode : 'disabled',
    sidechainChannels:
      sidechainChannels !== null && sidechainChannels >= 0 && sidechainChannels <= 2
        ? Math.floor(sidechainChannels)
        : 0,
  };
}

function isVstMonoInputPolicy(value: string): value is VstMonoInputPolicy {
  return value === 'sum-average' || value === 'left-only';
}

function defaultCompatRule(): VstCompatRule {
  return { editorSafeMode: true, loadOnUiThread: true, monoInput: 'sum-average' };
}

function ensureCompatRule(value: unknown): VstCompatRule {
  const record = asRecord(value);
  if (!record) return defaultCompatRule();

  const monoInput = readStringField(record, 'monoInput');
  return {
    editorSafeMode: typeof record.editorSafeMode === 'boolean' ? record.editorSafeMode : true,
    loadOnUiThread: typeof record.loadOnUiThread === 'boolean' ? record.loadOnUiThread : true,
    monoInput: monoInput && isVstMonoInputPolicy(monoInput) ? monoInput : 'sum-average',
  };
}

function ensureCompatQueryResult(value: unknown): VstCompatQueryResult | null {
  const record = asRecord(value);
  if (!record) return null;
  const pluginId = readStringField(record, 'pluginId');
  const effectiveRaw = record.effective;
  if (!pluginId || !effectiveRaw) return null;

  const vendor = readStringField(record, 'vendor');
  const pluginOverride = record.pluginOverride ? ensureCompatRule(record.pluginOverride) : null;
  const vendorOverride = record.vendorOverride ? ensureCompatRule(record.vendorOverride) : null;
  return {
    pluginId,
    vendor,
    effective: ensureCompatRule(effectiveRaw),
    pluginOverride,
    vendorOverride,
  };
}

function ensureVstScanState(value: unknown): VstScanState | null {
  const record = asRecord(value);
  if (!record) return null;
  const running = typeof record.running === 'boolean' ? record.running : null;
  if (running === null) return null;
  const mode = typeof record.mode === 'string' && isVstScanMode(record.mode) ? record.mode : null;

  return {
    running,
    runId: typeof record.runId === 'string' ? record.runId : null,
    mode,
    stage: typeof record.stage === 'string' ? record.stage : null,
    total: typeof record.total === 'number' ? record.total : 0,
    current: typeof record.current === 'number' ? record.current : 0,
    currentPluginId: typeof record.currentPluginId === 'string' ? record.currentPluginId : null,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
  };
}

function ensureVstScanProgressPayload(value: unknown): VstScanProgressPayload | null {
  const record = asRecord(value);
  if (!record) return null;
  const runId = readStringField(record, 'runId');
  const mode = readStringField(record, 'mode');
  const stage = readStringField(record, 'stage');
  const status = readStringField(record, 'status');
  if (!runId || !mode || !stage || !status) return null;
  if (!isVstScanMode(mode)) return null;

  return {
    runId,
    mode,
    stage,
    total: typeof record.total === 'number' ? record.total : 0,
    current: typeof record.current === 'number' ? record.current : 0,
    currentPluginId: typeof record.currentPluginId === 'string' ? record.currentPluginId : null,
    message: typeof record.message === 'string' ? record.message : null,
    status,
    error: typeof record.error === 'string' ? record.error : null,
  };
}

function ensureScanRuns(value: unknown): VstScanRun[] {
  if (!Array.isArray(value)) return [];
  const out: VstScanRun[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const runId = readStringField(record, 'runId');
    const startedAtMs = typeof record.startedAtMs === 'number' ? record.startedAtMs : null;
    const status = readStringField(record, 'status');
    if (!runId || startedAtMs === null || !status) continue;
    out.push({
      runId,
      startedAtMs,
      finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : null,
      status,
      error: typeof record.error === 'string' ? record.error : null,
    });
  }
  return out;
}

function ensureScanEvents(value: unknown): VstScanEvent[] {
  if (!Array.isArray(value)) return [];
  const out: VstScanEvent[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const atMs = typeof record.atMs === 'number' ? record.atMs : null;
    const kind = readStringField(record, 'kind');
    const message = readStringField(record, 'message');
    if (atMs === null || !kind || !message) continue;
    out.push({
      atMs,
      kind,
      pluginId: typeof record.pluginId === 'string' ? record.pluginId : null,
      message,
    });
  }
  return out;
}

function ensureScanRunSummary(value: unknown): VstScanRunSummary | null {
  const record = asRecord(value);
  if (!record) return null;

  const runId = readStringField(record, 'runId');
  const startedAtMs = typeof record.startedAtMs === 'number' ? record.startedAtMs : null;
  const durationMs = typeof record.durationMs === 'number' ? record.durationMs : null;
  const status = readStringField(record, 'status');
  if (!runId || startedAtMs === null || durationMs === null || !status) return null;

  const rawCounts = asRecord(record.eventCounts);
  const eventCounts: Record<string, number> = {};
  if (rawCounts) {
    for (const [key, value] of Object.entries(rawCounts)) {
      if (typeof value === 'number' && isFinite(value)) {
        eventCounts[key] = value;
      }
    }
  }

  return {
    runId,
    mode: typeof record.mode === 'string' ? record.mode : null,
    startedAtMs,
    finishedAtMs: typeof record.finishedAtMs === 'number' ? record.finishedAtMs : null,
    durationMs,
    status,
    error: typeof record.error === 'string' ? record.error : null,
    eventsTotal: typeof record.eventsTotal === 'number' ? record.eventsTotal : 0,
    pluginsSeen: typeof record.pluginsSeen === 'number' ? record.pluginsSeen : 0,
    paramsScanned: typeof record.paramsScanned === 'number' ? record.paramsScanned : 0,
    eventCounts,
    lastDeadmanHint: typeof record.lastDeadmanHint === 'string' ? record.lastDeadmanHint : null,
  };
}

function ensureLibraryParams(value: unknown): LibraryParamDescriptor[] {
  if (!Array.isArray(value)) return [];
  const out: LibraryParamDescriptor[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = readStringField(record, 'key');
    const title = readStringField(record, 'title');
    const min = readNumberField(record, 'min');
    const max = readNumberField(record, 'max');
    const defaultValue = readNumberField(record, 'default');
    const step = readNumberField(record, 'step');
    const scannedAtMs = readNumberField(record, 'scannedAtMs');
    if (
      !key ||
      !title ||
      min === null ||
      max === null ||
      defaultValue === null ||
      step === null ||
      scannedAtMs === null
    ) {
      continue;
    }
    out.push({
      key,
      title,
      min,
      max,
      default: defaultValue,
      step,
      unit: typeof record.unit === 'string' ? record.unit : null,
      scannedAtMs,
    });
  }
  return out;
}

function ensureLibraryPlugins(value: unknown): LibraryPluginDescriptor[] {
  if (!Array.isArray(value)) return [];
  const out: LibraryPluginDescriptor[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = readStringField(record, 'id');
    const name = readStringField(record, 'name') ?? id;
    if (!id || !name) continue;

    out.push({
      id,
      name,
      vendor: typeof record.vendor === 'string' ? record.vendor : null,
      version: typeof record.version === 'string' ? record.version : null,
      path: typeof record.path === 'string' ? record.path : null,
      status: typeof record.status === 'string' ? record.status : null,
      lastSeenAtMs: typeof record.lastSeenAtMs === 'number' ? record.lastSeenAtMs : null,
      paramsScannedAtMs:
        typeof record.paramsScannedAtMs === 'number' ? record.paramsScannedAtMs : null,
      inputChannels: typeof record.inputChannels === 'number' ? record.inputChannels : null,
      outputChannels: typeof record.outputChannels === 'number' ? record.outputChannels : null,
      paramsCount: typeof record.paramsCount === 'number' ? record.paramsCount : null,
      paramsAttemptedAtMs:
        typeof record.paramsAttemptedAtMs === 'number' ? record.paramsAttemptedAtMs : null,
      paramsFailureCount:
        typeof record.paramsFailureCount === 'number' ? record.paramsFailureCount : null,
    });
  }
  return out;
}

function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, '');
}

function ensureScanPaths(value: unknown): VstScanPath[] {
  if (!Array.isArray(value)) return [];
  const out: VstScanPath[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const pathRaw = readStringField(record, 'path');
    if (!pathRaw) continue;
    const path = normalizePath(pathRaw);
    if (!path) continue;
    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true;
    out.push({ enabled, path });
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = p.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureScanSettings(value: unknown): VstScanSettingsV1 {
  if (Array.isArray(value)) {
    return { version: 1, includeDefaultPaths: true, scanPaths: ensureScanPaths(value) };
  }

  const record = asRecord(value);
  if (!record) {
    return { version: 1, includeDefaultPaths: true, scanPaths: [] };
  }

  const includeDefaultPaths =
    typeof record.includeDefaultPaths === 'boolean' ? record.includeDefaultPaths : true;
  const scanPaths = ensureScanPaths(record.scanPaths ?? record.paths ?? record.entries);
  return { version: 1, includeDefaultPaths, scanPaths };
}

function formatStatus(
  value: string | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!value) return '-';
  if (value === 'ok') return t('windows.vst-manager.status.ok');
  if (value === 'bad') return t('windows.vst-manager.status.bad');
  if (value === 'timeout') return t('windows.vst-manager.status.timeout');
  if (value === 'missing') return t('windows.vst-manager.status.missing');
  return value;
}

function formatScanRunStatus(
  value: string | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!value) return '-';
  if (value === 'running') return t('windows.vst-manager.scanRunStatus.running');
  if (value === 'ok') return t('windows.vst-manager.scanRunStatus.ok');
  if (value === 'error') return t('windows.vst-manager.scanRunStatus.error');
  if (value === 'cancelled') return t('windows.vst-manager.scanRunStatus.cancelled');
  return value;
}

function formatScanMode(
  value: string | null | undefined,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!value) return '-';
  if (value === 'fast') return t('windows.vst-manager.scanMode.fast');
  if (value === 'full') return t('windows.vst-manager.scanMode.full');
  if (value === 'params') return t('windows.vst-manager.scanMode.params');
  return value;
}

function formatDurationMs(
  durationMs: number,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (!isFinite(durationMs) || durationMs <= 0) return '-';
  const seconds = (durationMs / 1000).toFixed(1);
  return t('windows.vst-manager.diagnostics.durationValue', { seconds });
}

function formatScanStageLabel(
  stage: string | null | undefined,
  pluginName: string | null,
  pluginId: string | null,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  const normalizedStage = (stage ?? '').trim();
  switch (normalizedStage) {
    case 'starting':
      return t('windows.vst-manager.progress.stage.starting');
    case 'list-plugins':
      return t('windows.vst-manager.progress.stage.listPlugins');
    case 'persist':
      return pluginName
        ? t('windows.vst-manager.progress.stage.persistPlugin', { name: pluginName })
        : t('windows.vst-manager.progress.stage.persist');
    case 'describe':
      return pluginName
        ? t('windows.vst-manager.progress.stage.describePlugin', { name: pluginName })
        : pluginId
          ? t('windows.vst-manager.progress.stage.describeId', { id: pluginId })
          : t('windows.vst-manager.progress.stage.describe');
    case 'list-from-library':
      return t('windows.vst-manager.progress.stage.listFromLibrary');
    case 'finished':
      return t('windows.vst-manager.progress.stage.finished');
    case 'done':
      return t('windows.vst-manager.progress.stage.done');
    default:
      return pluginName || pluginId || normalizedStage || t('windows.vst-manager.progress.running');
  }
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function formatIo(plugin: LibraryPluginDescriptor): string {
  const input = typeof plugin.inputChannels === 'number' ? plugin.inputChannels : null;
  const output = typeof plugin.outputChannels === 'number' ? plugin.outputChannels : null;
  if (input === null || output === null) return '-';
  if (!isFinite(input) || !isFinite(output) || input <= 0 || output <= 0) return '-';
  return `${input}→${output}`;
}

function matchesQuery(candidate: string, query: string): boolean {
  return candidate.toLowerCase().includes(query);
}

export function VstManagerWindow() {
  const t = useT();
  const locale = useLocale();
  const isTauri = React.useMemo(() => isTauriRuntime(), []);
  const usedLegacyScanPathsRef = React.useRef(false);
  const paramsRequestIdRef = React.useRef(0);
  const [plugins, setPlugins] = React.useState<LibraryPluginDescriptor[]>([]);
  const [scanState, setScanState] = React.useState<VstScanState | null>(null);
  const [scanProgress, setScanProgress] = React.useState<VstScanProgressPayload | null>(null);
  const [scanRuns, setScanRuns] = React.useState<VstScanRun[]>([]);
  const [selectedScanRunId, setSelectedScanRunId] = React.useState<string>('');
  const [scanEvents, setScanEvents] = React.useState<VstScanEvent[]>([]);
  const [scanSummary, setScanSummary] = React.useState<VstScanRunSummary | null>(null);
  const [rackUsage, setRackUsage] = React.useState<Record<string, RackPluginUsage>>({});
  const [applyBusy, setApplyBusy] = React.useState(false);
  const [vstSettings, setVstSettings] = React.useState<VstSettings>(() => defaultVstSettings());
  const [vstSettingsBusy, setVstSettingsBusy] = React.useState(false);
  const [verifyOnScan, setVerifyOnScan] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [paramsOpen, setParamsOpen] = React.useState(false);
  const [paramsQuery, setParamsQuery] = React.useState('');
  const [paramsLoading, setParamsLoading] = React.useState(false);
  const [selectedParams, setSelectedParams] = React.useState<LibraryParamDescriptor[]>([]);
  const [paramsForPluginId, setParamsForPluginId] = React.useState<string | null>(null);
  const [paramsForScannedAtMs, setParamsForScannedAtMs] = React.useState<number | null>(null);
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(null);
  const [compatScope, setCompatScope] = React.useState<VstCompatScope>('plugin');
  const [compatInfo, setCompatInfo] = React.useState<VstCompatQueryResult | null>(null);
  const [compatDraft, setCompatDraft] = React.useState<VstCompatRule | null>(null);
  const [compatBusy, setCompatBusy] = React.useState(false);
  const [compatError, setCompatError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [scanPathExists, setScanPathExists] = React.useState<Record<string, boolean>>({});
  const [scanSettings, setScanSettings] = React.useState<VstScanSettingsV1>(() => {
    const raw = readJson(STORAGE_KEYS.VST_SCAN_SETTINGS, null as unknown);
    if (raw !== null) return ensureScanSettings(raw);
    usedLegacyScanPathsRef.current = true;
    const legacy = readJson(LEGACY_VST_SCAN_PATHS_STORAGE_KEY, [] as unknown[]);
    return { version: 1, includeDefaultPaths: true, scanPaths: ensureScanPaths(legacy) };
  });
  const paths = scanSettings.scanPaths;
  const includeDefaultPaths = scanSettings.includeDefaultPaths;
  const enabledScanPaths = React.useMemo(
    () => paths.filter((entry) => entry.enabled).map((entry) => entry.path),
    [paths]
  );

  React.useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    void (async () => {
      try {
        const { exists } = await import('@tauri-apps/api/fs');
        const result: Record<string, boolean> = {};
        for (const entry of paths) {
          const path = entry.path;
          if (!path || !path.trim()) continue;
          result[path] = await exists(path).catch(() => false);
        }
        if (!cancelled) setScanPathExists(result);
      } catch {
        if (!cancelled) setScanPathExists({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri, paths]);

  const scanRunning = Boolean(scanProgress?.status === 'running' || scanState?.running);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlugins = React.useMemo(() => {
    if (!normalizedQuery) return plugins;
    return plugins.filter((plugin) => {
      if (matchesQuery(plugin.name, normalizedQuery)) return true;
      if (plugin.vendor && matchesQuery(plugin.vendor, normalizedQuery)) return true;
      if (plugin.version && matchesQuery(plugin.version, normalizedQuery)) return true;
      if (plugin.path && matchesQuery(plugin.path, normalizedQuery)) return true;
      return matchesQuery(plugin.id, normalizedQuery);
    });
  }, [normalizedQuery, plugins]);

  const selectedPlugin = React.useMemo(() => {
    if (!selectedPluginId) return null;
    return plugins.find((plugin) => plugin.id === selectedPluginId) ?? null;
  }, [plugins, selectedPluginId]);

  const loadCompatibility = React.useCallback(
    async (pluginId: string) => {
      if (!isTauri) return;
      setCompatBusy(true);
      setCompatError(null);
      try {
        const resp = await invoke<unknown>('native_audio_vst_get_compatibility', { pluginId });
        setCompatInfo(ensureCompatQueryResult(resp));
      } catch (err) {
        setCompatInfo(null);
        setCompatError(err instanceof Error ? err.message : String(err));
      } finally {
        setCompatBusy(false);
      }
    },
    [isTauri]
  );

  React.useEffect(() => {
    if (!isTauri) return;
    const pluginId = selectedPluginId?.trim() ?? '';
    if (!pluginId) {
      setCompatInfo(null);
      setCompatDraft(null);
      setCompatError(null);
      return;
    }
    void loadCompatibility(pluginId);
  }, [isTauri, loadCompatibility, selectedPluginId]);

  React.useEffect(() => {
    if (!compatInfo) {
      setCompatDraft(null);
      return;
    }
    if (compatScope === 'vendor' && !compatInfo.vendor) {
      setCompatScope('plugin');
      return;
    }
    const next =
      compatScope === 'vendor'
        ? compatInfo.vendorOverride ?? compatInfo.effective
        : compatInfo.pluginOverride ?? compatInfo.effective;
    setCompatDraft(next);
  }, [compatInfo, compatScope]);

  const persistCompatRule = React.useCallback(
    async (next: VstCompatRule) => {
      if (!isTauri) return;
      const pluginId = selectedPluginId?.trim() ?? '';
      if (!pluginId) return;
      const key = compatScope === 'vendor' ? (compatInfo?.vendor ?? '') : pluginId;
      if (!key.trim()) return;

      setCompatBusy(true);
      setCompatError(null);
      try {
        await invoke('native_audio_vst_set_compat_rule', { scope: compatScope, key, rule: next });
        await loadCompatibility(pluginId);
      } catch (err) {
        setCompatError(err instanceof Error ? err.message : String(err));
      } finally {
        setCompatBusy(false);
      }
    },
    [compatInfo?.vendor, compatScope, isTauri, loadCompatibility, selectedPluginId]
  );

  const updateCompatField = React.useCallback(
    (patch: Partial<VstCompatRule>) => {
      const base = compatDraft ?? compatInfo?.effective ?? defaultCompatRule();
      const next = { ...base, ...patch };
      setCompatDraft(next);
      void persistCompatRule(next);
    },
    [compatDraft, compatInfo?.effective, persistCompatRule]
  );

  const clearCompatOverride = React.useCallback(async () => {
    if (!isTauri) return;
    const pluginId = selectedPluginId?.trim() ?? '';
    if (!pluginId) return;
    const key = compatScope === 'vendor' ? (compatInfo?.vendor ?? '') : pluginId;
    if (!key.trim()) return;

    setCompatBusy(true);
    setCompatError(null);
    try {
      await invoke('native_audio_vst_clear_compat_rule', { scope: compatScope, key });
      await loadCompatibility(pluginId);
    } catch (err) {
      setCompatError(err instanceof Error ? err.message : String(err));
    } finally {
      setCompatBusy(false);
    }
  }, [compatInfo?.vendor, compatScope, isTauri, loadCompatibility, selectedPluginId]);

  const normalizedParamsQuery = paramsQuery.trim().toLowerCase();
  const filteredParams = React.useMemo(() => {
    if (!normalizedParamsQuery) return selectedParams;
    return selectedParams.filter(
      (param) =>
        matchesQuery(param.title, normalizedParamsQuery) ||
        matchesQuery(param.key, normalizedParamsQuery)
    );
  }, [normalizedParamsQuery, selectedParams]);

  React.useEffect(() => {
    if (!usedLegacyScanPathsRef.current) return;
    usedLegacyScanPathsRef.current = false;
    writeJson(STORAGE_KEYS.VST_SCAN_SETTINGS, scanSettings, { mode: 'sync' });
  }, [scanSettings]);

  const persistScanSettings = React.useCallback((next: VstScanSettingsV1) => {
    setScanSettings(next);
    writeJson(STORAGE_KEYS.VST_SCAN_SETTINGS, next, { mode: 'sync' });
  }, []);

  const addPath = React.useCallback(async () => {
    if (!isTauri) return;
    setError(null);
    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        directory: true,
      });
      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (typeof path !== 'string') return;

      const normalized = normalizePath(path);
      if (!normalized) return;

      persistScanSettings({
        ...scanSettings,
        scanPaths: ensureScanPaths([
          ...paths,
          {
            enabled: true,
            path: normalized,
          },
        ]),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, paths, persistScanSettings, scanSettings]);

  const togglePath = React.useCallback(
    (path: string) => {
      const normalized = normalizePath(path);
      const next = ensureScanPaths(
        paths.map((entry) =>
          normalizePath(entry.path).toLowerCase() === normalized.toLowerCase()
            ? { ...entry, enabled: !entry.enabled }
            : entry
        )
      );
      persistScanSettings({ ...scanSettings, scanPaths: next });
    },
    [paths, persistScanSettings, scanSettings]
  );

  const removePath = React.useCallback(
    (path: string) => {
      const normalized = normalizePath(path).toLowerCase();
      persistScanSettings({
        ...scanSettings,
        scanPaths: paths.filter((entry) => normalizePath(entry.path).toLowerCase() !== normalized),
      });
    },
    [paths, persistScanSettings, scanSettings]
  );

  const refreshRackUsage = React.useCallback(async () => {
    if (!isTauri) return;

    const storedGraph = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH);
    if (storedGraph !== null) {
      setRackUsage(buildRackUsage(storedGraph));
      return;
    }

    try {
      const graphResp = await invoke<unknown>('native_audio_get_dsp_graph').catch(() => null);
      setRackUsage(buildRackUsage(graphResp));
    } catch {
      setRackUsage({});
    }
  }, [isTauri]);

  const refresh = React.useCallback(async () => {
    if (!isTauri) return;
    setError(null);
    try {
      const [libraryResp, scanResp, scanRunsResp, settingsResp] = await Promise.all([
        invoke<unknown>('native_audio_vst_library_list_plugins').catch(() => []),
        invoke<unknown>('native_audio_vst_scan_state').catch(() => null),
        invoke<unknown>('native_audio_vst_library_list_scan_runs', { limit: 20 }).catch(() => []),
        invoke<unknown>('native_audio_vst_get_settings').catch(() => null),
      ]);
      const libraryPlugins = ensureLibraryPlugins(libraryResp);
      const nextScanState = ensureVstScanState(scanResp);
      const nextScanRuns = ensureScanRuns(scanRunsResp);
      setVstSettings(ensureVstSettings(settingsResp));
      setPlugins(libraryPlugins);
      setScanState(nextScanState);
      setScanRuns(nextScanRuns);
      setSelectedScanRunId((current) => {
        const currentTrimmed = current.trim();
        const activeRunId = (nextScanState?.runId ?? '').trim();
        const hasActive = activeRunId && nextScanRuns.some((run) => run.runId === activeRunId);
        if (nextScanState?.running && hasActive) return activeRunId;
        if (currentTrimmed && nextScanRuns.some((run) => run.runId === currentTrimmed))
          return currentTrimmed;
        return nextScanRuns[0]?.runId ?? '';
      });
      if (libraryPlugins.length && !selectedPluginId) {
        setSelectedPluginId(libraryPlugins[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, selectedPluginId]);

  const applyVstSettings = React.useCallback(
    async (next: VstSettings) => {
      if (!isTauri) return;
      setVstSettingsBusy(true);
      setError(null);
      setVstSettings(next);
      try {
        await invoke('native_audio_vst_set_settings', { settings: next });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        const refreshed = await invoke<unknown>('native_audio_vst_get_settings').catch(() => null);
        setVstSettings(ensureVstSettings(refreshed));
      } finally {
        setVstSettingsBusy(false);
      }
    },
    [isTauri]
  );

  const refreshScanEvents = React.useCallback(
    async (runId: string) => {
      if (!isTauri) return;
      const normalized = runId.trim();
      if (!normalized) {
        setScanEvents([]);
        return;
      }
      try {
        const resp = await invoke<unknown>('native_audio_vst_library_list_scan_events', {
          runId: normalized,
          limit: 80,
        }).catch(() => []);
        const events = ensureScanEvents(resp).sort((a, b) => a.atMs - b.atMs);
        setScanEvents(events);
      } catch {
        setScanEvents([]);
      }
    },
    [isTauri]
  );

  const refreshScanSummary = React.useCallback(
    async (runId: string) => {
      if (!isTauri) return;
      const normalized = runId.trim();
      if (!normalized) {
        setScanSummary(null);
        return;
      }
      try {
        const resp = await invoke<unknown>('native_audio_vst_library_get_scan_run_summary', {
          runId: normalized,
        }).catch(() => null);
        setScanSummary(ensureScanRunSummary(resp));
      } catch {
        setScanSummary(null);
      }
    },
    [isTauri]
  );

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    void refreshScanEvents(selectedScanRunId);
  }, [refreshScanEvents, selectedScanRunId]);

  React.useEffect(() => {
    void refreshScanSummary(selectedScanRunId);
  }, [refreshScanSummary, selectedScanRunId]);

  React.useEffect(() => {
    void refreshRackUsage();
  }, [refreshRackUsage]);

  React.useEffect(() => {
    if (!isTauri) return;
    let cleanup: null | (() => void) = null;
    void setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH],
      [TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED],
      () => {
        void refreshRackUsage();
      }
    ).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [isTauri, refreshRackUsage]);

  const startScan = React.useCallback(async () => {
    if (!isTauri) return;
    if (scanRunning) return;
    setError(null);
    try {
      await invoke<string>('native_audio_vst_scan_start', {
        request: {
          mode: verifyOnScan ? 'full' : 'fast',
          pluginIds: [],
          scanPaths: enabledScanPaths,
          includeDefaultPaths,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabledScanPaths, includeDefaultPaths, isTauri, scanRunning, verifyOnScan]);

  const cancelScan = React.useCallback(async () => {
    if (!isTauri) return;
    try {
      await invoke('native_audio_vst_scan_cancel');
    } catch {
      // best-effort
    }
  }, [isTauri]);

  const scanParams = React.useCallback(async () => {
    if (!isTauri) return;
    if (scanRunning) return;
    if (!selectedPluginId) return;
    setError(null);
    try {
      await invoke<string>('native_audio_vst_scan_start', {
        request: {
          mode: 'params',
          pluginIds: [selectedPluginId],
          scanPaths: enabledScanPaths,
          includeDefaultPaths,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabledScanPaths, includeDefaultPaths, isTauri, scanRunning, selectedPluginId]);

  const resetSelectedPluginScanStatus = React.useCallback(async () => {
    if (!isTauri) return;
    if (scanRunning) return;
    if (!selectedPluginId) return;
    const pluginId = selectedPluginId.trim();
    if (!pluginId) return;
    setError(null);
    try {
      await invoke('native_audio_vst_library_reset_plugin_scan_status', { pluginId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, refresh, scanRunning, selectedPluginId]);

  const forgetSelectedPluginParamsCache = React.useCallback(async () => {
    if (!isTauri) return;
    if (scanRunning) return;
    if (!selectedPluginId) return;
    const pluginId = selectedPluginId.trim();
    if (!pluginId) return;
    setError(null);
    try {
      await invoke('native_audio_vst_library_invalidate_plugin_params_cache', { pluginId });
      setSelectedParams([]);
      setParamsForPluginId(null);
      setParamsForScannedAtMs(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, refresh, scanRunning, selectedPluginId]);

  const loadSelectedPluginParams = React.useCallback(
    async (pluginId: string, scannedAtMs: number | null) => {
      if (!isTauri) return;
      const normalized = pluginId.trim();
      if (!normalized) return;
      const requestId = paramsRequestIdRef.current + 1;
      paramsRequestIdRef.current = requestId;

      setParamsLoading(true);
      try {
        const resp = await invoke<unknown>('native_audio_vst_library_get_plugin_params', {
          pluginId: normalized,
        }).catch(() => []);
        const list = ensureLibraryParams(resp);
        if (paramsRequestIdRef.current !== requestId) return;
        setSelectedParams(list);
        setParamsForPluginId(normalized);
        setParamsForScannedAtMs(scannedAtMs);
      } catch (err) {
        if (paramsRequestIdRef.current !== requestId) return;
        setSelectedParams([]);
        setParamsForPluginId(normalized);
        setParamsForScannedAtMs(scannedAtMs);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (paramsRequestIdRef.current === requestId) {
          setParamsLoading(false);
        }
      }
    },
    [isTauri]
  );

  React.useEffect(() => {
    setSelectedParams([]);
    setParamsForPluginId(null);
    setParamsForScannedAtMs(null);
    setParamsQuery('');
    paramsRequestIdRef.current += 1;
  }, [selectedPluginId]);

  React.useEffect(() => {
    if (!paramsOpen) return;
    if (!selectedPluginId) return;
    const scannedAtMs = selectedPlugin?.paramsScannedAtMs ?? null;
    if (!scannedAtMs) return;
    if (
      paramsForPluginId === selectedPluginId &&
      paramsForScannedAtMs === scannedAtMs &&
      !paramsLoading
    ) {
      return;
    }
    void loadSelectedPluginParams(selectedPluginId, scannedAtMs);
  }, [
    loadSelectedPluginParams,
    paramsForPluginId,
    paramsForScannedAtMs,
    paramsLoading,
    paramsOpen,
    selectedPlugin?.paramsScannedAtMs,
    selectedPluginId,
  ]);

  const applyDspGraph = React.useCallback(
    async (next: DspGraphConfig) => {
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH,
        next,
        TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED
      );
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
        computeTotalGainDb(next.nodes),
        TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
      );
      await invoke('native_audio_set_dsp_graph', { graph: next });
      setRackUsage(buildRackUsage(next));
    },
    [setRackUsage]
  );

  const mutateDspGraph = React.useCallback(
    async (updater: (graph: DspGraphConfig) => DspGraphConfig) => {
      if (!isTauri) return;
      if (scanRunning || applyBusy) return;

      setApplyBusy(true);
      setError(null);
      try {
        const storedGraph = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH);
        const graphResp =
          storedGraph !== null
            ? storedGraph
            : await invoke<unknown>('native_audio_get_dsp_graph').catch(() => ({ nodes: [] }));
        const graph = ensureDspGraphConfig(graphResp);
        const next = updater(graph);
        await applyDspGraph(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setApplyBusy(false);
      }
    },
    [applyBusy, applyDspGraph, isTauri, scanRunning]
  );

  const focusMainWindow = React.useCallback(async () => {
    if (!isTauri) return;
    try {
      const { getAll } = await import('@tauri-apps/api/window');
      const main = getAll().find((win) => win.label === 'main');
      if (!main) return;
      await main.show().catch(() => {});
      await main.unminimize().catch(() => {});
      await main.setFocus().catch(() => {});
    } catch {
      // best-effort
    }
  }, [isTauri]);

  const openDspRack = React.useCallback(async () => {
    if (!isTauri) return;
    const requestId = uniqueNodeId('nav');
    await broadcastDataUpdate(
      STORAGE_KEYS.NAVIGATION_REQUEST,
      { requestId, page: 'dsp-rack', atMs: Date.now() },
      TAURI_EVENTS.NAVIGATION_REQUESTED
    );
    await focusMainWindow();
  }, [focusMainWindow, isTauri]);

  const locateDspRackNode = React.useCallback(
    async (nodeId: string) => {
      if (!isTauri) return;
      const normalized = nodeId.trim();
      if (!normalized) return;

      const requestId = uniqueNodeId('locate');
      await broadcastDataUpdate(
        STORAGE_KEYS.DSP_RACK_LOCATE_NODE,
        { requestId, nodeId: normalized, atMs: Date.now() },
        TAURI_EVENTS.DSP_RACK_LOCATE_NODE
      );
      await openDspRack();
    },
    [isTauri, openDspRack]
  );

  const removeRackNodes = React.useCallback(
    async (nodeIds: string[]) => {
      const ids = nodeIds.map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) return;
      await mutateDspGraph((graph) => ({
        nodes: graph.nodes.filter((node) => !ids.includes(node.id)),
      }));
    },
    [mutateDspGraph]
  );

  const removeSelectedPluginFromRack = React.useCallback(async () => {
    if (!selectedPluginId) return;
    const pluginId = selectedPluginId.trim();
    if (!pluginId) return;
    await mutateDspGraph((graph) => ({
      nodes: graph.nodes.filter(
        (node) => !(node.type === 'vst' && readStringField(node, 'pluginId') === pluginId)
      ),
    }));
  }, [mutateDspGraph, selectedPluginId]);

  const addToDspRack = React.useCallback(async () => {
    if (!isTauri) return;
    if (scanRunning || applyBusy) return;
    if (!selectedPluginId) return;

    const pluginId = selectedPluginId.trim();
    if (!pluginId) return;

    setApplyBusy(true);
    setError(null);
    try {
      const graphResp = await invoke<unknown>('native_audio_get_dsp_graph').catch(() => ({
        nodes: [],
      }));
      const graph = ensureDspGraphConfig(graphResp);

      const node: VstNode = {
        id: uniqueNodeId('vst'),
        enabled: true,
        type: 'vst',
        pluginId,
        params: [],
      };

      const next: DspGraphConfig = { nodes: [...graph.nodes, node] };
      await applyDspGraph(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplyBusy(false);
    }
  }, [applyDspGraph, applyBusy, isTauri, scanRunning, selectedPluginId]);

  React.useEffect(() => {
    if (!isTauri) return;
    let unlisten: null | (() => void | Promise<void>) = null;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('vst-scan-progress', (event) => {
        const payload = ensureVstScanProgressPayload(event.payload);
        if (!payload) return;
        setScanProgress(payload);
        setSelectedScanRunId(payload.runId);
        if (payload.status !== 'running') {
          void refresh();
          void refreshScanEvents(payload.runId);
          void refreshScanSummary(payload.runId);
        }
      });
    })();
    return () => {
      if (unlisten) void unlisten();
    };
  }, [isTauri, refresh, refreshScanEvents, refreshScanSummary]);

  if (!isTauri) {
    return (
      <div className="vst-manager">
        <div className="vst-manager-empty">{t('windows.vst-manager.requiresTauri')}</div>
      </div>
    );
  }

  const progressTotal = scanProgress?.total ?? scanState?.total ?? 0;
  const progressCurrent = scanProgress?.current ?? scanState?.current ?? 0;
  const progressStage = scanProgress?.stage ?? scanState?.stage ?? null;
  const progressPluginId = scanProgress?.currentPluginId ?? scanState?.currentPluginId ?? null;
  const progressPluginName =
    progressStage === 'persist' && scanProgress?.message
      ? scanProgress.message
      : progressPluginId
        ? plugins.find((plugin) => plugin.id === progressPluginId)?.name ?? null
        : null;
  const progressText = scanRunning
    ? formatScanStageLabel(progressStage, progressPluginName, progressPluginId, t)
    : t('windows.vst-manager.progress.idle');

  const selectedUsage = selectedPlugin ? rackUsage[selectedPlugin.id] : null;
  const selectedScanRun = selectedScanRunId
    ? (scanRuns.find((run) => run.runId === selectedScanRunId) ?? null)
    : null;

  return (
    <div className="vst-manager">
      <div className="vst-manager-topbar">
        <div className="vst-manager-title">
          <div className="vst-manager-title-main">{t('windows.vst-manager.title')}</div>
          <div className="vst-manager-title-sub">
            {scanRunning
              ? progressTotal > 0
                ? t('windows.vst-manager.topbar.scanningWithTotal', {
                    progress: progressText,
                    current: progressCurrent,
                    total: progressTotal,
                  })
                : t('windows.vst-manager.topbar.scanning', { progress: progressText })
              : t('windows.vst-manager.topbar.pluginsCount', { count: plugins.length })}
          </div>
        </div>

        <div className="vst-manager-toolbar">
          <input
            className="vst-manager-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('windows.vst-manager.search.placeholder')}
            aria-label={t('windows.vst-manager.search.ariaLabel')}
          />
          <button type="button" onClick={() => void openDspRack()}>
            {t('windows.vst-manager.action.openDspRack')}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={scanRunning}>
            {t('common.action.refresh')}
          </button>
          <button type="button" onClick={() => void startScan()} disabled={scanRunning}>
            {verifyOnScan
              ? t('windows.vst-manager.action.scanVerify')
              : t('windows.vst-manager.action.scan')}
          </button>
          <button type="button" onClick={() => void cancelScan()} disabled={!scanRunning}>
            {t('common.action.cancel')}
          </button>
        </div>
      </div>

      {error && <div className="vst-manager-error">{error}</div>}

      <div className="vst-manager-content">
        <div className="vst-manager-sidebar">
          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">{t('windows.vst-manager.options.title')}</div>
            <label className="vst-manager-checkbox">
              <input
                type="checkbox"
                checked={verifyOnScan}
                onChange={(e) => setVerifyOnScan(e.target.checked)}
                disabled={scanRunning}
              />
              {t('windows.vst-manager.options.verifyOnScan')}
            </label>
            <label className="vst-manager-checkbox">
              <input
                type="checkbox"
                checked={includeDefaultPaths}
                onChange={(e) =>
                  persistScanSettings({ ...scanSettings, includeDefaultPaths: e.target.checked })
                }
                disabled={scanRunning}
              />
              {t('windows.vst-manager.options.includeDefaultPaths')}
            </label>
            <div className="vst-manager-panel-note">{t('windows.vst-manager.options.note')}</div>
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">{t('windows.vst-manager.vstSettings.title')}</div>
            <div className="vst-manager-kv">
              <div className="vst-manager-k">{t('windows.vst-manager.vstSettings.sidechainMode.label')}</div>
              <div className="vst-manager-v">
                <select
                  className="vst-manager-select"
                  value={vstSettings.sidechainMode}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (!isVstSidechainMode(raw)) return;
                    void applyVstSettings({ ...vstSettings, sidechainMode: raw });
                  }}
                  disabled={scanRunning || vstSettingsBusy}
                >
                  <option value="disabled">{t('windows.vst-manager.vstSettings.sidechainMode.disabled')}</option>
                  <option value="silence">{t('windows.vst-manager.vstSettings.sidechainMode.silence')}</option>
                  <option value="self">{t('windows.vst-manager.vstSettings.sidechainMode.self')}</option>
                </select>
              </div>
            </div>
            <div className="vst-manager-panel-note">{t('windows.vst-manager.vstSettings.sidechainNote')}</div>
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">{t('windows.vst-manager.paths.title')}</div>
            <div className="vst-manager-paths">
              {paths.length === 0 ? (
                <div className="vst-manager-panel-note">{t('windows.vst-manager.paths.empty')}</div>
              ) : (
                paths.map((entry) => {
                  const exists = scanPathExists[entry.path];
                  return (
                    <div key={entry.path} className="vst-manager-path-row">
                      <label className="vst-manager-checkbox">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={() => togglePath(entry.path)}
                          disabled={scanRunning}
                        />
                        <span className="vst-manager-path-text" title={entry.path}>
                          {entry.path}
                        </span>
                        {exists === undefined ? null : (
                          <span
                            className={`vst-manager-path-status${
                              exists ? '' : ' vst-manager-path-status--missing'
                            }`}
                          >
                            {exists
                              ? t('windows.vst-manager.paths.status.ok')
                              : t('windows.vst-manager.paths.status.missing')}
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        className="vst-manager-path-remove"
                        onClick={() => removePath(entry.path)}
                        disabled={scanRunning}
                        aria-label={t('windows.vst-manager.paths.removeAriaLabel', {
                          path: entry.path,
                        })}
                      >
                        {t('common.action.remove')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="vst-manager-panel-actions">
              <button type="button" onClick={() => void addPath()} disabled={scanRunning}>
                {t('windows.vst-manager.paths.addButton')}
              </button>
            </div>
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">
              {t('windows.vst-manager.diagnostics.title')}
            </div>
            <div className="vst-manager-panel-note">
              {t('windows.vst-manager.diagnostics.note')}
            </div>

            {scanRuns.length === 0 ? (
              <div className="vst-manager-panel-note">
                {t('windows.vst-manager.diagnostics.noScanRuns')}
              </div>
            ) : (
              <>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">
                    {t('windows.vst-manager.diagnostics.recentScan')}
                  </div>
                  <div className="vst-manager-v">
                    <select
                      className="vst-manager-select"
                      value={selectedScanRunId}
                      onChange={(e) => setSelectedScanRunId(e.target.value)}
                      disabled={scanRunning}
                    >
                      {scanRuns.map((run) => (
                        <option key={run.runId} value={run.runId}>
                          {t('windows.vst-manager.diagnostics.runOption', {
                            time: new Date(run.startedAtMs).toLocaleString(locale),
                            status: formatScanRunStatus(run.status, t),
                          })}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedScanRunId && (
                  <>
                    {selectedScanRun ? (
                      <div className="vst-manager-kv">
                        <div className="vst-manager-k">
                          {t('windows.vst-manager.diagnostics.status')}
                        </div>
                        <div className="vst-manager-v">
                          {formatScanRunStatus(selectedScanRun.status, t)}
                        </div>
                      </div>
                    ) : null}
                    <div className="vst-manager-kv">
                      <div className="vst-manager-k">
                        {t('windows.vst-manager.diagnostics.runId')}
                      </div>
                      <div className="vst-manager-v" title={selectedScanRunId}>
                        {selectedScanRunId}
                      </div>
                    </div>
                    <div className="vst-manager-kv">
                      <div className="vst-manager-k">
                        {t('windows.vst-manager.diagnostics.events')}
                      </div>
                      <div className="vst-manager-v">
                        {scanSummary?.eventsTotal ?? scanEvents.length}
                      </div>
                    </div>
                    {scanSummary ? (
                      <>
                        <div className="vst-manager-kv">
                          <div className="vst-manager-k">
                            {t('windows.vst-manager.diagnostics.mode')}
                          </div>
                          <div className="vst-manager-v">
                            {formatScanMode(scanSummary.mode, t)}
                          </div>
                        </div>
                        <div className="vst-manager-kv">
                          <div className="vst-manager-k">
                            {t('windows.vst-manager.diagnostics.duration')}
                          </div>
                          <div className="vst-manager-v">
                            {formatDurationMs(scanSummary.durationMs, t)}
                          </div>
                        </div>
                        <div className="vst-manager-kv">
                          <div className="vst-manager-k">
                            {t('windows.vst-manager.diagnostics.pluginsSeen')}
                          </div>
                          <div className="vst-manager-v">{scanSummary.pluginsSeen}</div>
                        </div>
                        <div className="vst-manager-kv">
                          <div className="vst-manager-k">
                            {t('windows.vst-manager.diagnostics.paramsScanned')}
                          </div>
                          <div className="vst-manager-v">{scanSummary.paramsScanned}</div>
                        </div>
                        {scanSummary.lastDeadmanHint ? (
                          <div className="vst-manager-panel-note vst-manager-panel-note--error">
                            {t('windows.vst-manager.diagnostics.lastStall', {
                              path: scanSummary.lastDeadmanHint,
                            })}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {selectedScanRun?.error ? (
                      <div className="vst-manager-panel-note vst-manager-panel-note--error">
                        {t('windows.vst-manager.diagnostics.scanError', {
                          message: selectedScanRun.error,
                        })}
                      </div>
                    ) : null}
                    {scanState?.lastError ? (
                      <div className="vst-manager-panel-note vst-manager-panel-note--error">
                        {t('windows.vst-manager.diagnostics.lastError', {
                          message: scanState.lastError,
                        })}
                      </div>
                    ) : null}

                    <div
                      className="vst-manager-log"
                      role="log"
                      aria-label={t('windows.vst-manager.diagnostics.logAriaLabel')}
                    >
                      {scanEvents.length === 0 ? (
                        <div className="vst-manager-panel-note">
                          {t('windows.vst-manager.diagnostics.noLogs')}
                        </div>
                      ) : (
                        scanEvents.map((entry, idx) => (
                          <div
                            key={`${entry.atMs}-${entry.kind}-${entry.message}-${idx}`}
                            className="vst-manager-log-line"
                          >
                            <span className="vst-manager-log-time">
                              {new Date(entry.atMs).toLocaleTimeString(locale)}
                            </span>
                            <span className="vst-manager-log-kind">{entry.kind}</span>
                            <span className="vst-manager-log-message">{entry.message}</span>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="vst-manager-panel-actions">
                      <button
                        type="button"
                        onClick={() => void refreshScanEvents(selectedScanRunId)}
                        disabled={!selectedScanRunId}
                      >
                        {t('windows.vst-manager.diagnostics.refreshLogs')}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">{t('windows.vst-manager.selected.title')}</div>
            {selectedPlugin ? (
              <>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.name')}</div>
                  <div className="vst-manager-v">{selectedPlugin.name}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.vendor')}</div>
                  <div className="vst-manager-v">{selectedPlugin.vendor ?? '-'}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.status')}</div>
                  <div className="vst-manager-v">{formatStatus(selectedPlugin.status, t)}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.rackUsage')}</div>
                  <div className="vst-manager-v">
                    {selectedUsage
                      ? t('windows.vst-manager.selected.rackUsageEnabled', {
                          enabled: selectedUsage.enabled,
                          total: selectedUsage.total,
                        })
                      : t('windows.vst-manager.selected.rackUsageNone')}
                  </div>
                </div>
                {selectedUsage && selectedUsage.nodeIds.length > 0 && (
                  <div className="vst-manager-panel-note">
                    {t('windows.vst-manager.selected.nodeIds', {
                      nodeIds: selectedUsage.nodeIds.slice(0, 8).join(', '),
                      more: selectedUsage.nodeIds.length > 8 ? '…' : '',
                    })}
                  </div>
                )}
                {selectedUsage && selectedUsage.nodeIds.length > 0 && (
                  <div className="vst-manager-node-list">
                    <div className="vst-manager-node-list-title">
                      {t('windows.vst-manager.selected.nodeListTitle')}
                    </div>
                    {selectedUsage.nodeIds.slice(0, 6).map((nodeId) => (
                      <div key={nodeId} className="vst-manager-node-row">
                        <div className="vst-manager-node-id" title={nodeId}>
                          {nodeId}
                        </div>
                        <button type="button" onClick={() => void locateDspRackNode(nodeId)}>
                          {t('windows.vst-manager.selected.action.locate')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeRackNodes([nodeId])}
                          disabled={scanRunning || applyBusy}
                        >
                          {t('common.action.remove')}
                        </button>
                      </div>
                    ))}
                    {selectedUsage.nodeIds.length > 6 && (
                      <div className="vst-manager-panel-note">
                        {t('windows.vst-manager.selected.nodeListLimited', {
                          count: selectedUsage.nodeIds.length,
                        })}
                      </div>
                    )}
                  </div>
                )}
                {selectedUsage && selectedUsage.nodeIds.length > 0 && (
                  <div className="vst-manager-panel-actions">
                    <button
                      type="button"
                      onClick={() => void removeSelectedPluginFromRack()}
                      disabled={scanRunning || applyBusy}
                    >
                      {t('windows.vst-manager.selected.action.removeAllRefs')}
                    </button>
                  </div>
                )}
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.format')}</div>
                  <div className="vst-manager-v">VST3</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.bits')}</div>
                  <div className="vst-manager-v">64</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.io')}</div>
                  <div className="vst-manager-v">{formatIo(selectedPlugin)}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.file')}</div>
                  <div className="vst-manager-v">
                    {selectedPlugin.path ? basename(selectedPlugin.path) : '-'}
                  </div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">{t('windows.vst-manager.selected.paramsCache')}</div>
                  <div className="vst-manager-v">
                    {selectedPlugin.paramsScannedAtMs
                      ? t('windows.vst-manager.selected.paramsCache.ready', {
                          count: selectedPlugin.paramsCount ?? '-',
                        })
                      : selectedPlugin.status === 'timeout' || selectedPlugin.status === 'bad'
                        ? t('windows.vst-manager.selected.paramsCache.failed', {
                            failures: selectedPlugin.paramsFailureCount ?? 0,
                          })
                        : t('windows.vst-manager.selected.paramsCache.missing')}
                  </div>
                </div>
                <div className="vst-manager-panel-actions">
                  {selectedPlugin.status === 'timeout' || selectedPlugin.status === 'bad' ? (
                    <button
                      type="button"
                      onClick={() => void resetSelectedPluginScanStatus()}
                      disabled={scanRunning || applyBusy}
                    >
                      {t('windows.vst-manager.selected.action.resetScanStatus')}
                    </button>
                  ) : null}
                  {selectedPlugin.paramsScannedAtMs ? (
                    <button
                      type="button"
                      onClick={() => void forgetSelectedPluginParamsCache()}
                      disabled={scanRunning || applyBusy}
                    >
                      {t('windows.vst-manager.selected.action.forgetParamsCache')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setParamsOpen((open) => !open)}
                    disabled={scanRunning || applyBusy}
                  >
                    {paramsOpen
                      ? t('windows.vst-manager.selected.action.hideParams')
                      : t('windows.vst-manager.selected.action.showParams')}
                  </button>
                  <button type="button" onClick={() => void scanParams()} disabled={scanRunning}>
                    {t('windows.vst-manager.selected.action.scanParams')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void addToDspRack()}
                    disabled={scanRunning || applyBusy}
                  >
                    {t('windows.vst-manager.selected.action.addToRack')}
                  </button>
                </div>
                <div className="vst-manager-compat">
                  <div className="vst-manager-node-list-title">
                    {t('windows.vst-manager.selected.compat.title')}
                  </div>
                  <div className="vst-manager-kv">
                    <div className="vst-manager-k">
                      {t('windows.vst-manager.selected.compat.scope.label')}
                    </div>
                    <div className="vst-manager-v">
                      <select
                        className="vst-manager-select"
                        value={compatScope}
                        onChange={(e) => setCompatScope(e.target.value as VstCompatScope)}
                        disabled={compatBusy || scanRunning || applyBusy}
                      >
                        <option value="plugin">
                          {t('windows.vst-manager.selected.compat.scope.plugin')}
                        </option>
                        {compatInfo?.vendor ? (
                          <option value="vendor">
                            {t('windows.vst-manager.selected.compat.scope.vendor', {
                              vendor: compatInfo.vendor,
                            })}
                          </option>
                        ) : null}
                      </select>
                    </div>
                  </div>
                  <div className="vst-manager-kv">
                    <div className="vst-manager-k">
                      {t('windows.vst-manager.selected.compat.editorSafeMode')}
                    </div>
                    <div className="vst-manager-v">
                      <label className="vst-manager-compat-toggle">
                        <input
                          type="checkbox"
                          checked={(compatDraft ?? compatInfo?.effective ?? defaultCompatRule()).editorSafeMode}
                          onChange={(e) => updateCompatField({ editorSafeMode: e.target.checked })}
                          disabled={compatBusy || scanRunning || applyBusy}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="vst-manager-kv">
                    <div className="vst-manager-k">
                      {t('windows.vst-manager.selected.compat.loadOnUiThread')}
                    </div>
                    <div className="vst-manager-v">
                      <label className="vst-manager-compat-toggle">
                        <input
                          type="checkbox"
                          checked={(compatDraft ?? compatInfo?.effective ?? defaultCompatRule()).loadOnUiThread}
                          onChange={(e) => updateCompatField({ loadOnUiThread: e.target.checked })}
                          disabled={compatBusy || scanRunning || applyBusy}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="vst-manager-kv">
                    <div className="vst-manager-k">
                      {t('windows.vst-manager.selected.compat.monoInput')}
                    </div>
                    <div className="vst-manager-v">
                      <select
                        className="vst-manager-select"
                        value={(compatDraft ?? compatInfo?.effective ?? defaultCompatRule()).monoInput}
                        onChange={(e) => updateCompatField({ monoInput: e.target.value as VstMonoInputPolicy })}
                        disabled={compatBusy || scanRunning || applyBusy}
                      >
                        <option value="sum-average">
                          {t('windows.vst-manager.selected.compat.monoInput.sum')}
                        </option>
                        <option value="left-only">
                          {t('windows.vst-manager.selected.compat.monoInput.left')}
                        </option>
                      </select>
                    </div>
                  </div>
                  <div className="vst-manager-panel-note">
                    {t('windows.vst-manager.selected.compat.note')}
                  </div>
                  <div className="vst-manager-panel-actions">
                    <button
                      type="button"
                      onClick={() => void clearCompatOverride()}
                      disabled={
                        compatBusy ||
                        scanRunning ||
                        applyBusy ||
                        (compatScope === 'vendor'
                          ? !compatInfo?.vendorOverride
                          : !compatInfo?.pluginOverride)
                      }
                    >
                      {t('windows.vst-manager.selected.compat.action.reset')}
                    </button>
                  </div>
                  {compatError ? (
                    <div className="vst-manager-panel-note vst-manager-panel-note--error">
                      {compatError}
                    </div>
                  ) : null}
                </div>
                {paramsOpen ? (
                  <div className="vst-manager-params">
                    <div className="vst-manager-params-title">
                      {t('windows.vst-manager.selected.params.title', {
                        count: selectedPlugin.paramsCount ?? selectedParams.length,
                      })}
                    </div>
                    {selectedPlugin.paramsScannedAtMs ? (
                      <>
                        <input
                          className="vst-manager-params-search"
                          value={paramsQuery}
                          onChange={(e) => setParamsQuery(e.target.value)}
                          placeholder={t('windows.vst-manager.selected.params.search.placeholder')}
                          aria-label={t('windows.vst-manager.selected.params.search.ariaLabel')}
                        />
                        {paramsLoading ? (
                          <div className="vst-manager-panel-note">
                            {t('windows.vst-manager.selected.params.loading')}
                          </div>
                        ) : filteredParams.length === 0 ? (
                          <div className="vst-manager-panel-note">
                            {selectedParams.length === 0
                              ? t('windows.vst-manager.selected.params.empty')
                              : t('windows.vst-manager.selected.params.filteredEmpty')}
                          </div>
                        ) : (
                          <div className="vst-manager-params-list" role="list">
                            {filteredParams.slice(0, 200).map((param) => (
                              <div
                                key={param.key}
                                className="vst-manager-param-row"
                                role="listitem"
                                title={t('windows.vst-manager.selected.params.tooltip', {
                                  key: param.key,
                                  min: param.min,
                                  max: param.max,
                                  default: param.default,
                                  unit: param.unit ?? '',
                                })}
                              >
                                <span className="vst-manager-param-key">{param.key}</span>
                                <span className="vst-manager-param-title">{param.title}</span>
                              </div>
                            ))}
                            {filteredParams.length > 200 ? (
                              <div className="vst-manager-panel-note">
                                {t('windows.vst-manager.selected.params.limited', {
                                  count: 200,
                                  total: filteredParams.length,
                                })}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="vst-manager-panel-note">
                        {t('windows.vst-manager.selected.params.notCached')}
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="vst-manager-panel-note">
                {t('windows.vst-manager.selected.empty')}
              </div>
            )}
          </div>
        </div>

        <div className="vst-manager-main">
          <div className="vst-manager-table-meta">
            <div>{t('windows.vst-manager.table.meta', { count: filteredPlugins.length })}</div>
            <div className="vst-manager-table-meta-right">
              <span className="vst-manager-pill">{t('windows.vst-manager.table.pill.format')}</span>
              <span className="vst-manager-pill">{t('windows.vst-manager.table.pill.type')}</span>
            </div>
          </div>

          <div className="vst-manager-table-wrap">
            <table className="vst-manager-table">
              <thead>
                <tr>
                  <th>{t('windows.vst-manager.table.header.name')}</th>
                  <th title={t('windows.vst-manager.table.header.usageTitle')}>
                    {t('windows.vst-manager.table.header.usage')}
                  </th>
                  <th>{t('windows.vst-manager.table.header.status')}</th>
                  <th>{t('windows.vst-manager.table.header.format')}</th>
                  <th>{t('windows.vst-manager.table.header.bits')}</th>
                  <th>{t('windows.vst-manager.table.header.io')}</th>
                  <th>{t('windows.vst-manager.table.header.type')}</th>
                  <th>{t('windows.vst-manager.table.header.vendor')}</th>
                  <th>{t('windows.vst-manager.table.header.filename')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlugins.map((plugin) => {
                  const selected = plugin.id === selectedPluginId;
                  const usage = rackUsage[plugin.id];
                  const usageText = usage ? `${usage.enabled}/${usage.total}` : '-';
                  return (
                    <tr
                      key={plugin.id}
                      className={selected ? 'vst-manager-row-selected' : undefined}
                      onClick={() => setSelectedPluginId(plugin.id)}
                    >
                      <td className="vst-manager-cell-name" title={plugin.id}>
                        <div className="vst-manager-name">{plugin.name}</div>
                        <div className="vst-manager-id">{plugin.id}</div>
                      </td>
                      <td title={usage ? usage.nodeIds.join(', ') : undefined}>{usageText}</td>
                      <td>{formatStatus(plugin.status, t)}</td>
                      <td>VST3</td>
                      <td>64</td>
                      <td>{formatIo(plugin)}</td>
                      <td>{t('windows.vst-manager.pluginType.effect')}</td>
                      <td title={plugin.vendor ?? ''}>{plugin.vendor ?? '-'}</td>
                      <td title={plugin.path ?? ''}>{plugin.path ? basename(plugin.path) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
