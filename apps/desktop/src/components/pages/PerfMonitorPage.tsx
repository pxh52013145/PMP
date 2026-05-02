import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { getGlobalProcessPerfService } from '../../services/performance-control';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../../services/runtime-capsules';
import {
  getProcessPerfSnapshot,
  type ProcessPerfSnapshot,
  type ProcessPerfRow,
} from '../../modules/debug';
import { PmpButton, PmpCard, PmpChoiceButton, PmpSegmented } from '../primitives';

function formatBytesMb(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatCpuPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

function computeRowKey(row: ProcessPerfRow): string {
  return `${row.pid}:${row.privateBytes ?? '-'}:${row.workingSetBytes ?? '-'}:${row.cpuPercent ?? '-'}`;
}

export function PerfMonitorPage() {
  const kernel = useKernel();
  const t = useT();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const { isVisible, renderMode } = useWindowActivity();
  const runtimeCapsuleManager = useMemo(
    () =>
      kernel.services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null,
    [kernel]
  );
  const [snapshot, setSnapshot] = useState<ProcessPerfSnapshot | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const lastHashRef = useRef('');

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    if (busyRef.current) return;
    busyRef.current = true;

    setBusy(true);
    setError(null);
    try {
      const next = await (
        getGlobalProcessPerfService()?.refreshSnapshot({ force: true }) ??
        getProcessPerfSnapshot()
      );
      if (!next) {
        setSnapshot(null);
        setError(t('pages.perf-monitor.error.unavailable'));
        return;
      }

      const hashParts = [
        next.sampleIntervalMs ?? '-',
        next.totals.privateBytes,
        next.totals.webview2PrivateBytes,
        next.totals.cpuPercent ?? '-',
        next.totals.webview2CpuPercent ?? '-',
        next.processes.map(computeRowKey).join(','),
      ];
      const hash = hashParts.join('|');
      if (hash !== lastHashRef.current) {
        lastHashRef.current = hash;
        setSnapshot(next);
      }
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [isTauri, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri || !runtimeCapsuleManager || !isVisible || renderMode === 'pause') return;

    const lease = runtimeCapsuleManager.acquireLease({
      capabilityId: 'debug.process-perf',
      ownerKind: 'route',
      ownerId: 'perf-monitor-page',
      priority: 'foreground',
      reason: {
        routeId: 'perf-monitor',
        detail: 'perf monitor page active',
      },
    });

    return () => {
      if (!lease) return;
      runtimeCapsuleManager.releaseLease(lease.id, {
        kind: 'lease-expired',
        detail: 'perf monitor page released',
      });
    };
  }, [isTauri, isVisible, renderMode, runtimeCapsuleManager]);

  useEffect(() => {
    if (!isTauri) return;
    if (!autoRefresh) return;
    if (!isVisible || renderMode === 'pause') return;

    const intervalMs = renderMode === 'throttle' ? 5_000 : 1_000;
    void refresh();
    const handle = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(handle);
  }, [autoRefresh, isTauri, isVisible, refresh, renderMode]);

  const sortedProcesses = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.processes].sort((a, b) => (b.privateBytes ?? 0) - (a.privateBytes ?? 0));
  }, [snapshot]);

  if (!isTauri) {
    return (
      <div className="settings-page" style={{ padding: 18 }}>
        <div className="settings-header">
          <h1 style={{ margin: 0 }}>{t('pages.perf-monitor.title')}</h1>
          <p style={{ margin: '8px 0 0 0', opacity: 0.75 }}>{t('pages.perf-monitor.subtitle')}</p>
        </div>
        <PmpCard className="settings-card" surfaceId="primitive.card.settings">
          <p className="settings-card-desc">{t('debug.center.note.requireTauri')}</p>
        </PmpCard>
      </div>
    );
  }

  return (
    <div className="settings-page" style={{ padding: 18 }}>
      <div className="settings-header">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ margin: 0 }}>{t('pages.perf-monitor.title')}</h1>
            <p style={{ margin: '8px 0 0 0', opacity: 0.75 }}>{t('pages.perf-monitor.subtitle')}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <PmpButton
              type="button"
              className="settings-action-btn"
              variant="default"
              onClick={() => void refresh()}
              disabled={busy}
            >
              {t('common.action.refresh')}
            </PmpButton>
          </div>
        </div>
      </div>

      <PmpCard className="settings-card" surfaceId="primitive.card.settings">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('pages.perf-monitor.section.totals.title')}</p>
            <p className="settings-card-desc">{t('pages.perf-monitor.section.totals.desc')}</p>
          </div>
          <PmpSegmented className="settings-toggle" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={!autoRefresh} onClick={() => setAutoRefresh(false)}>
              {t('common.state.off')}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={autoRefresh} onClick={() => setAutoRefresh(true)}>
              {t('common.state.on')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>

        <p className="settings-card-note">{t('pages.perf-monitor.note.metrics')}</p>

        {error ? (
          <p className="settings-card-note" style={{ color: 'rgba(255, 140, 140, 0.92)' }}>
            {error}
          </p>
        ) : null}

        {snapshot ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p className="settings-card-note">
              {t('pages.perf-monitor.sample', {
                intervalSec: snapshot.sampleIntervalMs ? (snapshot.sampleIntervalMs / 1000).toFixed(2) : '-',
                cpuCount: snapshot.cpuCount,
              })}
            </p>
            {snapshot.systemMemory ? (
              <p className="settings-card-note">
                {t('pages.perf-monitor.systemMemory', {
                  load: snapshot.systemMemory.memoryLoadPercent,
                  total: formatBytesMb(snapshot.systemMemory.totalPhysicalBytes),
                  avail: formatBytesMb(snapshot.systemMemory.availablePhysicalBytes),
                })}
              </p>
            ) : null}
            <p className="settings-card-desc">
              {t('pages.perf-monitor.totals.webview2', {
                ws: formatBytesMb(snapshot.totals.webview2WorkingSetBytes),
                private: formatBytesMb(snapshot.totals.webview2PrivateBytes),
                cpu: formatCpuPercent(snapshot.totals.webview2CpuPercent),
              })}
            </p>
            <p className="settings-card-desc">
              {t('pages.perf-monitor.totals.tree', {
                ws: formatBytesMb(snapshot.totals.workingSetBytes),
                private: formatBytesMb(snapshot.totals.privateBytes),
                cpu: formatCpuPercent(snapshot.totals.cpuPercent),
              })}
            </p>
          </div>
        ) : (
          <p className="settings-card-note">{t('pages.perf-monitor.empty')}</p>
        )}
      </PmpCard>

      <PmpCard className="settings-card" surfaceId="primitive.card.settings">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('pages.perf-monitor.section.processes.title')}</p>
            <p className="settings-card-desc">{t('pages.perf-monitor.section.processes.desc')}</p>
          </div>
        </div>

        {snapshot ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedProcesses.map((process) => {
              const kindLabel =
                process.kind === 'app'
                  ? t('debug.center.memory.processPerf.kind.app')
                  : process.kind === 'webview2'
                    ? t('debug.center.memory.processPerf.kind.webview2')
                    : t('debug.center.memory.processPerf.kind.child');

              return (
                <div
                  key={process.pid}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.22)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)' }}>{process.name}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                      {t('debug.center.memory.processPerf.processPid', { pid: process.pid })}
                    </span>
                  </div>
                  <p className="settings-card-note" style={{ marginTop: 6 }}>
                    {t('debug.center.memory.processPerf.processLine', {
                      kind: kindLabel,
                      cpu: formatCpuPercent(process.cpuPercent),
                      private: formatBytesMb(process.privateBytes),
                      ws: formatBytesMb(process.workingSetBytes),
                    })}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="settings-card-note">{t('pages.perf-monitor.empty')}</p>
        )}
      </PmpCard>
    </div>
  );
}
