import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readData, STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, setupDualListener } from '../../utils/windowCommunication';
import { openVstManagerWindow } from '../../utils/vstManagerWindows';
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
type VstNode = DspNodeBase & { type: 'vst'; pluginId: string; params?: VstParamValue[] };
type DspNode = GainNode | EqNode | LimiterNode | VstNode | (DspNodeBase & Record<string, unknown>);

type DspGraphConfig = { nodes: DspNode[] };

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

function ensureDspGraphConfig(value: unknown): DspGraphConfig {
  const record = asRecord(value);
  if (!record) return { nodes: [] };
  const nodes = record.nodes;
  return { nodes: Array.isArray(nodes) ? (nodes as DspNode[]) : [] };
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

export const DspRackPage: React.FC = () => {
  const { engineType, isNativeAvailable } = useAudioEngine();
  const isTauri = React.useMemo(() => isTauriRuntime(), []);
  const [graph, setGraph] = React.useState<DspGraphConfig | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [highlightNodeId, setHighlightNodeId] = React.useState<string | null>(null);
  const lastLocateRequestIdRef = React.useRef<string | null>(null);
  const clearHighlightTimerRef = React.useRef<number | null>(null);

  const refresh = React.useCallback(async () => {
    if (!isTauri) return;
    setBusy(true);
    setError(null);
    try {
      const graphResp = await invoke<DspGraphConfig>('native_audio_get_dsp_graph');
      const nextGraph = graphResp && typeof graphResp === 'object' ? graphResp : { nodes: [] };
      setGraph(nextGraph);
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
  }, [isTauri, refresh]);

  React.useEffect(() => {
    if (!isTauri) return;

    const handleLocate = () => {
      const payload = readData<unknown>(STORAGE_KEYS.DSP_RACK_LOCATE_NODE);
      const requestId = readStringField(payload, 'requestId') ?? readStringField(payload, 'id');
      const nodeId = readStringField(payload, 'nodeId');
      if (!requestId || !nodeId) return;
      if (lastLocateRequestIdRef.current === requestId) return;
      lastLocateRequestIdRef.current = requestId;

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
  }, [isTauri]);

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
        await invoke('native_audio_set_dsp_graph', { graph: next });
      } catch (err) {
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
    (type: 'gain' | 'eq' | 'limiter') => {
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
      }
      void applyGraph({ nodes: [...graph.nodes, node] });
    },
    [applyGraph, graph]
  );

  if (!isTauri) {
    return (
      <div className="dsp-rack-page">
        <h2 className="dsp-rack-title">DSP Rack</h2>
        <p className="dsp-rack-note">DSP Rack / VST3 插件管理器需要在 Tauri 桌面运行（`pnpm dev:tauri`）。</p>
      </div>
    );
  }

  if (!isNativeAvailable || engineType !== 'native') {
    return (
      <div className="dsp-rack-page">
        <div className="dsp-rack-header">
          <div>
            <h2 className="dsp-rack-title">DSP Rack</h2>
            <p className="dsp-rack-note">当前为 Web Audio 模式；切换到 Native Audio 后才会应用 DSP Graph。</p>
            <p className="dsp-rack-note">添加 VST：打开「VST3 插件管理器」→ 扫描 → 选中插件 → 添加到 DSP Rack。</p>
          </div>

          <div className="dsp-rack-actions">
            <button type="button" onClick={() => void openVstManagerWindow()}>
              VST3 插件管理器
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
          <h2 className="dsp-rack-title">DSP Rack</h2>
          <p className="dsp-rack-note">管理 Native Audio 的 DSP Graph（含 VST Bridge MVP）。</p>
        </div>

        <div className="dsp-rack-actions">
          <button type="button" onClick={() => addNode('gain')} disabled={!graph || busy}>
            + Gain
          </button>
          <button type="button" onClick={() => addNode('eq')} disabled={!graph || busy}>
            + EQ
          </button>
          <button type="button" onClick={() => addNode('limiter')} disabled={!graph || busy}>
            + Limiter
          </button>
          <button type="button" onClick={() => void openVstManagerWindow()} disabled={busy}>
            VST3 插件管理器
          </button>
          <button type="button" onClick={() => void refresh()} disabled={busy}>
            刷新
          </button>
        </div>
      </div>

      {error && <div className="dsp-rack-error">{error}</div>}

      {!graph && <div className="dsp-rack-loading">Loading...</div>}

      {graph && (
        <div className="dsp-rack-list">
          {graph.nodes.length === 0 && <div className="dsp-rack-empty">当前 DSP Graph 为空。</div>}

          {graph.nodes.map((node, index) => (
            <div
              key={node.id}
              id={`dsp-node-${node.id}`}
              className={`dsp-node-card${node.id === highlightNodeId ? ' dsp-node-card--highlight' : ''}`}
            >
              <div className="dsp-node-header">
                <div className="dsp-node-title">
                  <span className="dsp-node-type">{node.type}</span>
                  <span className="dsp-node-id">{node.id}</span>
                </div>

                <div className="dsp-node-controls">
                  <label className="dsp-node-toggle">
                    <input
                      type="checkbox"
                      checked={!!node.enabled}
                      onChange={(e) =>
                        updateNode(node.id, (n) => ({
                          ...n,
                          enabled: e.target.checked,
                        }))
                      }
                    />
                    启用
                  </label>

                  {node.type === 'vst' && (
                    <button
                      type="button"
                      title={node.enabled ? '打开插件原生界面' : '请先勾选“启用”该节点，再打开 Native UI'}
                      onClick={() =>
                        void invoke('native_audio_vst_open_native_editor', {
                          nodeId: node.id,
                          title: `VST3 (${readStringField(node, 'pluginId') ?? 'vst'})`,
                        }).catch((err) => setError(err instanceof Error ? err.message : String(err)))
                      }
                      disabled={busy || !node.enabled || !(readStringField(node, 'pluginId') ?? '').trim()}
                    >
                      Native UI
                    </button>
                  )}

                  {node.type === 'vst' && (
                    <button
                      type="button"
                      onClick={() =>
                        void invoke('native_audio_vst_close_native_editor', { nodeId: node.id }).catch((err) =>
                          setError(err instanceof Error ? err.message : String(err))
                        )
                      }
                      disabled={busy}
                    >
                      关闭 UI
                    </button>
                  )}

                  <button type="button" onClick={() => moveNode(node.id, -1)} disabled={index === 0 || busy}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveNode(node.id, 1)}
                    disabled={index === graph.nodes.length - 1 || busy}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => removeNode(node.id)} disabled={busy}>
                    删除
                  </button>
                </div>
              </div>

              {node.type === 'gain' && (
                <div className="dsp-node-body">
                  <div className="dsp-param-row">
                    <span className="dsp-param-label">Gain (dB)</span>
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
                    <span className="dsp-param-label">Threshold (dB)</span>
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

              {node.type === 'eq' && (
                <div className="dsp-node-body">
                  {ensureEqBands(asRecord(node)?.bands).map((band, bandIndex) => (
                    <div key={`${band.kind}-${band.frequencyHz}-${bandIndex}`} className="dsp-param-row">
                      <span className="dsp-param-label">
                        {band.kind} {Math.round(band.frequencyHz)}Hz
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
                  <div className="dsp-rack-note">
                    PluginId: <span style={{ opacity: 0.9 }}>{readStringField(node, 'pluginId') ?? '(none)'}</span>
                  </div>
                  <div className="dsp-rack-note">
                    提示：请在「VST3 插件管理器」中选中插件并点击“添加到 DSP Rack”添加（当前不支持拖拽）。
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
