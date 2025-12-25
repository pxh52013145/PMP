import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { readData, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { openVstEditorWindow } from '../../utils/vstWindows';
import { useNavigation } from '../../contexts/NavigationContext';
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
    const pluginId = typeof record.pluginId === 'string' ? record.pluginId : '';
    if (!id) continue;
    out.push({ id, enabled: typeof record.enabled === 'boolean' ? record.enabled : Boolean(record.enabled), pluginId });
  }
  return out;
}

export const DspVstMagnet: React.FC = () => {
  const navigation = useNavigation();
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
    const primary = firstEnabled.pluginId?.trim() ? firstEnabled.pluginId : 'VST';
    const suffix = vstNodes.length > 1 ? `+${vstNodes.length - 1}` : '';
    return `${primary}${suffix ? ` ${suffix}` : ''}`;
  }, [firstEnabled, vstNodes.length]);

  const handleOpenManager = useCallback(() => {
    navigation.navigateTo('vst-manager');
  }, [navigation]);

  const handleOpenEditor = useCallback(async () => {
    if (!isTauriRuntime()) return;
    if (!firstEnabled) return;
    const titleSuffix = firstEnabled.pluginId?.trim() ? ` (${firstEnabled.pluginId})` : '';
    await openVstEditorWindow({
      nodeId: firstEnabled.id,
      title: `VST Editor${titleSuffix}`,
    });
  }, [firstEnabled]);

  return (
    <button
      type="button"
      className="dsp-vst-magnet"
      onClick={handleOpenManager}
      onContextMenu={(event) => {
        event.preventDefault();
        void handleOpenEditor();
      }}
      title={
        firstEnabled
          ? `左键打开 VST 管理器；右键打开 VST editor${firstEnabled.pluginId?.trim() ? `：${firstEnabled.pluginId}` : ''} (${firstEnabled.id})`
          : '左键打开 VST 管理器（当前 DSP Graph 无 VST 节点）'
      }
    >
      <span className="dsp-vst-magnet-label">{label}</span>
    </button>
  );
};
