import React from 'react';
import { ArrowDown, ArrowUp, Power, Trash2 } from 'lucide-react';
import { useAudioEngine, useAudioService } from '../../contexts/AudioEngineContext';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n';
import { readString, writeString } from '../../modules/storage';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import type { AudioSpectrumFrame } from '../../services/audio/types';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  invokeWithTelemetry,
  type TauriInvokeTelemetryOptions,
} from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readData, STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, setupDualListener } from '../../utils/windowCommunication';
import { VstNodeParamsPanel } from '../vst/VstNodeParamsPanel';
import './DspRackPage.css';

type EqBandKind = 'peaking' | 'low-shelf' | 'high-shelf';

type EqBand = {
  kind: EqBandKind;
  frequencyHz: number;
  q: number;
  gainDb: number;
};

type VstParamValue = {
  key: string;
  value: number;
};

type DspNodeBase = {
  id: string;
  enabled: boolean;
  type: string;
};

type GainNode = DspNodeBase & { type: 'gain'; db: number };
type EqNode = DspNodeBase & { type: 'eq'; bands: EqBand[] };
type LimiterNode = DspNodeBase & { type: 'limiter'; thresholdDb: number };
type PitchShiftNode = DspNodeBase & { type: 'pitch-shift'; semitones: number };
type TempoNode = DspNodeBase & { type: 'tempo'; rate: number; preservePitch: boolean };
type VstNode = DspNodeBase & { type: 'vst'; pluginId: string; params?: VstParamValue[] };
type DspNode =
  | GainNode
  | EqNode
  | LimiterNode
  | PitchShiftNode
  | TempoNode
  | VstNode
  | (DspNodeBase & Record<string, unknown>);

type DspGraphConfig = { nodes: DspNode[] };

type DspRackTab = 'overview' | 'tone' | 'transform' | 'vst' | 'chain';
type DspNodeCategory = 'tone' | 'transform' | 'vst' | 'other';

type SpectrumSnapshot = {
  pre: AudioSpectrumFrame | null;
  post: AudioSpectrumFrame | null;
};

type SpectrumMetrics = {
  rmsDb: number | null;
  peakDb: number | null;
  low: number | null;
  mid: number | null;
  high: number | null;
  frameId: number | null;
};

type DspGraphSummary = {
  enabledCount: number;
  bypassedCount: number;
  totalGainDb: number;
  tempoRate: number;
  pitchSemitones: number;
  vstEnabledCount: number;
  vstActiveCount: number;
  vstProblemCount: number;
};

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type VstSessionStatus = {
  nodeId: string;
  pluginId: string;
  peerReady: boolean;
  pluginLoaded: boolean;
  processingActive: boolean;
  pluginError: boolean;
  nativeEditorOpen?: boolean;
  heartbeatIn?: number | null;
  heartbeatOut?: number | null;
};

const EVENT_VST_SESSION_STATUSES = 'vst-session-statuses';
const EMPTY_DSP_NODES: DspNode[] = [];
const DSP_RACK_TABS: readonly DspRackTab[] = ['overview', 'tone', 'transform', 'vst', 'chain'];

const telemetry = getTelemetryLogger('vst', 'DspRackPage');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invokeDspRack<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  event: string,
  options: Partial<TauriInvokeTelemetryOptions> = {}
): Promise<T> {
  return invokeWithTelemetry<T>(command, args, {
    moduleId: 'vst',
    component: 'DspRackPage',
    event,
    ...options,
  });
}

function clamp(value: number, min: number, max: number) {
  if (!isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

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

function readBooleanField(value: unknown, field: string): boolean | null {
  const record = asRecord(value);
  if (!record) return null;
  const candidate = record[field];
  return typeof candidate === 'boolean' ? candidate : null;
}

function ensureDspGraphConfig(value: unknown): DspGraphConfig {
  const record = asRecord(value);
  if (!record) return { nodes: [] };
  const nodes = record.nodes;
  return { nodes: Array.isArray(nodes) ? (nodes as DspNode[]) : [] };
}

function ensureVstSessionStatusMap(value: unknown): Record<string, VstSessionStatus> {
  if (!Array.isArray(value)) return {};
  const map: Record<string, VstSessionStatus> = {};
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const nodeId = readStringField(entry, 'nodeId');
    const pluginId = readStringField(entry, 'pluginId') ?? '';
    if (!nodeId) continue;
    map[nodeId] = {
      nodeId,
      pluginId,
      peerReady: readBooleanField(record, 'peerReady') ?? false,
      pluginLoaded: readBooleanField(record, 'pluginLoaded') ?? false,
      processingActive: readBooleanField(record, 'processingActive') ?? false,
      pluginError: readBooleanField(record, 'pluginError') ?? false,
      nativeEditorOpen: readBooleanField(record, 'nativeEditorOpen') ?? false,
      heartbeatIn: readNumberField(entry, 'heartbeatIn'),
      heartbeatOut: readNumberField(entry, 'heartbeatOut'),
    };
  }
  return map;
}

function computeTotalGainDb(nodes: DspNode[]) {
  let sum = 0;
  for (const node of nodes) {
    if (!node.enabled) continue;
    if (node.type === 'gain') {
      const db = readNumberField(node, 'db');
      if (db !== null) sum += db;
    }
  }
  return clamp(sum, -60, 12);
}

function computeTempoRate(nodes: DspNode[]) {
  let rate = 1;
  for (const node of nodes) {
    if (!node.enabled || node.type !== 'tempo') continue;
    rate *= clamp(readNumberField(node, 'rate') ?? 1, 0.25, 4);
  }
  return clamp(rate, 0.25, 4);
}

function computePitchSemitones(nodes: DspNode[]) {
  let semitones = 0;
  for (const node of nodes) {
    if (!node.enabled) continue;
    if (node.type === 'pitch-shift') {
      semitones += clamp(readNumberField(node, 'semitones') ?? 0, -24, 24);
    }
    if (node.type === 'tempo' && !(readBooleanField(node, 'preservePitch') ?? true)) {
      const rate = clamp(readNumberField(node, 'rate') ?? 1, 0.25, 4);
      semitones += 12 * Math.log2(rate);
    }
  }
  return clamp(semitones, -48, 48);
}

function getNodeCategory(node: DspNode): DspNodeCategory {
  if (node.type === 'gain' || node.type === 'eq' || node.type === 'limiter') return 'tone';
  if (node.type === 'pitch-shift' || node.type === 'tempo') return 'transform';
  if (node.type === 'vst') return 'vst';
  return 'other';
}

function getFilteredNodes(nodes: DspNode[], tab: DspRackTab) {
  if (tab === 'chain') return nodes;
  if (tab === 'overview') return [];
  return nodes.filter((node) => getNodeCategory(node) === tab);
}

function countNodes(nodes: DspNode[], category: DspNodeCategory) {
  return nodes.filter((node) => getNodeCategory(node) === category).length;
}

function hasOtherNodes(nodes: DspNode[]) {
  return nodes.some((node) => getNodeCategory(node) === 'other');
}

function computeVstProblemCount(nodes: DspNode[], statuses: Record<string, VstSessionStatus>) {
  let count = 0;
  for (const node of nodes) {
    if (!node.enabled || node.type !== 'vst') continue;
    const pluginId = (readStringField(node, 'pluginId') ?? '').trim();
    const status = statuses[node.id];
    if (!pluginId || !status || status.pluginError || !status.peerReady) {
      count += 1;
    }
  }
  return count;
}

function computeGraphSummary(nodes: DspNode[], statuses: Record<string, VstSessionStatus>): DspGraphSummary {
  const enabledNodes = nodes.filter((node) => node.enabled);
  const vstEnabledNodes = enabledNodes.filter((node) => node.type === 'vst');
  return {
    enabledCount: enabledNodes.length,
    bypassedCount: nodes.length - enabledNodes.length,
    totalGainDb: computeTotalGainDb(nodes),
    tempoRate: computeTempoRate(nodes),
    pitchSemitones: computePitchSemitones(nodes),
    vstEnabledCount: vstEnabledNodes.length,
    vstActiveCount: vstEnabledNodes.filter((node) => statuses[node.id]?.processingActive).length,
    vstProblemCount: computeVstProblemCount(nodes, statuses),
  };
}

function toLinearAudioSample(value: number) {
  return (value - 128) / 128;
}

function toDbFromUnit(value: number) {
  return 20 * Math.log10(Math.max(value, 0.000_001));
}

function averageRange(values: readonly number[], start: number, end: number) {
  if (values.length === 0) return null;
  const from = clamp(Math.floor(start), 0, values.length);
  const to = clamp(Math.floor(end), from + 1, values.length);
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    sum += values[index] ?? 0;
  }
  return sum / Math.max(1, to - from);
}

function computeSpectrumMetrics(frame: AudioSpectrumFrame | null): SpectrumMetrics {
  if (!frame) {
    return {
      rmsDb: null,
      peakDb: null,
      low: null,
      mid: null,
      high: null,
      frameId: null,
    };
  }

  const timeDomain = frame.timeDomain ? Array.from(frame.timeDomain) : [];
  let rmsDb: number | null = null;
  let peakDb: number | null = null;

  if (timeDomain.length > 0) {
    let sumSquares = 0;
    let peak = 0;
    for (const value of timeDomain) {
      const sample = toLinearAudioSample(value);
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    rmsDb = toDbFromUnit(Math.sqrt(sumSquares / timeDomain.length));
    peakDb = toDbFromUnit(peak);
  }

  const bins = Array.from(frame.bins ?? []);
  const low = averageRange(bins, 0, bins.length * 0.18);
  const mid = averageRange(bins, bins.length * 0.18, bins.length * 0.62);
  const high = averageRange(bins, bins.length * 0.62, bins.length);

  return {
    rmsDb,
    peakDb,
    low,
    mid,
    high,
    frameId: frame.frameId,
  };
}

function formatDbValue(value: number | null, digits = 1) {
  if (value === null || !isFinite(value)) return '--';
  return `${formatSigned(value, digits)} dB`;
}

function formatDeltaValue(value: number | null, digits = 1) {
  if (value === null || !isFinite(value)) return '--';
  return formatSigned(value, digits);
}

function normalizeBarValue(value: number | null, max = 255) {
  if (value === null || !isFinite(value)) return 0;
  return clamp((value / max) * 100, 0, 100);
}

function metricDelta(pre: number | null, post: number | null) {
  if (pre === null || post === null) return null;
  return post - pre;
}

function ensureNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function ensureEqBands(value: unknown): EqBand[] {
  if (!Array.isArray(value)) return [];
  const out: EqBand[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const kindRaw = record.kind;
    const kind: EqBandKind =
      kindRaw === 'low-shelf' || kindRaw === 'high-shelf' || kindRaw === 'peaking' ? kindRaw : 'peaking';
    out.push({
      kind,
      frequencyHz: ensureNumber(record.frequencyHz, 1000),
      q: ensureNumber(record.q, 1),
      gainDb: ensureNumber(record.gainDb, 0),
    });
  }
  return out;
}

function ensureVstParamValues(value: unknown): VstParamValue[] {
  if (!Array.isArray(value)) return [];
  const out: VstParamValue[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = readStringField(record, 'key');
    const num = readNumberField(record, 'value');
    if (!key || num === null) continue;
    out.push({ key, value: num });
  }
  return out;
}

function defaultEqBands(): EqBand[] {
  return [
    { kind: 'low-shelf', frequencyHz: 120, q: 1, gainDb: 0 },
    { kind: 'peaking', frequencyHz: 1000, q: 1, gainDb: 0 },
    { kind: 'high-shelf', frequencyHz: 8000, q: 1, gainDb: 0 },
  ];
}

function uniqueNodeId(type: string) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatSigned(value: number, digits = 1) {
  const normalized = isFinite(value) ? value : 0;
  const sign = normalized > 0 ? '+' : '';
  return `${sign}${normalized.toFixed(digits)}`;
}

function formatNodeTypeLabel(type: string, t: TranslateFn) {
  switch (type) {
    case 'gain':
      return t('pages.dsp-rack.node.type.gain');
    case 'eq':
      return t('pages.dsp-rack.node.type.eq');
    case 'limiter':
      return t('pages.dsp-rack.node.type.limiter');
    case 'pitch-shift':
      return t('pages.dsp-rack.node.type.pitchShift');
    case 'tempo':
      return t('pages.dsp-rack.node.type.tempo');
    case 'vst':
      return t('pages.dsp-rack.node.type.vst');
    default:
      return type;
  }
}

function formatEqBandKind(kind: EqBandKind, t: TranslateFn) {
  switch (kind) {
    case 'low-shelf':
      return t('pages.dsp-rack.eq.kind.lowShelf');
    case 'high-shelf':
      return t('pages.dsp-rack.eq.kind.highShelf');
    case 'peaking':
    default:
      return t('pages.dsp-rack.eq.kind.peaking');
  }
}

function isDspRackTab(value: unknown): value is DspRackTab {
  return typeof value === 'string' && DSP_RACK_TABS.includes(value as DspRackTab);
}

function readPersistedDspRackTab(): DspRackTab {
  const stored = readString(STORAGE_KEYS.DSP_RACK_ACTIVE_TAB);
  return isDspRackTab(stored) ? stored : 'overview';
}

function persistDspRackTab(tab: DspRackTab): void {
  writeString(STORAGE_KEYS.DSP_RACK_ACTIVE_TAB, tab);
}

export const DspRackPage: React.FC = () => {
  const t = useT();
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { isNativeAvailable } = useAudioEngine();
  const audioService = useAudioService();
  const isTauri = React.useMemo(() => isTauriRuntime(), []);
  const [graph, setGraph] = React.useState<DspGraphConfig | null>(null);
  const [vstStatuses, setVstStatuses] = React.useState<Record<string, VstSessionStatus>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [highlightNodeId, setHighlightNodeId] = React.useState<string | null>(null);
  const [activeTab, setActiveTabState] = React.useState<DspRackTab>(() => readPersistedDspRackTab());
  const [spectrumSnapshot, setSpectrumSnapshot] = React.useState<SpectrumSnapshot>({ pre: null, post: null });
  const lastLocateRequestIdRef = React.useRef<string | null>(null);
  const clearHighlightTimerRef = React.useRef<number | null>(null);

  const setActiveTab = React.useCallback((tab: DspRackTab) => {
    setActiveTabState(tab);
    persistDspRackTab(tab);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!isTauri) return;
    setBusy(true);
    setError(null);
    try {
      const graphResp = await invokeDspRack<DspGraphConfig>(
        'native_audio_get_dsp_graph',
        undefined,
        'vst.graph.read'
      );
      const nextGraph = graphResp && typeof graphResp === 'object' ? graphResp : { nodes: [] };
      setGraph(nextGraph);
      try {
        const statuses = await invokeDspRack<VstSessionStatus[]>(
          'native_audio_vst_list_session_statuses',
          undefined,
          'vst.session-status.list'
        );
        const map: Record<string, VstSessionStatus> = {};
        for (const status of statuses) {
          map[status.nodeId] = status;
        }
        setVstStatuses(map);
      } catch {
        setVstStatuses({});
      }
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH,
        nextGraph,
        TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED
      );
      await broadcastDataUpdate(
        STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
        computeTotalGainDb(nextGraph.nodes),
        TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [isTauri]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!isTauri) return;
    let cleanup: null | (() => void) = null;
    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<unknown>(EVENT_VST_SESSION_STATUSES, (event) => {
          setVstStatuses(ensureVstSessionStatusMap(event.payload));
        })
      )
      .then((fn) => {
        cleanup = fn;
      })
      .catch(() => {});
    return () => cleanup?.();
  }, [isTauri]);

  React.useEffect(() => {
    if (!isTauri) return;
    let cleanup: null | (() => void) = null;
    void setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH],
      [TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED],
      () => {
        const stored = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH);
        if (stored === null) return;
        setGraph(ensureDspGraphConfig(stored));
      }
    ).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [isTauri]);

  React.useEffect(() => {
    if (!isTauri) return;

    const handleLocate = () => {
      const payload = readData<unknown>(STORAGE_KEYS.DSP_RACK_LOCATE_NODE);
      const requestId = readStringField(payload, 'requestId') ?? readStringField(payload, 'id');
      const nodeId = readStringField(payload, 'nodeId');
      if (!requestId || !nodeId) return;
      if (lastLocateRequestIdRef.current === requestId) return;
      lastLocateRequestIdRef.current = requestId;

      const locatedNode = graph?.nodes.find((node) => node.id === nodeId);
      if (locatedNode) {
        const category = getNodeCategory(locatedNode);
        setActiveTab(category === 'other' ? 'chain' : category);
      }

      if (clearHighlightTimerRef.current !== null) {
        window.clearTimeout(clearHighlightTimerRef.current);
        clearHighlightTimerRef.current = null;
      }

      setHighlightNodeId(nodeId);
      clearHighlightTimerRef.current = window.setTimeout(() => {
        clearHighlightTimerRef.current = null;
        setHighlightNodeId((prev) => (prev === nodeId ? null : prev));
      }, 2600);

      window.requestAnimationFrame(() => {
        const el = document.getElementById(`dsp-node-${nodeId}`);
        if (!el) return;
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch {
          el.scrollIntoView();
        }
      });
    };

    let cleanup: null | (() => void) = null;
    handleLocate();
    void setupDualListener([STORAGE_KEYS.DSP_RACK_LOCATE_NODE], [TAURI_EVENTS.DSP_RACK_LOCATE_NODE], handleLocate).then(
      (fn) => {
        cleanup = fn;
      }
    );
    return () => {
      cleanup?.();
      if (clearHighlightTimerRef.current !== null) {
        window.clearTimeout(clearHighlightTimerRef.current);
        clearHighlightTimerRef.current = null;
      }
    };
  }, [graph, isTauri, setActiveTab]);

  React.useEffect(() => {
    if (!isTauri || !isNativeAvailable || !audioService.getSpectrumFrame) {
      setSpectrumSnapshot({ pre: null, post: null });
      return;
    }

    const readSpectrum = () => {
      setSpectrumSnapshot({
        pre: audioService.getSpectrumFrame?.('pre-dsp') ?? null,
        post: audioService.getSpectrumFrame?.('post-dsp') ?? null,
      });
    };

    readSpectrum();
    const timer = window.setInterval(readSpectrum, 250);
    return () => window.clearInterval(timer);
  }, [audioService, isNativeAvailable, isTauri]);

  const handleOpenVstManager = React.useCallback(async () => {
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

  const applyGraph = React.useCallback(
    async (next: DspGraphConfig) => {
      setGraph(next);
      setError(null);
      try {
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH,
          next,
          TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED
        );
        const gainDb = computeTotalGainDb(next.nodes);
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_GAIN_DB,
          gainDb,
          TAURI_EVENTS.NATIVE_AUDIO_GAIN_DB_UPDATED
        );
        await invokeDspRack('native_audio_set_dsp_graph', { graph: next }, 'vst.graph.apply');
      } catch (err) {
        telemetry.error('vst.graph.apply.failed', {
          message: getErrorMessage(err),
          fields: {
            nodeCount: next.nodes.length,
          },
        });
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setGraph]
  );

  const updateNode = React.useCallback(
    (nodeId: string, updater: (node: DspNode) => DspNode) => {
      if (!graph) return;
      const nextNodes = graph.nodes.map((node) => (node.id === nodeId ? updater(node) : node));
      void applyGraph({ nodes: nextNodes });
    },
    [applyGraph, graph]
  );

  const moveNode = React.useCallback(
    (nodeId: string, delta: number) => {
      if (!graph) return;
      const index = graph.nodes.findIndex((node) => node.id === nodeId);
      if (index === -1) return;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= graph.nodes.length) return;
      const nextNodes = [...graph.nodes];
      const [picked] = nextNodes.splice(index, 1);
      nextNodes.splice(nextIndex, 0, picked);
      void applyGraph({ nodes: nextNodes });
    },
    [applyGraph, graph]
  );

  const removeNode = React.useCallback(
    (nodeId: string) => {
      if (!graph) return;
      void applyGraph({ nodes: graph.nodes.filter((node) => node.id !== nodeId) });
    },
    [applyGraph, graph]
  );

  const addNode = React.useCallback(
    (type: 'gain' | 'eq' | 'limiter' | 'pitch-shift' | 'tempo') => {
      if (!graph) return;
      const id = uniqueNodeId(type);
      let node: DspNode;
      switch (type) {
        case 'gain':
          node = { id, enabled: true, type: 'gain', db: 0 };
          break;
        case 'eq':
          node = { id, enabled: true, type: 'eq', bands: defaultEqBands() };
          break;
        case 'limiter':
          node = { id, enabled: true, type: 'limiter', thresholdDb: -6 };
          break;
        case 'pitch-shift':
          node = { id, enabled: true, type: 'pitch-shift', semitones: 0 };
          break;
        case 'tempo':
          node = { id, enabled: true, type: 'tempo', rate: 1, preservePitch: true };
          break;
      }
      void applyGraph({ nodes: [...graph.nodes, node] });
    },
    [applyGraph, graph]
  );

  const nodes = graph?.nodes ?? EMPTY_DSP_NODES;
  const visibleNodes = React.useMemo(() => getFilteredNodes(nodes, activeTab), [activeTab, nodes]);
  const graphSummary = React.useMemo(() => computeGraphSummary(nodes, vstStatuses), [nodes, vstStatuses]);
  const preMetrics = React.useMemo(() => computeSpectrumMetrics(spectrumSnapshot.pre), [spectrumSnapshot.pre]);
  const postMetrics = React.useMemo(() => computeSpectrumMetrics(spectrumSnapshot.post), [spectrumSnapshot.post]);
  const hasSpectrumFrames = preMetrics.frameId !== null || postMetrics.frameId !== null;
  const spectrumRows = React.useMemo(
    () => [
      {
        key: 'rms',
        label: t('pages.dsp-rack.overview.spectrum.rms'),
        pre: preMetrics.rmsDb,
        post: postMetrics.rmsDb,
        delta: metricDelta(preMetrics.rmsDb, postMetrics.rmsDb),
        mode: 'db' as const,
        preBar: normalizeBarValue(preMetrics.rmsDb === null ? null : preMetrics.rmsDb + 60, 60),
        postBar: normalizeBarValue(postMetrics.rmsDb === null ? null : postMetrics.rmsDb + 60, 60),
      },
      {
        key: 'peak',
        label: t('pages.dsp-rack.overview.spectrum.peak'),
        pre: preMetrics.peakDb,
        post: postMetrics.peakDb,
        delta: metricDelta(preMetrics.peakDb, postMetrics.peakDb),
        mode: 'db' as const,
        preBar: normalizeBarValue(preMetrics.peakDb === null ? null : preMetrics.peakDb + 60, 60),
        postBar: normalizeBarValue(postMetrics.peakDb === null ? null : postMetrics.peakDb + 60, 60),
      },
      {
        key: 'low',
        label: t('pages.dsp-rack.overview.spectrum.low'),
        pre: preMetrics.low,
        post: postMetrics.low,
        delta: metricDelta(preMetrics.low, postMetrics.low),
        mode: 'bin' as const,
        preBar: normalizeBarValue(preMetrics.low),
        postBar: normalizeBarValue(postMetrics.low),
      },
      {
        key: 'mid',
        label: t('pages.dsp-rack.overview.spectrum.mid'),
        pre: preMetrics.mid,
        post: postMetrics.mid,
        delta: metricDelta(preMetrics.mid, postMetrics.mid),
        mode: 'bin' as const,
        preBar: normalizeBarValue(preMetrics.mid),
        postBar: normalizeBarValue(postMetrics.mid),
      },
      {
        key: 'high',
        label: t('pages.dsp-rack.overview.spectrum.high'),
        pre: preMetrics.high,
        post: postMetrics.high,
        delta: metricDelta(preMetrics.high, postMetrics.high),
        mode: 'bin' as const,
        preBar: normalizeBarValue(preMetrics.high),
        postBar: normalizeBarValue(postMetrics.high),
      },
    ],
    [postMetrics, preMetrics, t]
  );
  const tabs = React.useMemo(
    () =>
      [
        { id: 'overview' as const, label: t('pages.dsp-rack.tabs.overview'), count: nodes.length },
        { id: 'tone' as const, label: t('pages.dsp-rack.tabs.tone'), count: countNodes(nodes, 'tone') },
        {
          id: 'transform' as const,
          label: t('pages.dsp-rack.tabs.transform'),
          count: countNodes(nodes, 'transform'),
        },
        { id: 'vst' as const, label: t('pages.dsp-rack.tabs.vst'), count: countNodes(nodes, 'vst') },
        { id: 'chain' as const, label: t('pages.dsp-rack.tabs.chain'), count: nodes.length },
      ],
    [nodes, t]
  );

  const renderNodeCard = React.useCallback(
    (node: DspNode) => {
      const index = nodes.findIndex((candidate) => candidate.id === node.id);
      const nodeTypeLabel = formatNodeTypeLabel(node.type, t);
      const nodeOrderLabel = t('pages.dsp-rack.node.order', { index: index >= 0 ? index + 1 : '-' });
      const nodeIdTitle = t('pages.dsp-rack.node.idTitle', { id: node.id });
      const enabledLabel = t('pages.dsp-rack.node.status.enabled');
      const bypassedLabel = t('pages.dsp-rack.node.status.bypassed');
      const moveUpLabel = t('pages.dsp-rack.node.moveUp');
      const moveDownLabel = t('pages.dsp-rack.node.moveDown');
      const removeLabel = t('pages.dsp-rack.node.remove');
      const status = node.type === 'vst' ? vstStatuses[node.id] : undefined;
      const pluginId = node.type === 'vst' ? (readStringField(node, 'pluginId') ?? '').trim() : '';
      const statusKind: 'ok' | 'warn' | 'bad' = (() => {
        if (node.type !== 'vst') return 'bad';
        if (!node.enabled || !pluginId || !status || status.pluginError || !status.peerReady) return 'bad';
        if (status.processingActive) return 'ok';
        return 'warn';
      })();
      const statusTitle = (() => {
        if (node.type !== 'vst') return '';
        if (!node.enabled) return t('pages.dsp-rack.vst.status.disabled');
        if (!pluginId) return t('pages.dsp-rack.vst.status.missingPlugin');
        if (!status) return t('pages.dsp-rack.vst.status.noSession');
        if (status.pluginError) return t('pages.dsp-rack.vst.status.error');
        if (!status.peerReady) return t('pages.dsp-rack.vst.status.shmNotReady');
        if (status.processingActive) {
          return t('pages.dsp-rack.vst.status.active', {
            heartbeatIn: status.heartbeatIn ?? '-',
            heartbeatOut: status.heartbeatOut ?? '-',
          });
        }
        if (status.pluginLoaded) return t('pages.dsp-rack.vst.status.loaded');
        return t('pages.dsp-rack.vst.status.loading');
      })();
      const nativeEditorOpen = !!status?.nativeEditorOpen;

      return (
        <div
          key={node.id}
          id={`dsp-node-${node.id}`}
          className={`dsp-node-card${node.id === highlightNodeId ? ' dsp-node-card--highlight' : ''}`}
        >
          <div className="dsp-node-header">
            <div className="dsp-node-title">
              <span className="dsp-node-title-row">
                <span className="dsp-node-type">{nodeTypeLabel}</span>
                <span className={`dsp-node-status-pill${node.enabled ? ' is-on' : ''}`}>
                  {node.enabled ? enabledLabel : bypassedLabel}
                </span>
              </span>
              <span className="dsp-node-order" title={nodeIdTitle}>
                {nodeOrderLabel}
              </span>
              <span className="dsp-node-id">
                #{index >= 0 ? index + 1 : '-'} · {node.id}
              </span>
              {node.type === 'vst' && (
                <div className="vst-node-indicators">
                  <span
                    className={`vst-indicator ${
                      statusKind === 'ok'
                        ? 'vst-indicator--ok'
                        : statusKind === 'warn'
                          ? 'vst-indicator--warn'
                          : 'vst-indicator--bad'
                    }`}
                    title={statusTitle}
                  >
                    <span className="vst-indicator-dot" />
                    {t('pages.dsp-rack.vst.indicator.status')}
                  </span>
                  <span
                    className={`vst-indicator ${nativeEditorOpen ? 'vst-indicator--ok' : 'vst-indicator--bad'}`}
                    title={
                      nativeEditorOpen
                        ? t('pages.dsp-rack.vst.nativeUi.openState')
                        : t('pages.dsp-rack.vst.nativeUi.closedState')
                    }
                  >
                    <span className="vst-indicator-dot" />
                    UI
                  </span>
                </div>
              )}
            </div>

            <div className="dsp-node-controls">
              <label
                className={`dsp-node-toggle${node.enabled ? ' is-on' : ''}`}
                title={node.enabled ? enabledLabel : bypassedLabel}
              >
                <input
                  type="checkbox"
                  aria-label={t('pages.dsp-rack.node.enabled')}
                  checked={!!node.enabled}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <span className="dsp-node-toggle-track" aria-hidden="true">
                  <span className="dsp-node-toggle-thumb">
                    <Power size={10} />
                  </span>
                </span>
                <span className="dsp-node-toggle-text">{node.enabled ? enabledLabel : bypassedLabel}</span>
              </label>

              {node.type === 'vst' && (
                <button
                  type="button"
                  className="dsp-node-action-button"
                  title={
                    node.enabled
                      ? t('pages.dsp-rack.vst.nativeUi.openTitle')
                      : t('pages.dsp-rack.vst.nativeUi.enableFirst')
                  }
                  onClick={() =>
                    void invokeDspRack(
                      'native_audio_vst_open_native_editor',
                      {
                        nodeId: node.id,
                        title: `VST3 (${readStringField(node, 'pluginId') ?? 'vst'})`,
                      },
                      'vst.editor.open'
                    ).catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  }
                  disabled={busy || !node.enabled || !pluginId}
                >
                  Native UI
                </button>
              )}

              {node.type === 'vst' && (
                <button
                  type="button"
                  className="dsp-node-action-button"
                  onClick={() =>
                    void invokeDspRack(
                      'native_audio_vst_close_native_editor',
                      { nodeId: node.id },
                      'vst.editor.close'
                    ).catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  }
                  disabled={busy || !(vstStatuses[node.id]?.nativeEditorOpen ?? false)}
                >
                  {t('pages.dsp-rack.vst.nativeUi.close')}
                </button>
              )}

              <button
                type="button"
                className="dsp-node-icon-button"
                title={moveUpLabel}
                aria-label={moveUpLabel}
                onClick={() => moveNode(node.id, -1)}
                disabled={index <= 0 || busy}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="dsp-node-icon-button"
                title={moveDownLabel}
                aria-label={moveDownLabel}
                onClick={() => moveNode(node.id, 1)}
                disabled={index === -1 || index === nodes.length - 1 || busy}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="dsp-node-icon-button dsp-node-icon-button--danger"
                title={removeLabel}
                aria-label={removeLabel}
                onClick={() => removeNode(node.id)}
                disabled={busy}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {node.type === 'gain' && (
            <div className="dsp-node-body">
              <div className="dsp-param-row">
                <span className="dsp-param-label">{t('pages.dsp-rack.gain.db')}</span>
                <input
                  className="dsp-param-range"
                  type="range"
                  min={-60}
                  max={12}
                  step={0.1}
                  value={readNumberField(node, 'db') ?? 0}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      db: clamp(Number(e.target.value), -60, 12),
                    }))
                  }
                />
                <span className="dsp-param-value">{(readNumberField(node, 'db') ?? 0).toFixed(1)} dB</span>
              </div>
            </div>
          )}

          {node.type === 'limiter' && (
            <div className="dsp-node-body">
              <div className="dsp-param-row">
                <span className="dsp-param-label">{t('pages.dsp-rack.limiter.thresholdDb')}</span>
                <input
                  className="dsp-param-range"
                  type="range"
                  min={-30}
                  max={0}
                  step={0.1}
                  value={readNumberField(node, 'thresholdDb') ?? -6}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      thresholdDb: clamp(Number(e.target.value), -30, 0),
                    }))
                  }
                />
                <span className="dsp-param-value">
                  {(readNumberField(node, 'thresholdDb') ?? -6).toFixed(1)} dB
                </span>
              </div>
            </div>
          )}

          {node.type === 'pitch-shift' && (
            <div className="dsp-node-body">
              <div className="dsp-param-row">
                <span className="dsp-param-label">{t('pages.dsp-rack.pitchShift.semitones')}</span>
                <input
                  className="dsp-param-range"
                  type="range"
                  min={-12}
                  max={12}
                  step={0.1}
                  value={readNumberField(node, 'semitones') ?? 0}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      semitones: clamp(Number(e.target.value), -24, 24),
                    }))
                  }
                />
                <span className="dsp-param-value">
                  {formatSigned(readNumberField(node, 'semitones') ?? 0)} st
                </span>
              </div>
            </div>
          )}

          {node.type === 'tempo' && (
            <div className="dsp-node-body">
              <div className="dsp-param-row">
                <span className="dsp-param-label">{t('pages.dsp-rack.tempo.rate')}</span>
                <input
                  className="dsp-param-range"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.01}
                  value={readNumberField(node, 'rate') ?? 1}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      rate: clamp(Number(e.target.value), 0.25, 4),
                    }))
                  }
                />
                <span className="dsp-param-value">{(readNumberField(node, 'rate') ?? 1).toFixed(2)}x</span>
              </div>
              <label className="dsp-param-check">
                <input
                  type="checkbox"
                  checked={readBooleanField(node, 'preservePitch') ?? true}
                  onChange={(e) =>
                    updateNode(node.id, (n) => ({
                      ...n,
                      preservePitch: e.target.checked,
                    }))
                  }
                />
                <span>{t('pages.dsp-rack.tempo.preservePitch')}</span>
              </label>
            </div>
          )}

          {node.type === 'eq' && (
            <div className="dsp-node-body">
              {ensureEqBands(asRecord(node)?.bands).map((band, bandIndex) => (
                <div key={`${band.kind}-${band.frequencyHz}-${bandIndex}`} className="dsp-param-row">
                  <span className="dsp-param-label">
                    {t('pages.dsp-rack.eq.bandLabel', {
                      kind: formatEqBandKind(band.kind, t),
                      frequencyHz: Math.round(band.frequencyHz),
                    })}
                  </span>
                  <input
                    className="dsp-param-range"
                    type="range"
                    min={-12}
                    max={12}
                    step={0.1}
                    value={band.gainDb}
                    onChange={(e) => {
                      const gainDb = clamp(Number(e.target.value), -24, 24);
                      updateNode(node.id, (n) => {
                        const nextBands = ensureEqBands(asRecord(n)?.bands);
                        if (bandIndex >= nextBands.length) return n;
                        nextBands[bandIndex] = { ...nextBands[bandIndex], gainDb };
                        return { ...n, bands: nextBands };
                      });
                    }}
                  />
                  <span className="dsp-param-value">{band.gainDb.toFixed(1)} dB</span>
                </div>
              ))}
            </div>
          )}

          {node.type === 'vst' && (
            <div className="dsp-node-body">
              <div className="dsp-node-plugin">
                <span>{t('pages.dsp-rack.vst.pluginId')}</span>
                <strong title={readStringField(node, 'pluginId') ?? undefined}>
                  {readStringField(node, 'pluginId') ?? '(none)'}
                </strong>
              </div>
              <VstNodeParamsPanel
                nodeId={node.id}
                pluginId={readStringField(node, 'pluginId') ?? ''}
                params={ensureVstParamValues(asRecord(node)?.params)}
              />
              <div className="dsp-rack-note">{t('pages.dsp-rack.note.vstAddHint')}</div>
            </div>
          )}
        </div>
      );
    },
    [
      busy,
      highlightNodeId,
      moveNode,
      nodes,
      removeNode,
      t,
      updateNode,
      vstStatuses,
    ]
  );

  if (!isTauri) {
    return (
      <div className="dsp-rack-page">
        <h2 className="dsp-rack-title">{t('pages.dsp-rack.title')}</h2>
        <p className="dsp-rack-note">{t('pages.dsp-rack.note.requiresTauri')}</p>
      </div>
    );
  }

  if (!isNativeAvailable) {
    return (
      <div className="dsp-rack-page">
        <div className="dsp-rack-header">
          <div>
            <h2 className="dsp-rack-title">{t('pages.dsp-rack.title')}</h2>
            <p className="dsp-rack-note">{t('pages.dsp-rack.note.nativeUnavailable')}</p>
            <p className="dsp-rack-note">{t('pages.dsp-rack.note.vstAddHint')}</p>
          </div>

          <div className="dsp-rack-actions">
            <button type="button" onClick={() => void handleOpenVstManager()}>
              {t('pages.dsp-rack.actions.openVstManager')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dsp-rack-page">
      <div className="dsp-rack-header">
        <div>
          <h2 className="dsp-rack-title">{t('pages.dsp-rack.title')}</h2>
          <p className="dsp-rack-note">{t('pages.dsp-rack.subtitle')}</p>
        </div>

        <div className="dsp-rack-actions">
          <button type="button" onClick={() => void handleOpenVstManager()} disabled={busy}>
            {t('pages.dsp-rack.actions.openVstManager')}
          </button>
          <button
            type="button"
            onClick={() =>
              void invokeDspRack<number>(
                'native_audio_vst_bring_editors_to_front',
                undefined,
                'vst.editor.bring-to-front'
              ).catch((err) => setError(err instanceof Error ? err.message : String(err)))
            }
            disabled={busy}
          >
            {t('pages.dsp-rack.actions.bringVstEditors')}
          </button>
          <button type="button" onClick={() => void refresh()} disabled={busy}>
            {t('pages.dsp-rack.actions.refresh')}
          </button>
        </div>
      </div>

      {error && <div className="dsp-rack-error">{error}</div>}

      {!graph && <div className="dsp-rack-loading">{t('pages.dsp-rack.loading')}</div>}

      {graph && (
        <>
          <div className="dsp-rack-tabs" role="tablist" aria-label={t('pages.dsp-rack.tabs.ariaLabel')}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`dsp-rack-tab${activeTab === tab.id ? ' dsp-rack-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                <span className="dsp-rack-tab-count">{tab.count}</span>
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="dsp-overview">
              <section className="dsp-overview-section" aria-labelledby="dsp-overview-summary-title">
                <div className="dsp-section-heading">
                  <h3 id="dsp-overview-summary-title">{t('pages.dsp-rack.overview.summary.title')}</h3>
                  <p>{t('pages.dsp-rack.overview.summary.note')}</p>
                </div>
                <div className="dsp-metric-grid">
                  <div className="dsp-metric">
                    <span className="dsp-metric-label">{t('pages.dsp-rack.overview.metric.nodes')}</span>
                    <strong>{graphSummary.enabledCount}</strong>
                    <span>{t('pages.dsp-rack.overview.metric.bypassed', { count: graphSummary.bypassedCount })}</span>
                  </div>
                  <div className="dsp-metric">
                    <span className="dsp-metric-label">{t('pages.dsp-rack.overview.metric.gain')}</span>
                    <strong>{formatDbValue(graphSummary.totalGainDb)}</strong>
                    <span>{t('pages.dsp-rack.overview.metric.gainHint')}</span>
                  </div>
                  <div className="dsp-metric">
                    <span className="dsp-metric-label">{t('pages.dsp-rack.overview.metric.pitch')}</span>
                    <strong>{formatSigned(graphSummary.pitchSemitones)} st</strong>
                    <span>{t('pages.dsp-rack.overview.metric.tempo', { rate: graphSummary.tempoRate.toFixed(2) })}</span>
                  </div>
                  <div className="dsp-metric">
                    <span className="dsp-metric-label">{t('pages.dsp-rack.overview.metric.vst')}</span>
                    <strong>
                      {graphSummary.vstActiveCount}/{graphSummary.vstEnabledCount}
                    </strong>
                    <span>{t('pages.dsp-rack.overview.metric.vstProblems', { count: graphSummary.vstProblemCount })}</span>
                  </div>
                </div>
              </section>

              <section className="dsp-overview-section" aria-labelledby="dsp-overview-spectrum-title">
                <div className="dsp-section-heading">
                  <h3 id="dsp-overview-spectrum-title">{t('pages.dsp-rack.overview.spectrum.title')}</h3>
                  <p>{t('pages.dsp-rack.overview.spectrum.note')}</p>
                </div>
                {!hasSpectrumFrames && (
                  <div className="dsp-rack-empty">{t('pages.dsp-rack.overview.spectrum.empty')}</div>
                )}
                {hasSpectrumFrames && (
                  <div className="dsp-spectrum-grid">
                    {spectrumRows.map((metric) => (
                      <div key={metric.key} className="dsp-spectrum-row">
                        <div className="dsp-spectrum-label">{metric.label}</div>
                        <div className="dsp-spectrum-bars" aria-hidden="true">
                          <span className="dsp-spectrum-bar dsp-spectrum-bar--pre" style={{ width: `${metric.preBar}%` }} />
                          <span className="dsp-spectrum-bar dsp-spectrum-bar--post" style={{ width: `${metric.postBar}%` }} />
                        </div>
                        <div className="dsp-spectrum-values">
                          <span>
                            {t('pages.dsp-rack.overview.spectrum.pre')}{' '}
                            {metric.mode === 'db'
                              ? formatDbValue(metric.pre)
                              : metric.pre === null
                                ? '--'
                                : metric.pre.toFixed(0)}
                          </span>
                          <span>
                            {t('pages.dsp-rack.overview.spectrum.post')}{' '}
                            {metric.mode === 'db'
                              ? formatDbValue(metric.post)
                              : metric.post === null
                                ? '--'
                                : metric.post.toFixed(0)}
                          </span>
                          <strong>
                            {t('pages.dsp-rack.overview.spectrum.delta')}{' '}
                            {metric.mode === 'db'
                              ? formatDbValue(metric.delta)
                              : formatDeltaValue(metric.delta, 0)}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab !== 'overview' && (
            <div className="dsp-rack-workspace">
              {activeTab === 'tone' && (
                <div className="dsp-rack-add-strip">
                  <button type="button" onClick={() => addNode('gain')} disabled={!graph || busy}>
                    {t('pages.dsp-rack.actions.addGain')}
                  </button>
                  <button type="button" onClick={() => addNode('eq')} disabled={!graph || busy}>
                    {t('pages.dsp-rack.actions.addEq')}
                  </button>
                  <button type="button" onClick={() => addNode('limiter')} disabled={!graph || busy}>
                    {t('pages.dsp-rack.actions.addLimiter')}
                  </button>
                </div>
              )}

              {activeTab === 'transform' && (
                <div className="dsp-rack-add-strip">
                  <button type="button" onClick={() => addNode('pitch-shift')} disabled={!graph || busy}>
                    {t('pages.dsp-rack.actions.addPitchShift')}
                  </button>
                  <button type="button" onClick={() => addNode('tempo')} disabled={!graph || busy}>
                    {t('pages.dsp-rack.actions.addTempo')}
                  </button>
                </div>
              )}

              {activeTab === 'vst' && (
                <div className="dsp-rack-add-strip">
                  <button type="button" onClick={() => void handleOpenVstManager()} disabled={busy}>
                    {t('pages.dsp-rack.actions.openVstManager')}
                  </button>
                  <span className="dsp-rack-add-hint">{t('pages.dsp-rack.note.vstAddHint')}</span>
                </div>
              )}

              {activeTab === 'chain' && hasOtherNodes(nodes) && (
                <div className="dsp-rack-chain-note">{t('pages.dsp-rack.chain.unknownNodes')}</div>
              )}

              <div className="dsp-rack-list">
                {visibleNodes.length === 0 && (
                  <div className="dsp-rack-empty">
                    {activeTab === 'chain'
                      ? t('pages.dsp-rack.empty.graph')
                      : t('pages.dsp-rack.empty.category')}
                  </div>
                )}
                {visibleNodes.map((node) => renderNodeCard(node))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
