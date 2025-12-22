import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readData, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { openVstEditorWindow } from '../../utils/vstWindows';
import './DspVstMagnet.css';

type VstNodeSnapshot = {
  id: string;
  enabled: boolean;
  pluginId: string;
};

type DspGraphConfig = {
  nodes?: unknown[];
};

function pickVstNodes(graph: DspGraphConfig | null): VstNodeSnapshot[] {
  const nodes = Array.isArray(graph?.nodes) ? graph!.nodes : [];
  const out: VstNodeSnapshot[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (record.type !== 'vst') continue;
    const id = typeof record.id === 'string' ? record.id : '';
    const pluginId = typeof record.pluginId === 'string' ? record.pluginId : 'demo.gain';
    if (!id) continue;
    out.push({ id, enabled: typeof record.enabled === 'boolean' ? record.enabled : Boolean(record.enabled), pluginId });
  }
  return out;
}

export const DspVstMagnet: React.FC = () => {
  const [graph, setGraph] = useState<DspGraphConfig | null>(() => readData<DspGraphConfig>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH));

  const reload = useCallback(() => {
    setGraph(readData<DspGraphConfig>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH));
  }, []);

  useEffect(() => {
    let cleanup: null | (() => void) = null;
    reload();
    void setupDualListener([STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH], [TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED], reload).then(
      (fn) => {
        cleanup = fn;
      }
    );
    return () => cleanup?.();
  }, [reload]);

  const vstNodes = useMemo(() => pickVstNodes(graph), [graph]);
  const firstEnabled = vstNodes.find((n) => n.enabled) ?? vstNodes[0] ?? null;

  const label = useMemo(() => {
    if (!firstEnabled) return 'VST';
    const suffix = vstNodes.length > 1 ? `+${vstNodes.length - 1}` : '';
    return `${firstEnabled.pluginId}${suffix ? ` ${suffix}` : ''}`;
  }, [firstEnabled, vstNodes.length]);

  const handleOpen = useCallback(async () => {
    if (!isTauriRuntime()) return;
    if (!firstEnabled) return;
    await openVstEditorWindow({
      nodeId: firstEnabled.id,
      title: `VST Editor (${firstEnabled.pluginId})`,
    });
  }, [firstEnabled]);

  return (
    <button
      type="button"
      className="dsp-vst-magnet"
      onClick={() => void handleOpen()}
      disabled={!firstEnabled}
      title={
        firstEnabled
          ? `Open VST editor: ${firstEnabled.pluginId} (${firstEnabled.id})`
          : 'No VST node in DSP Graph'
      }
    >
      <span className="dsp-vst-magnet-label">{label}</span>
    </button>
  );
};
