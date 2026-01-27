import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useT } from '../../i18n';
import './VstNodeParamsPanel.css';

type VstParamValue = {
  key: string;
  value: number;
};

type ParamDescriptor = {
  key: string;
  title: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit?: string | null;
};

type PluginDescriptor = {
  id: string;
  name: string;
  vendor?: string | null;
  version?: string | null;
  path?: string | null;
  inputChannels?: number | null;
  outputChannels?: number | null;
  parameters: ParamDescriptor[];
};

type VstPresetSummary = {
  id: string;
  name: string;
  createdAtMs: number;
  paramsCount: number;
};

type Props = {
  nodeId: string;
  pluginId: string;
  params?: VstParamValue[] | null;
};

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
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
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function ensureParamDescriptor(value: unknown): ParamDescriptor | null {
  const record = asRecord(value);
  if (!record) return null;
  const key = readStringField(record, 'key');
  const title = readStringField(record, 'title') ?? key ?? '';
  if (!key) return null;
  return {
    key,
    title,
    min: readNumberField(record, 'min') ?? 0,
    max: readNumberField(record, 'max') ?? 1,
    default: readNumberField(record, 'default') ?? 0,
    step: readNumberField(record, 'step') ?? 0,
    unit: readStringField(record, 'unit'),
  };
}

function ensureParamDescriptors(value: unknown): ParamDescriptor[] {
  if (!Array.isArray(value)) return [];
  const out: ParamDescriptor[] = [];
  for (const entry of value) {
    const param = ensureParamDescriptor(entry);
    if (param) out.push(param);
  }
  return out;
}

function ensurePluginDescriptor(value: unknown): PluginDescriptor | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readStringField(record, 'id');
  const name = readStringField(record, 'name') ?? id ?? '';
  if (!id) return null;
  return {
    id,
    name,
    vendor: readStringField(record, 'vendor'),
    version: readStringField(record, 'version'),
    path: readStringField(record, 'path'),
    inputChannels: readNumberField(record, 'inputChannels'),
    outputChannels: readNumberField(record, 'outputChannels'),
    parameters: ensureParamDescriptors(record.parameters),
  };
}

function ensurePresetSummary(value: unknown): VstPresetSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = readStringField(record, 'id');
  const name = readStringField(record, 'name');
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAtMs: readNumberField(record, 'createdAtMs') ?? 0,
    paramsCount: readNumberField(record, 'paramsCount') ?? 0,
  };
}

function ensurePresetSummaries(value: unknown): VstPresetSummary[] {
  if (!Array.isArray(value)) return [];
  const out: VstPresetSummary[] = [];
  for (const entry of value) {
    const preset = ensurePresetSummary(entry);
    if (preset) out.push(preset);
  }
  return out;
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string') as string[];
}

function ensureVstParamValues(value: unknown): VstParamValue[] {
  if (!Array.isArray(value)) return [];
  const out: VstParamValue[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const key = readStringField(record, 'key');
    const valueNum = readNumberField(record, 'value');
    if (!key || valueNum === null) continue;
    out.push({ key, value: valueNum });
  }
  return out;
}

function mapParamsToValues(params: VstParamValue[]) {
  const next: Record<string, number> = {};
  for (const entry of params) {
    const key = entry.key.trim();
    if (!key) continue;
    if (!Number.isFinite(entry.value)) continue;
    next[key] = entry.value;
  }
  return next;
}

function splitGroupTitle(title: string): { group: string | null; label: string } {
  const trimmed = title.trim();
  const idx = trimmed.indexOf('/');
  if (idx <= 0) return { group: null, label: trimmed };
  const group = trimmed.slice(0, idx).trim();
  const rest = trimmed.slice(idx + 1).trim();
  return { group: group || null, label: rest || trimmed };
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function computeStep(descriptor: ParamDescriptor) {
  const raw = descriptor.step;
  if (Number.isFinite(raw) && raw > 0) return raw;
  const span = descriptor.max - descriptor.min;
  if (!Number.isFinite(span) || span <= 0) return 0.001;
  return Math.max(span / 128, 0.000_001);
}

export function VstNodeParamsPanel({ nodeId, pluginId, params }: Props) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [descriptors, setDescriptors] = React.useState<ParamDescriptor[]>([]);
  const [presets, setPresets] = React.useState<VstPresetSummary[]>([]);
  const [lockedKeys, setLockedKeys] = React.useState<Set<string>>(new Set());
  const [presetName, setPresetName] = React.useState('');
  const [valuesByKey, setValuesByKey] = React.useState<Record<string, number>>({});

  const timersRef = React.useRef<Map<string, number>>(new Map());

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timeoutId of timers.values()) {
        window.clearTimeout(timeoutId);
      }
      timers.clear();
    };
  }, []);

  React.useEffect(() => {
    setValuesByKey(mapParamsToValues(params ?? []));
  }, [nodeId, pluginId, params]);

  const normalizedPluginId = pluginId.trim();

  const refreshAuxState = React.useCallback(async () => {
    if (!normalizedPluginId) return;
    setLoading(true);
    setError(null);
    try {
      const [lockedRaw, presetsRaw, paramsRaw] = await Promise.all([
        invoke<unknown>('native_audio_vst_get_locked_params', { nodeId }),
        invoke<unknown>('native_audio_vst_list_presets', { pluginId: normalizedPluginId }),
        invoke<unknown>('native_audio_vst_library_get_plugin_params', { pluginId: normalizedPluginId }),
      ]);

      const lockedList = ensureStringArray(lockedRaw);
      setLockedKeys(new Set(lockedList.map((k) => k.trim()).filter((k) => k)));
      setPresets(ensurePresetSummaries(presetsRaw));

      const list = ensureParamDescriptors(paramsRaw);
      if (list.length > 0) {
        setDescriptors(list);
        return;
      }

      const describeResp = await invoke<unknown>('native_audio_vst_describe_plugin', {
        pluginId: normalizedPluginId,
      });
      const descriptor = ensurePluginDescriptor(describeResp);
      setDescriptors(descriptor?.parameters ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDescriptors([]);
    } finally {
      setLoading(false);
    }
  }, [nodeId, normalizedPluginId]);

  React.useEffect(() => {
    if (!open) return;
    void refreshAuxState();
  }, [open, refreshAuxState]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredDescriptors = React.useMemo(() => {
    if (!normalizedQuery) return descriptors;
    return descriptors.filter(
      (param) =>
        param.key.toLowerCase().includes(normalizedQuery) ||
        param.title.toLowerCase().includes(normalizedQuery)
    );
  }, [descriptors, normalizedQuery]);

  const grouped = React.useMemo(() => {
    const groups = new Map<string, ParamDescriptor[]>();
    const ungrouped: ParamDescriptor[] = [];
    for (const param of filteredDescriptors) {
      const { group } = splitGroupTitle(param.title);
      if (!group) {
        ungrouped.push(param);
        continue;
      }
      const list = groups.get(group) ?? [];
      list.push(param);
      groups.set(group, list);
    }

    const entries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const out: Array<{ title: string; items: ParamDescriptor[] }> = entries.map(([title, items]) => ({
      title,
      items: items.sort((a, b) => a.title.localeCompare(b.title)),
    }));
    if (ungrouped.length > 0) {
      out.push({
        title: t('pages.dsp-rack.vst.params.group.ungrouped'),
        items: ungrouped.sort((a, b) => a.title.localeCompare(b.title)),
      });
    }
    return out;
  }, [filteredDescriptors, t]);

  const setParamLocked = React.useCallback(
    async (key: string, locked: boolean) => {
      setError(null);
      try {
        await invoke('native_audio_vst_set_param_locked', { nodeId, key, locked });
        setLockedKeys((prev) => {
          const next = new Set(prev);
          if (locked) next.add(key);
          else next.delete(key);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [nodeId]
  );

  const scheduleParamUpdate = React.useCallback(
    (key: string, value: number) => {
      const prev = timersRef.current.get(key);
      if (prev !== undefined) window.clearTimeout(prev);

      const timeoutId = window.setTimeout(() => {
        timersRef.current.delete(key);
        void invoke('native_audio_vst_set_param_value', { nodeId, key, value }).catch(() => {});
      }, 90);
      timersRef.current.set(key, timeoutId);
    },
    [nodeId]
  );

  const setParamValue = React.useCallback(
    (descriptor: ParamDescriptor, value: number) => {
      const clamped = clamp(value, descriptor.min, descriptor.max);
      setValuesByKey((prev) => ({ ...prev, [descriptor.key]: clamped }));
      scheduleParamUpdate(descriptor.key, clamped);
    },
    [scheduleParamUpdate]
  );

  const savePreset = React.useCallback(async () => {
    const name = presetName.trim();
    if (!name || !normalizedPluginId) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<unknown>('native_audio_vst_save_preset', { nodeId, name });
      const saved = ensurePresetSummary(resp);
      setPresetName('');
      if (saved) {
        setPresets((prev) => [saved, ...prev.filter((p) => p.id !== saved.id)]);
      } else {
        await refreshAuxState();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [nodeId, normalizedPluginId, presetName, refreshAuxState]);

  const deletePreset = React.useCallback(
    async (presetId: string) => {
      if (!normalizedPluginId) return;
      setLoading(true);
      setError(null);
      try {
        await invoke('native_audio_vst_delete_preset', { pluginId: normalizedPluginId, presetId });
        setPresets((prev) => prev.filter((p) => p.id !== presetId));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [normalizedPluginId]
  );

  const applyPreset = React.useCallback(
    async (presetId: string) => {
      setLoading(true);
      setError(null);
      try {
        await invoke('native_audio_vst_apply_preset', { nodeId, presetId });
        try {
          const graphResp = await invoke<unknown>('native_audio_get_dsp_graph');
          const graph = asRecord(graphResp);
          const nodes = Array.isArray(graph?.nodes) ? graph?.nodes : [];
          const match = nodes.find((node) => readStringField(node, 'id') === nodeId);
          const paramsFromGraph = ensureVstParamValues(asRecord(match)?.params);
          setValuesByKey(mapParamsToValues(paramsFromGraph));
        } catch {
          // ignore
        }
        await refreshAuxState();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [nodeId, refreshAuxState]
  );

  if (!normalizedPluginId) {
    return null;
  }

  return (
    <div className="vst-node-params-panel">
      <div className="vst-node-params-header">
        <button
          type="button"
          className="vst-node-params-toggle"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? t('pages.dsp-rack.vst.params.toggle.hide') : t('pages.dsp-rack.vst.params.toggle.show')}
        </button>
        <div className="vst-node-params-meta">{normalizedPluginId}</div>
        {open ? (
          <button type="button" className="vst-node-params-refresh" onClick={() => void refreshAuxState()}>
            {t('pages.dsp-rack.vst.params.action.refresh')}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="vst-node-params-body">
          {error ? <div className="vst-node-params-error">{error}</div> : null}

          <div className="vst-node-presets">
            <div className="vst-node-presets-title">{t('pages.dsp-rack.vst.presets.title')}</div>
            <div className="vst-node-presets-row">
              <input
                className="vst-node-presets-input"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('pages.dsp-rack.vst.presets.name.placeholder')}
                aria-label={t('pages.dsp-rack.vst.presets.name.ariaLabel')}
              />
              <button type="button" onClick={() => void savePreset()} disabled={loading || !presetName.trim()}>
                {t('pages.dsp-rack.vst.presets.action.save')}
              </button>
            </div>
            {presets.length === 0 ? (
              <div className="vst-node-presets-empty">{t('pages.dsp-rack.vst.presets.empty')}</div>
            ) : (
              <div className="vst-node-presets-list" role="list">
                {presets.slice(0, 40).map((preset) => (
                  <div key={preset.id} className="vst-node-preset-row" role="listitem">
                    <div className="vst-node-preset-name" title={preset.name}>
                      {preset.name}
                      <span className="vst-node-preset-count">
                        {t('pages.dsp-rack.vst.presets.paramsCount', { count: preset.paramsCount })}
                      </span>
                    </div>
                    <div className="vst-node-preset-actions">
                      <button type="button" onClick={() => void applyPreset(preset.id)} disabled={loading}>
                        {t('pages.dsp-rack.vst.presets.action.apply')}
                      </button>
                      <button type="button" onClick={() => void deletePreset(preset.id)} disabled={loading}>
                        {t('pages.dsp-rack.vst.presets.action.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="vst-node-params-controls">
            <input
              className="vst-node-params-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('pages.dsp-rack.vst.params.search.placeholder')}
              aria-label={t('pages.dsp-rack.vst.params.search.ariaLabel')}
            />
            <div className="vst-node-params-count">
              {t('pages.dsp-rack.vst.params.count', { count: filteredDescriptors.length })}
            </div>
          </div>

          {loading ? <div className="vst-node-params-loading">{t('pages.dsp-rack.vst.params.loading')}</div> : null}

          {filteredDescriptors.length === 0 && !loading ? (
            <div className="vst-node-params-empty">{t('pages.dsp-rack.vst.params.empty')}</div>
          ) : (
            <div className="vst-node-params-groups">
              {grouped.map((group) => (
                <div key={group.title} className="vst-node-params-group">
                  <div className="vst-node-params-group-title">{group.title}</div>
                  <div className="vst-node-params-list">
                    {group.items.slice(0, 256).map((param) => {
                      const current = valuesByKey[param.key] ?? param.default;
                      const step = computeStep(param);
                      const { label } = splitGroupTitle(param.title);
                      const locked = lockedKeys.has(param.key);
                      return (
                        <div key={param.key} className="vst-node-param-row">
                          <div className="vst-node-param-head">
                            <div className="vst-node-param-title" title={param.title}>
                              <span className="vst-node-param-key">{param.key}</span>
                              <span className="vst-node-param-label">{label || param.key}</span>
                            </div>
                            <label className="vst-node-param-lock">
                              <input
                                type="checkbox"
                                checked={locked}
                                onChange={(e) => void setParamLocked(param.key, e.target.checked)}
                                disabled={loading}
                              />
                              <span>{t('pages.dsp-rack.vst.params.lock.label')}</span>
                            </label>
                          </div>
                          <div className="vst-node-param-controls">
                            <input
                              className="vst-node-param-range"
                              type="range"
                              min={param.min}
                              max={param.max}
                              step={step}
                              value={clamp(current, param.min, param.max)}
                              onChange={(e) => setParamValue(param, Number(e.target.value))}
                              disabled={locked || loading}
                            />
                            <input
                              className="vst-node-param-number"
                              type="number"
                              value={formatNumber(clamp(current, param.min, param.max))}
                              min={param.min}
                              max={param.max}
                              step={step}
                              onChange={(e) => setParamValue(param, Number(e.target.value))}
                              disabled={locked || loading}
                            />
                            {param.unit ? <div className="vst-node-param-unit">{param.unit}</div> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
