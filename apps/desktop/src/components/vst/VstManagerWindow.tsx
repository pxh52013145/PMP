import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { readJson, writeJson } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readData, STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, setupDualListener } from '../../utils/windowCommunication';
import './VstManagerWindow.css';

type VstScanMode = 'fast' | 'full' | 'params';

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

type LibraryPluginDescriptor = {
  id: string;
  name: string;
  vendor?: string | null;
  version?: string | null;
  path?: string | null;
  status?: string | null;
  lastSeenAtMs?: number | null;
  paramsScannedAtMs?: number | null;
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
    currentPluginId:
      typeof record.currentPluginId === 'string' ? record.currentPluginId : null,
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
    currentPluginId:
      typeof record.currentPluginId === 'string' ? record.currentPluginId : null,
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

function formatStatus(value: string | null | undefined): string {
  if (!value) return '-';
  if (value === 'ok') return 'OK';
  if (value === 'bad') return 'Bad';
  if (value === 'timeout') return 'Timeout';
  return value;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || path;
}

function matchesQuery(candidate: string, query: string): boolean {
  return candidate.toLowerCase().includes(query);
}

export function VstManagerWindow() {
  const isTauri = React.useMemo(() => isTauriRuntime(), []);
  const usedLegacyScanPathsRef = React.useRef(false);
  const [plugins, setPlugins] = React.useState<LibraryPluginDescriptor[]>([]);
  const [scanState, setScanState] = React.useState<VstScanState | null>(null);
  const [scanProgress, setScanProgress] = React.useState<VstScanProgressPayload | null>(null);
  const [scanRuns, setScanRuns] = React.useState<VstScanRun[]>([]);
  const [selectedScanRunId, setSelectedScanRunId] = React.useState<string>('');
  const [scanEvents, setScanEvents] = React.useState<VstScanEvent[]>([]);
  const [rackUsage, setRackUsage] = React.useState<Record<string, RackPluginUsage>>({});
  const [applyBusy, setApplyBusy] = React.useState(false);
  const [verifyOnScan, setVerifyOnScan] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(null);
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
      const [libraryResp, scanResp, scanRunsResp] = await Promise.all([
        invoke<unknown>('native_audio_vst_library_list_plugins').catch(() => []),
        invoke<unknown>('native_audio_vst_scan_state').catch(() => null),
        invoke<unknown>('native_audio_vst_library_list_scan_runs', { limit: 20 }).catch(() => []),
      ]);
      const libraryPlugins = ensureLibraryPlugins(libraryResp);
      const nextScanState = ensureVstScanState(scanResp);
      const nextScanRuns = ensureScanRuns(scanRunsResp);
      setPlugins(libraryPlugins);
      setScanState(nextScanState);
      setScanRuns(nextScanRuns);
      setSelectedScanRunId((current) => {
        const currentTrimmed = current.trim();
        const activeRunId = (nextScanState?.runId ?? '').trim();
        const hasActive = activeRunId && nextScanRuns.some((run) => run.runId === activeRunId);
        if (nextScanState?.running && hasActive) return activeRunId;
        if (currentTrimmed && nextScanRuns.some((run) => run.runId === currentTrimmed)) return currentTrimmed;
        return nextScanRuns[0]?.runId ?? '';
      });
      if (libraryPlugins.length && !selectedPluginId) {
        setSelectedPluginId(libraryPlugins[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [isTauri, selectedPluginId]);

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

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    void refreshScanEvents(selectedScanRunId);
  }, [refreshScanEvents, selectedScanRunId]);

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
      nodes: graph.nodes.filter((node) => !(node.type === 'vst' && readStringField(node, 'pluginId') === pluginId)),
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
      const graphResp = await invoke<unknown>('native_audio_get_dsp_graph').catch(() => ({ nodes: [] }));
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
        }
      });
    })();
    return () => {
      if (unlisten) void unlisten();
    };
  }, [isTauri, refresh, refreshScanEvents]);

  if (!isTauri) {
    return (
      <div className="vst-manager">
        <div className="vst-manager-empty">
          VST3 插件管理器需要在 Tauri 桌面运行（`pnpm dev:tauri`）。
        </div>
      </div>
    );
  }

  const progressText = scanRunning
    ? scanProgress?.message ||
      scanProgress?.currentPluginId ||
      scanState?.currentPluginId ||
      scanProgress?.stage ||
      scanState?.stage ||
      'running'
    : 'idle';

  const selectedUsage = selectedPlugin ? rackUsage[selectedPlugin.id] : null;
  const selectedScanRun = selectedScanRunId
    ? scanRuns.find((run) => run.runId === selectedScanRunId) ?? null
    : null;

  return (
    <div className="vst-manager">
      <div className="vst-manager-topbar">
        <div className="vst-manager-title">
          <div className="vst-manager-title-main">VST3 Plugin Manager</div>
          <div className="vst-manager-title-sub">
            {scanRunning
              ? `扫描中：${progressText}${
                  scanProgress?.total ? ` (${scanProgress.current}/${scanProgress.total})` : ''
                }`
              : `插件：${plugins.length}`}
          </div>
        </div>

        <div className="vst-manager-toolbar">
          <input
            className="vst-manager-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索插件..."
            aria-label="搜索插件"
          />
          <button type="button" onClick={() => void openDspRack()}>
            打开 DSP Rack
          </button>
          <button type="button" onClick={() => void refresh()} disabled={scanRunning}>
            刷新
          </button>
          <button type="button" onClick={() => void startScan()} disabled={scanRunning}>
            {verifyOnScan ? '扫描 + 验证' : '扫描'}
          </button>
          <button type="button" onClick={() => void cancelScan()} disabled={!scanRunning}>
            取消
          </button>
        </div>
      </div>

      {error && <div className="vst-manager-error">{error}</div>}

      <div className="vst-manager-content">
        <div className="vst-manager-sidebar">
          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">选项</div>
            <label className="vst-manager-checkbox">
              <input
                type="checkbox"
                checked={verifyOnScan}
                onChange={(e) => setVerifyOnScan(e.target.checked)}
                disabled={scanRunning}
              />
              验证插件（扫描参数）
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
              包含系统默认 VST3 搜索路径
            </label>
            <div className="vst-manager-panel-note">
              扫描会使用已启用的自定义路径；当“包含系统默认路径”开启时，会将系统默认路径与自定义路径合并扫描。
              若最终没有任何有效自定义路径，bridge 会自动回退到系统默认 VST3 路径。
            </div>
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">扫描路径</div>
            <div className="vst-manager-paths">
              {paths.length === 0 ? (
                <div className="vst-manager-panel-note">未配置自定义路径。</div>
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
                            {exists ? 'OK' : 'Missing'}
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        className="vst-manager-path-remove"
                        onClick={() => removePath(entry.path)}
                        disabled={scanRunning}
                        aria-label={`移除路径 ${entry.path}`}
                      >
                        移除
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div className="vst-manager-panel-actions">
              <button type="button" onClick={() => void addPath()} disabled={scanRunning}>
                添加路径...
              </button>
            </div>
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">诊断</div>
            <div className="vst-manager-panel-note">
              当前仅列出 VST3 Effect（不含 VSTi）。如果插件“扫描不到”，优先检查：是否为 VST3、是否为
              Effect、扫描路径是否存在、以及是否启用了“系统默认路径”。
            </div>

            {scanRuns.length === 0 ? (
              <div className="vst-manager-panel-note">暂无扫描记录。</div>
            ) : (
              <>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">最近扫描</div>
                  <div className="vst-manager-v">
                    <select
                      className="vst-manager-select"
                      value={selectedScanRunId}
                      onChange={(e) => setSelectedScanRunId(e.target.value)}
                      disabled={scanRunning}
                    >
                      {scanRuns.map((run) => (
                        <option key={run.runId} value={run.runId}>
                          {new Date(run.startedAtMs).toLocaleString()} · {run.status}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {selectedScanRunId && (
                  <>
                    {selectedScanRun ? (
                      <div className="vst-manager-kv">
                        <div className="vst-manager-k">状态</div>
                        <div className="vst-manager-v">{selectedScanRun.status}</div>
                      </div>
                    ) : null}
                    <div className="vst-manager-kv">
                      <div className="vst-manager-k">RunId</div>
                      <div className="vst-manager-v" title={selectedScanRunId}>
                        {selectedScanRunId}
                      </div>
                    </div>
                    <div className="vst-manager-kv">
                      <div className="vst-manager-k">事件</div>
                      <div className="vst-manager-v">{scanEvents.length || 0}</div>
                    </div>
                    {selectedScanRun?.error ? (
                      <div className="vst-manager-panel-note vst-manager-panel-note--error">
                        扫描错误：{selectedScanRun.error}
                      </div>
                    ) : null}
                    {scanState?.lastError ? (
                      <div className="vst-manager-panel-note vst-manager-panel-note--error">
                        最后错误：{scanState.lastError}
                      </div>
                    ) : null}

                    <div className="vst-manager-log" role="log" aria-label="扫描日志">
                      {scanEvents.length === 0 ? (
                        <div className="vst-manager-panel-note">暂无日志。</div>
                      ) : (
                        scanEvents.map((entry) => (
                          <div key={`${entry.atMs}-${entry.kind}-${entry.message}`} className="vst-manager-log-line">
                            <span className="vst-manager-log-time">
                              {new Date(entry.atMs).toLocaleTimeString()}
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
                        刷新日志
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="vst-manager-panel">
            <div className="vst-manager-panel-title">已选插件</div>
            {selectedPlugin ? (
              <>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">名称</div>
                  <div className="vst-manager-v">{selectedPlugin.name}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">厂商</div>
                  <div className="vst-manager-v">{selectedPlugin.vendor ?? '-'}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">状态</div>
                  <div className="vst-manager-v">{formatStatus(selectedPlugin.status)}</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">DSP Rack 引用</div>
                  <div className="vst-manager-v">
                    {selectedUsage ? `${selectedUsage.enabled}/${selectedUsage.total} 启用` : '未引用'}
                  </div>
                </div>
                {selectedUsage && selectedUsage.nodeIds.length > 0 && (
                  <div className="vst-manager-panel-note">
                    NodeId：{selectedUsage.nodeIds.slice(0, 8).join(', ')}
                    {selectedUsage.nodeIds.length > 8 ? '…' : ''}
                  </div>
                )}
                {selectedUsage && selectedUsage.nodeIds.length > 0 && (
                  <div className="vst-manager-node-list">
                    <div className="vst-manager-node-list-title">引用节点</div>
                    {selectedUsage.nodeIds.slice(0, 6).map((nodeId) => (
                      <div key={nodeId} className="vst-manager-node-row">
                        <div className="vst-manager-node-id" title={nodeId}>
                          {nodeId}
                        </div>
                        <button type="button" onClick={() => void locateDspRackNode(nodeId)}>
                          定位
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeRackNodes([nodeId])}
                          disabled={scanRunning || applyBusy}
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    {selectedUsage.nodeIds.length > 6 && (
                      <div className="vst-manager-panel-note">
                        仅显示前 6 个引用节点（共 {selectedUsage.nodeIds.length} 个）。
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
                      移除全部引用
                    </button>
                  </div>
                )}
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">格式</div>
                  <div className="vst-manager-v">VST3</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">位数</div>
                  <div className="vst-manager-v">64</div>
                </div>
                <div className="vst-manager-kv">
                  <div className="vst-manager-k">文件</div>
                  <div className="vst-manager-v">{selectedPlugin.path ? basename(selectedPlugin.path) : '-'}</div>
                </div>
                <div className="vst-manager-panel-actions">
                  <button type="button" onClick={() => void scanParams()} disabled={scanRunning}>
                    扫描参数
                  </button>
                  <button type="button" onClick={() => void addToDspRack()} disabled={scanRunning || applyBusy}>
                    添加到 DSP Rack
                  </button>
                </div>
              </>
            ) : (
              <div className="vst-manager-panel-note">请从列表中选择一个插件。</div>
            )}
          </div>
        </div>

        <div className="vst-manager-main">
          <div className="vst-manager-table-meta">
            <div>{filteredPlugins.length} 个插件 · 选中插件后点击“添加到 DSP Rack”。</div>
            <div className="vst-manager-table-meta-right">
              <span className="vst-manager-pill">格式：VST3</span>
              <span className="vst-manager-pill">类型：效果器</span>
            </div>
          </div>

          <div className="vst-manager-table-wrap">
            <table className="vst-manager-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th title="DSP Rack 引用（启用/总数）">引用</th>
                  <th>状态</th>
                  <th>格式</th>
                  <th>位数</th>
                  <th>类型</th>
                  <th>厂商</th>
                  <th>文件名</th>
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
                      <td>{formatStatus(plugin.status)}</td>
                      <td>VST3</td>
                      <td>64</td>
                      <td>Effect</td>
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
