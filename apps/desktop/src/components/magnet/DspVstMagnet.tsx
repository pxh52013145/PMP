import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { broadcastDataUpdate, readData, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import { useNavigation } from '../../contexts/NavigationContext';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { useT } from '../../i18n';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import './DspVstMagnet.css';

type VstNodeSnapshot = {
  id: string;
  enabled: boolean;
  pluginId: string;
};

type DspGraphConfig = {
  nodes?: unknown[];
};

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

type WarmupState = 'none' | 'disabled' | 'notLoaded' | 'loading' | 'loaded' | 'error';

const EVENT_VST_SESSION_STATUSES = 'vst-session-statuses';

const PROGRESS_DOT_KEYS = ['d1', 'd2', 'd3', 'd4', 'd5'] as const;

type VstWarmupNodeReport = {
  nodeId: string;
  pluginId: string;
  state: string;
  message: string | null;
  elapsedMs: number;
  primedFrames: number;
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

function ensureVstSessionStatusMap(value: unknown): Record<string, VstSessionStatus> {
  if (!Array.isArray(value)) return {};
  const map: Record<string, VstSessionStatus> = {};
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const nodeId = readStringField(entry, 'nodeId');
    if (!nodeId) continue;
    map[nodeId] = {
      nodeId,
      pluginId: readStringField(entry, 'pluginId') ?? '',
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

function ensureWarmupReports(value: unknown): VstWarmupNodeReport[] {
  if (!Array.isArray(value)) return [];
  const out: VstWarmupNodeReport[] = [];

  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const nodeId = readStringField(record, 'nodeId');
    const pluginId = readStringField(record, 'pluginId') ?? '';
    if (!nodeId) continue;

    out.push({
      nodeId,
      pluginId,
      state: readStringField(record, 'state') ?? 'unknown',
      message: readStringField(record, 'message'),
      elapsedMs: readNumberField(record, 'elapsedMs') ?? 0,
      primedFrames: readNumberField(record, 'primedFrames') ?? 0,
    });
  }

  return out;
}

function computeWarmupState(enabledVstNodes: VstNodeSnapshot[], statuses: Record<string, VstSessionStatus>): WarmupState {
  if (enabledVstNodes.length === 0) return 'none';

  const resolvedStatuses = enabledVstNodes
    .map((node) => statuses[node.id])
    .filter((status): status is VstSessionStatus => Boolean(status));

  if (resolvedStatuses.some((status) => status.pluginError)) return 'error';

  const allReady = enabledVstNodes.every((node) => {
    const status = statuses[node.id];
    return Boolean(status?.peerReady && status.pluginLoaded && status.processingActive && !status.pluginError);
  });
  if (allReady) return 'loaded';

  return resolvedStatuses.length > 0 ? 'loading' : 'notLoaded';
}

export const DspVstMagnet: React.FC = () => {
  const t = useT();
  const navigation = useNavigation();
  const [graph, setGraph] = useState<DspGraphConfig | null>(() => readData<DspGraphConfig>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH));
  const [vstStatuses, setVstStatuses] = useState<Record<string, VstSessionStatus>>({});
  const [vstEnabled, setVstEnabled] = useState<boolean>(() => {
    const raw = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED);
    return typeof raw === 'boolean' ? raw : false;
  });
  const [vstToggleBusy, setVstToggleBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<null | { x: number; y: number; items: ContextMenuItem[] }>(null);
  const [warmupBusy, setWarmupBusy] = useState(false);
  const [warmupPromptOpen, setWarmupPromptOpen] = useState(false);
  const [warmupReportMessage, setWarmupReportMessage] = useState<string | null>(null);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const contextMenuMouseDownRef = useRef(false);

  const reloadGraph = useCallback(() => {
    setGraph(readData<DspGraphConfig>(STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH));
  }, []);

  const reloadVstEnabled = useCallback(() => {
    const raw = readData<unknown>(STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED);
    setVstEnabled(typeof raw === 'boolean' ? raw : false);
  }, []);

  useEffect(() => {
    let cleanup: null | (() => void) = null;
    reloadGraph();
    reloadVstEnabled();
    void setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_DSP_GRAPH],
      [TAURI_EVENTS.NATIVE_AUDIO_DSP_GRAPH_UPDATED],
      reloadGraph
    ).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [reloadGraph, reloadVstEnabled]);

  useEffect(() => {
    let cleanup: null | (() => void) = null;
    reloadVstEnabled();
    void setupDualListener(
      [STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED],
      [TAURI_EVENTS.NATIVE_AUDIO_VST_ENABLED_UPDATED],
      reloadVstEnabled
    ).then(
      (fn) => {
        cleanup = fn;
      }
    );
    return () => cleanup?.();
  }, [reloadVstEnabled]);

  const vstNodes = useMemo(() => pickVstNodes(graph), [graph]);
  const firstEnabled = vstNodes.find((n) => n.enabled) ?? vstNodes[0] ?? null;
  const enabledVstNodes = useMemo(
    () => vstNodes.filter((node) => node.enabled && !!node.pluginId.trim()),
    [vstNodes]
  );
  const warmupState = useMemo(() => {
    if (enabledVstNodes.length === 0) return 'none';
    if (!vstEnabled) return 'disabled';
    if ((warmupBusy || vstToggleBusy) && enabledVstNodes.length > 0) return 'loading';
    return computeWarmupState(enabledVstNodes, vstStatuses);
  }, [enabledVstNodes, vstEnabled, vstStatuses, warmupBusy, vstToggleBusy]);

  const ringStyle = useMemo(() => {
    const visible = warmupState !== 'none';
    const ringColor =
      warmupState === 'loaded'
        ? 'rgba(74, 222, 128, 0.95)'
        : warmupState === 'loading'
          ? 'rgba(250, 204, 21, 0.95)'
          : warmupState === 'none'
            ? 'rgba(255, 255, 255, 0.22)'
            : 'rgba(248, 113, 113, 0.95)';

    return {
      '--dsp-vst-ring-opacity': visible ? '1' : '0',
      '--dsp-vst-ring-color': ringColor,
      '--dsp-vst-progress-opacity': warmupState === 'loading' ? '1' : '0',
      '--dsp-vst-progress-color': ringColor,
    } as React.CSSProperties;
  }, [warmupState]);

  const label = useMemo(() => {
    const fallback = t('magnet.renderers.dsp-vst.preview');
    if (!firstEnabled) return fallback;
    const primary = firstEnabled.pluginId?.trim() ? firstEnabled.pluginId : fallback;
    const suffix = vstNodes.length > 1 ? `+${vstNodes.length - 1}` : '';
    return `${primary}${suffix ? ` ${suffix}` : ''}`;
  }, [firstEnabled, t, vstNodes.length]);

  const warmupStateLabel = useMemo(() => {
    switch (warmupState) {
      case 'loaded':
        return t('magnet.dsp-vst.status.loaded');
      case 'loading':
        return t('magnet.dsp-vst.status.loading');
      case 'disabled':
        return t('magnet.dsp-vst.status.disabled');
      case 'notLoaded':
        return t('magnet.dsp-vst.status.notLoaded');
      case 'error':
        return t('magnet.dsp-vst.status.error');
      default:
        return t('magnet.dsp-vst.status.none');
    }
  }, [t, warmupState]);

  const handleOpenRack = useCallback(() => {
    navigation.navigateTo('dsp-rack');
  }, [navigation]);

  const refreshVstStatuses = useCallback(async () => {
    if (!isTauri) return;
    const list = await invoke<unknown>('native_audio_vst_list_session_statuses').catch(() => []);
    setVstStatuses(ensureVstSessionStatusMap(list));
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let unlistenStatuses: UnlistenFn | null = null;

    void refreshVstStatuses();

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<unknown>(EVENT_VST_SESSION_STATUSES, (event) => setVstStatuses(ensureVstSessionStatusMap(event.payload)))
      )
      .then((fnStatuses) => {
        unlistenStatuses = fnStatuses;
      })
      .catch(() => {});

    return () => {
      if (unlistenStatuses) void unlistenStatuses();
    };
  }, [isTauri, refreshVstStatuses]);

  const applyVstEnabled = useCallback(
    async (nextEnabled: boolean) => {
      if (!isTauri) return false;
      if (vstToggleBusy || warmupBusy) return false;

      setVstToggleBusy(true);
      try {
        await invoke('native_audio_vst_set_enabled', { enabled: nextEnabled });
        await broadcastDataUpdate(
          STORAGE_KEYS.NATIVE_AUDIO_VST_ENABLED,
          nextEnabled,
          TAURI_EVENTS.NATIVE_AUDIO_VST_ENABLED_UPDATED
        );
        setVstEnabled(nextEnabled);
        void refreshVstStatuses();
        return true;
      } catch (err) {
        console.warn('[DspVstMagnet] Toggle VST failed:', err);
        setWarmupReportMessage(t('magnet.dsp-vst.operation.failed', { error: String(err) }));
        return false;
      } finally {
        setVstToggleBusy(false);
      }
    },
    [isTauri, refreshVstStatuses, t, vstToggleBusy, warmupBusy]
  );

  const warmup = useCallback(async () => {
    if (!isTauri) return;
    if (warmupBusy) return;
    if (enabledVstNodes.length === 0) return;

    try {
      if (!vstEnabled) {
        const ok = await applyVstEnabled(true);
        if (!ok) {
          setWarmupReportMessage(t('magnet.dsp-vst.operation.vstEnableRequired'));
          return;
        }
      }

      setWarmupBusy(true);
      const report = await invoke<unknown>('native_audio_vst_warmup');
      const parsed = ensureWarmupReports(report);
      const lines: string[] = [];
      if (parsed.length === 0) {
        lines.push(t('magnet.dsp-vst.warmup.report.empty'));
      } else {
        lines.push(t('magnet.dsp-vst.warmup.report.header', { count: String(parsed.length) }));
        for (const item of parsed) {
          const head = `${item.pluginId || item.nodeId}`;
          const suffix = item.elapsedMs ? ` (${item.elapsedMs}ms)` : '';
          const detail = item.message ? ` - ${item.message}` : '';
          lines.push(`- ${head}: ${item.state}${suffix}${detail}`);
        }
      }
      setWarmupReportMessage(lines.join('\n'));
    } catch (err) {
      console.warn('[DspVstMagnet] Warmup failed:', err);
      setWarmupReportMessage(t('magnet.dsp-vst.warmup.report.failed', { error: String(err) }));
    } finally {
      setWarmupBusy(false);
      void refreshVstStatuses();
    }
  }, [applyVstEnabled, enabledVstNodes.length, isTauri, refreshVstStatuses, t, vstEnabled, warmupBusy]);

  const openContextMenuAt = useCallback(
    (x: number, y: number) => {
      const items: ContextMenuItem[] = [
        {
          label: t('magnet.dsp-vst.contextMenu.openRack'),
          onClick: handleOpenRack,
        },
        { divider: true } as ContextMenuItem,
        ...(enabledVstNodes.length > 0
          ? [
              {
                label: vstEnabled
                  ? t('magnet.dsp-vst.contextMenu.disable')
                  : t('magnet.dsp-vst.contextMenu.enable'),
                onClick: () => void applyVstEnabled(!vstEnabled),
                disabled: !isTauri || warmupBusy || vstToggleBusy,
              } as ContextMenuItem,
            ]
          : []),
        {
          label: t('magnet.dsp-vst.contextMenu.warmup'),
          onClick: () => setWarmupPromptOpen(true),
          disabled: !isTauri || enabledVstNodes.length === 0 || warmupBusy || vstToggleBusy,
        },
      ];
      setContextMenu({ x, y, items });
    },
    [applyVstEnabled, enabledVstNodes.length, handleOpenRack, isTauri, t, vstEnabled, vstToggleBusy, warmupBusy]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (contextMenuMouseDownRef.current) {
        contextMenuMouseDownRef.current = false;
        return;
      }
      openContextMenuAt(e.clientX, e.clientY);
    },
    [openContextMenuAt]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 2) return;
      contextMenuMouseDownRef.current = true;
      e.preventDefault();
      e.stopPropagation();
      openContextMenuAt(e.clientX, e.clientY);
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          contextMenuMouseDownRef.current = false;
        }, 450);
      }
    },
    [openContextMenuAt]
  );

  const title = useMemo(() => {
    const plugin = firstEnabled?.pluginId?.trim() ? firstEnabled.pluginId.trim() : t('magnet.renderers.dsp-vst.preview');
    return t('magnet.dsp-vst.tooltip', {
      plugin,
      status: warmupStateLabel,
    });
  }, [firstEnabled, t, warmupStateLabel]);

  return (
    <>
      <button
        type="button"
        className="dsp-vst-magnet"
        style={ringStyle}
        onClick={handleOpenRack}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        title={title}
      >
        <span className="dsp-vst-magnet-label">{label}</span>
        <span
          className={`dsp-vst-magnet-progress${warmupState === 'loading' ? ' dsp-vst-magnet-progress--loading' : ''}`}
          aria-hidden="true"
        >
          {PROGRESS_DOT_KEYS.map((key, idx) => (
            <span key={key} className="dsp-vst-magnet-progress-dot" data-dot={idx} />
          ))}
        </span>
      </button>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      <ConfirmDialog
        isOpen={warmupPromptOpen}
        title={t('magnet.dsp-vst.warmup.confirmTitle')}
        message={t('magnet.dsp-vst.warmup.confirmMessage', {
          targets: enabledVstNodes.map((node) => `- ${node.pluginId || node.id}`).join('\n') || '-',
        })}
        confirmText={t('magnet.dsp-vst.warmup.confirmAction')}
        cancelText={t('common.action.cancel')}
        onConfirm={() => {
          setWarmupPromptOpen(false);
          void warmup();
        }}
        onCancel={() => setWarmupPromptOpen(false)}
      />

      <ConfirmDialog
        isOpen={warmupReportMessage !== null}
        title={t('magnet.dsp-vst.warmup.reportTitle')}
        message={warmupReportMessage ?? ''}
        confirmText={t('common.action.ok')}
        cancelText=""
        onConfirm={() => setWarmupReportMessage(null)}
        onCancel={() => setWarmupReportMessage(null)}
      />
    </>
  );
};
