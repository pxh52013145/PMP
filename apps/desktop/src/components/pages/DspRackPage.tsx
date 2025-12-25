import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';
import { openVstEditorWindow } from '../../utils/vstWindows';
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

type BridgeParamDescriptor = {
  key: string;
  title: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string | null;
};

type BridgePluginDescriptor = {
  id: string;
  name: string;
  vendor?: string | null;
  version?: string | null;
  path?: string | null;
  parameters: BridgeParamDescriptor[];
};

type VstDisabledPlugin = {
  pluginId: string;
  nodeId?: string | null;
  disabledAtMs: number;
  reason: string;
  failures?: number | null;
};

type VstGovernanceState = {
  version: number;
  disabledPlugins: VstDisabledPlugin[];
};

type VstAuditEvent = {
  atMs: number;
  kind: string;
  nodeId?: string | null;
  pluginId?: string | null;
  message: string;
};

type VstAuditLog = {
  version: number;
  events: VstAuditEvent[];
  lastScan?: {
    atMs: number;
    plugins: Array<{
      id: string;
      name: string;
      vendor?: string | null;
      version?: string | null;
      path?: string | null;
    }>;
  } | null;
};

function mergePlugins(prev: BridgePluginDescriptor[], incoming: BridgePluginDescriptor[]) {
  const prevById = new Map(prev.map((plugin) => [plugin.id, plugin]));
  return incoming.map((plugin) => {
    const existing = prevById.get(plugin.id);
    if (existing && existing.parameters.length > 0 && plugin.parameters.length === 0) {
      return { ...plugin, parameters: existing.parameters };
    }
    return plugin;
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

function ensureVstParamValues(value: unknown): VstParamValue[] {
  if (!Array.isArray(value)) return [];
  const out: VstParamValue[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = record.key;
    if (typeof key !== 'string') continue;
    const num = ensureNumber(record.value, Number.NaN);
    if (!isFinite(num)) continue;
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

export const DspRackPage: React.FC = () => {
  const { engineType, isNativeAvailable } = useAudioEngine();
  const isTauri = React.useMemo(() => isTauriRuntime(), []);
  const [graph, setGraph] = React.useState<DspGraphConfig | null>(null);
  const [plugins, setPlugins] = React.useState<BridgePluginDescriptor[]>([]);
  const [governance, setGovernance] = React.useState<VstGovernanceState | null>(null);
  const [auditLog, setAuditLog] = React.useState<VstAuditLog | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [pluginsBusy, setPluginsBusy] = React.useState(false);
  const [describing, setDescribing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const describingRef = React.useRef<Set<string>>(new Set());
  const describedOkRef = React.useRef<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    if (!isTauri) return;
    setBusy(true);
    setError(null);
    try {
      const [graphResp, governanceResp, auditResp] = await Promise.all([
        invoke<DspGraphConfig>('native_audio_get_dsp_graph'),
        invoke<VstGovernanceState>('native_audio_vst_get_governance').catch(() => null),
        invoke<VstAuditLog>('native_audio_vst_get_audit_log').catch(() => null),
      ]);
      setGraph(graphResp && typeof graphResp === 'object' ? graphResp : { nodes: [] });
      setGovernance(governanceResp && typeof governanceResp === 'object' ? governanceResp : null);
      const nextAudit = auditResp && typeof auditResp === 'object' ? auditResp : null;
      setAuditLog(nextAudit);
      if (nextAudit?.lastScan?.plugins?.length) {
        const snapshot = nextAudit.lastScan.plugins.map((plugin) => ({
          ...plugin,
          parameters: [],
        }));
        setPlugins((prev) => mergePlugins(prev, snapshot));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [isTauri]);

  const scanPlugins = React.useCallback(async () => {
    if (!isTauri) return;
    setPluginsBusy(true);
    setError(null);
    try {
      const pluginResp = await invoke<BridgePluginDescriptor[]>('native_audio_vst_list_plugins').catch(
        () => [] as BridgePluginDescriptor[]
      );
      const next = Array.isArray(pluginResp) ? pluginResp : [];
      setPlugins((prev) => mergePlugins(prev, next));
      const auditResp = await invoke<VstAuditLog>('native_audio_vst_get_audit_log').catch(() => null);
      setAuditLog(auditResp && typeof auditResp === 'object' ? auditResp : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPluginsBusy(false);
    }
  }, [isTauri]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const describePlugin = React.useCallback(
    async (pluginId: string) => {
      if (!isTauri) return;
      if (!pluginId) return;
      if (describingRef.current.has(pluginId)) return;
      if (describedOkRef.current.has(pluginId)) return;
      describingRef.current.add(pluginId);

      setDescribing(pluginId);
      setError(null);
      try {
        const desc = await invoke<BridgePluginDescriptor>('native_audio_vst_describe_plugin', { pluginId });
        setPlugins((prev) => prev.map((p) => (p.id === pluginId ? desc : p)));
        describedOkRef.current.add(pluginId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        describingRef.current.delete(pluginId);
        setDescribing((current) => (current === pluginId ? null : current));
      }
    },
    [isTauri]
  );

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
    (type: 'gain' | 'eq' | 'limiter' | 'vst') => {
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
        case 'vst': {
          const fallback = (plugins[0]?.id ?? '').trim();
          node = {
            id,
            enabled: Boolean(fallback),
            type: 'vst',
            pluginId: fallback,
            params: [],
          };
          break;
        }
      }
      void applyGraph({ nodes: [...graph.nodes, node] });
    },
    [applyGraph, graph, plugins]
  );

  const enablePlugin = React.useCallback(
    async (pluginId: string) => {
      if (!isTauri) return;
      if (!pluginId) return;
      setError(null);
      setBusy(true);
      try {
        await invoke('native_audio_vst_enable_plugin', { pluginId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [isTauri, refresh]
  );

  const clearAuditLog = React.useCallback(async () => {
    if (!isTauri) return;
    setError(null);
    setBusy(true);
    try {
      await invoke('native_audio_vst_clear_audit_log');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [isTauri, refresh]);

  if (!isTauri) {
    return (
        <div className="dsp-rack-page">
          <h2 className="dsp-rack-title">DSP Rack</h2>
          <p className="dsp-rack-note">
          DSP Rack 需要在 Tauri 桌面运行时使用（`pnpm dev`）。
        </p>
      </div>
    );
  }

  if (!isNativeAvailable || engineType !== 'native') {
    return (
      <div className="dsp-rack-page">
        <h2 className="dsp-rack-title">DSP Rack</h2>
        <p className="dsp-rack-note">请先切换到 Native Audio 引擎后再管理 DSP。</p>
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
          <button type="button" onClick={() => addNode('vst')} disabled={!graph || busy}>
            + VST
          </button>
          <button type="button" onClick={() => void scanPlugins()} disabled={busy || pluginsBusy}>
            {pluginsBusy ? '扫描中…' : '扫描插件'}
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
          {governance?.disabledPlugins?.length ? (
            <div className="dsp-node-card">
              <div className="dsp-node-header">
                <div className="dsp-node-title">
                  <span className="dsp-node-type">VST Governance</span>
                  <span className="dsp-node-id">{governance.disabledPlugins.length} plugin(s) disabled</span>
                </div>

                <div className="dsp-node-controls">
                  <button type="button" onClick={() => void clearAuditLog()} disabled={busy}>
                    Clear Audit
                  </button>
                </div>
              </div>

              <div className="dsp-node-body">
                {governance.disabledPlugins.map((plugin) => (
                  <div key={plugin.pluginId} className="dsp-param-row">
                    <span className="dsp-param-label">{plugin.pluginId}</span>
                    <span className="dsp-param-label" style={{ opacity: 0.85 }}>
                      {plugin.reason}
                      {plugin.failures ? ` (failures=${plugin.failures})` : ''}
                    </span>
                    <button type="button" onClick={() => void enablePlugin(plugin.pluginId)} disabled={busy}>
                      Enable
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {auditLog?.events?.length ? (
            <div className="dsp-node-card">
              <div className="dsp-node-header">
                <div className="dsp-node-title">
                  <span className="dsp-node-type">VST Audit</span>
                  <span className="dsp-node-id">
                    latest {Math.min(20, auditLog.events.length)} event(s)
                    {auditLog.lastScan ? ` · lastScan=${auditLog.lastScan.plugins.length}` : ''}
                  </span>
                </div>

                <div className="dsp-node-controls">
                  <button type="button" onClick={() => void clearAuditLog()} disabled={busy}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="dsp-node-body">
                {auditLog.events
                  .slice(-20)
                  .reverse()
                  .map((event) => (
                    <div key={`${event.atMs}-${event.kind}-${event.nodeId ?? ''}`} className="dsp-rack-note">
                      {new Date(event.atMs).toLocaleString()} · {event.kind}
                      {event.pluginId ? ` · ${event.pluginId}` : ''}
                      {event.nodeId ? ` · ${event.nodeId}` : ''}
                      {event.message ? ` · ${event.message}` : ''}
                    </div>
                  ))}
              </div>
            </div>
          ) : null}

          {graph.nodes.length === 0 && <div className="dsp-rack-empty">当前 DSP Graph 为空。</div>}

          {graph.nodes.map((node, index) => (
            <div key={node.id} className="dsp-node-card">
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
                      onClick={() =>
                        void openVstEditorWindow({
                          nodeId: node.id,
                          title: `VST Editor (${readStringField(node, 'pluginId') ?? 'vst'})`,
                        })
                      }
                      disabled={busy || !(readStringField(node, 'pluginId') ?? '').trim()}
                    >
                      编辑
                    </button>
                  )}

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
                  <div className="dsp-param-row">
                    <span className="dsp-param-label">Plugin</span>
                    <select
                      className="dsp-param-select"
                      value={readStringField(node, 'pluginId') ?? ''}
                      onChange={(e) =>
                        updateNode(node.id, (n) => ({
                          ...n,
                          pluginId: e.target.value,
                          params: [],
                        }))
                      }
                    >
                      <option value="">{plugins.length === 0 ? '暂无插件（请先扫描）' : '请选择插件…'}</option>
                      {plugins.map((plugin) => (
                        <option key={plugin.id} value={plugin.id}>
                          {plugin.name} ({plugin.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  {(() => {
                    const pluginId = (readStringField(node, 'pluginId') ?? '').trim();
                    if (!pluginId) {
                      return <div className="dsp-rack-note">请先选择 VST3 插件（如未扫描，请点击“扫描插件”）。</div>;
                    }
                    const plugin = plugins.find((p) => p.id === pluginId);
                    if (!plugin) {
                      return <div className="dsp-rack-note">未找到插件描述（可能需要刷新）。</div>;
                    }

                    const currentParams = ensureVstParamValues(asRecord(node)?.params);

                    return (
                      <>
                        {plugin.parameters.length === 0 && (
                          <div className="dsp-rack-note">
                            {describing === pluginId ? 'Loading parameters…' : 'Parameters not loaded yet.'}{' '}
                            <button
                              type="button"
                              onClick={() => void describePlugin(pluginId)}
                              disabled={busy || describing === pluginId}
                            >
                              Load Params
                            </button>
                          </div>
                        )}
                        {plugin.parameters.map((param) => {
                          const current =
                            currentParams.find((p) => p.key === param.key)?.value ?? param.default;
                          return (
                            <div key={param.key} className="dsp-param-row">
                              <span className="dsp-param-label">{param.title}</span>
                              <input
                                className="dsp-param-range"
                                type="range"
                                min={param.min}
                                max={param.max}
                                step={param.step}
                                value={current}
                                onChange={(e) => {
                                  const value = clamp(Number(e.target.value), param.min, param.max);
                                  updateNode(node.id, (n) => {
                                    const nextParams = [...ensureVstParamValues(asRecord(n)?.params)];
                                    const idx = nextParams.findIndex((p) => p.key === param.key);
                                    if (idx >= 0) {
                                      nextParams[idx] = { ...nextParams[idx], value };
                                    } else {
                                      nextParams.push({ key: param.key, value });
                                    }
                                    return { ...n, params: nextParams };
                                  });
                                }}
                              />
                              <span className="dsp-param-value">
                                {current.toFixed(2)}{param.unit ? ` ${param.unit}` : ''}
                              </span>
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
