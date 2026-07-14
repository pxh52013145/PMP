import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './PerfMonitorPage.css';
import { useKernel } from '../../contexts/KernelApiContext';
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
  return `${row.pid}:${row.privateWorkingSetBytes ?? '-'}:${row.privateBytes ?? '-'}:${row.workingSetBytes ?? '-'}:${row.cpuPercent ?? '-'}`;
}

type PerfMetricCardProps = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'accent' | 'muted';
};

function PerfMetricCard({ label, value, detail, tone = 'default' }: PerfMetricCardProps) {
  return (
    <div className={`perf-monitor-metric perf-monitor-metric--${tone}`}>
      <span className="perf-monitor-metric-label">{label}</span>
      <strong className="perf-monitor-metric-value">{value}</strong>
      {detail ? <span className="perf-monitor-metric-detail">{detail}</span> : null}
    </div>
  );
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
    return [...snapshot.processes].sort(
      (a, b) =>
        (b.privateWorkingSetBytes ?? b.workingSetBytes ?? 0) -
        (a.privateWorkingSetBytes ?? a.workingSetBytes ?? 0)
    );
  }, [snapshot]);

  if (!isTauri) {
    return (
      <div className="settings-page perf-monitor-page">
        <div className="perf-monitor-header">
          <div className="perf-monitor-heading">
            <p className="settings-card-label">{t('pages.perf-monitor.title')}</p>
            <p className="settings-card-desc">{t('pages.perf-monitor.subtitle')}</p>
          </div>
        </div>
        <PmpCard className="settings-card perf-monitor-card" surfaceId="primitive.card.settings">
          <p className="settings-card-desc">{t('debug.center.note.requireTauri')}</p>
        </PmpCard>
      </div>
    );
  }

  return (
    <div className="settings-page perf-monitor-page">
      <div className="perf-monitor-header">
        <div className="perf-monitor-heading">
          <p className="settings-card-label">{t('pages.perf-monitor.title')}</p>
          <p className="settings-card-desc">{t('pages.perf-monitor.subtitle')}</p>
        </div>
        <div className="perf-monitor-toolbar">
          <PmpSegmented className="settings-toggle perf-monitor-refresh-toggle" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={!autoRefresh} onClick={() => setAutoRefresh(false)}>
              {t('common.state.off')}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={autoRefresh} onClick={() => setAutoRefresh(true)}>
              {t('common.state.on')}
            </PmpChoiceButton>
          </PmpSegmented>
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

      {snapshot ? (
        <div className="perf-monitor-metric-grid">
          <PerfMetricCard
            tone="accent"
            label={t('pages.perf-monitor.metric.treeMemory')}
            value={formatBytesMb(snapshot.totals.privateWorkingSetBytes)}
            detail={t('pages.perf-monitor.metric.cpuValue', {
              value: formatCpuPercent(snapshot.totals.cpuPercent),
            })}
          />
          <PerfMetricCard
            tone="accent"
            label={t('pages.perf-monitor.metric.webview2Memory')}
            value={formatBytesMb(snapshot.totals.webview2PrivateWorkingSetBytes)}
            detail={t('pages.perf-monitor.metric.cpuValue', {
              value: formatCpuPercent(snapshot.totals.webview2CpuPercent),
            })}
          />
          <PerfMetricCard
            label={t('pages.perf-monitor.metric.treePrivate')}
            value={formatBytesMb(snapshot.totals.privateBytes)}
          />
          <PerfMetricCard
            label={t('pages.perf-monitor.metric.treeWs')}
            value={formatBytesMb(snapshot.totals.workingSetBytes)}
          />
          <PerfMetricCard
            tone="muted"
            label={t('pages.perf-monitor.metric.sampleInterval')}
            value={snapshot.sampleIntervalMs ? `${(snapshot.sampleIntervalMs / 1000).toFixed(2)}s` : '-'}
            detail={t('pages.perf-monitor.metric.cpuCores', { count: snapshot.cpuCount })}
          />
          <PerfMetricCard
            tone="muted"
            label={t('pages.perf-monitor.metric.systemLoad')}
            value={snapshot.systemMemory ? `${snapshot.systemMemory.memoryLoadPercent}%` : '-'}
            detail={
              snapshot.systemMemory
                ? t('pages.perf-monitor.metric.availableMemory', {
                    value: formatBytesMb(snapshot.systemMemory.availablePhysicalBytes),
                  })
                : undefined
            }
          />
        </div>
      ) : null}

      <PmpCard className="settings-card perf-monitor-card" surfaceId="primitive.card.settings">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('pages.perf-monitor.section.totals.title')}</p>
            <p className="settings-card-desc">{t('pages.perf-monitor.section.totals.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {autoRefresh ? t('common.state.on') : t('common.state.off')}
          </span>
        </div>

        <p className="settings-card-note perf-monitor-note">{t('pages.perf-monitor.note.metrics')}</p>

        {error ? (
          <p className="settings-card-note perf-monitor-error">
            {error}
          </p>
        ) : null}

        {snapshot ? (
          <div className="perf-monitor-summary">
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
                memory: formatBytesMb(snapshot.totals.webview2PrivateWorkingSetBytes),
                ws: formatBytesMb(snapshot.totals.webview2WorkingSetBytes),
                private: formatBytesMb(snapshot.totals.webview2PrivateBytes),
                cpu: formatCpuPercent(snapshot.totals.webview2CpuPercent),
              })}
            </p>
            <p className="settings-card-desc">
              {t('pages.perf-monitor.totals.tree', {
                memory: formatBytesMb(snapshot.totals.privateWorkingSetBytes),
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

      <PmpCard className="settings-card perf-monitor-card" surfaceId="primitive.card.settings">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('pages.perf-monitor.section.processes.title')}</p>
            <p className="settings-card-desc">{t('pages.perf-monitor.section.processes.desc')}</p>
          </div>
        </div>

        {snapshot ? (
          <div className="perf-monitor-process-list" role="table" aria-label={t('pages.perf-monitor.section.processes.title')}>
            <div className="perf-monitor-process-head" role="row">
              <span role="columnheader">{t('pages.perf-monitor.process.name')}</span>
              <span role="columnheader">{t('pages.perf-monitor.process.kind')}</span>
              <span role="columnheader">{t('pages.perf-monitor.process.cpu')}</span>
              <span role="columnheader">{t('pages.perf-monitor.process.memory')}</span>
              <span role="columnheader">{t('pages.perf-monitor.process.private')}</span>
              <span role="columnheader">{t('pages.perf-monitor.process.ws')}</span>
            </div>
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
                  className="perf-monitor-process-row"
                  role="row"
                >
                  <div className="perf-monitor-process-title" role="cell">
                    <span>{process.name}</span>
                    <small>
                      {t('debug.center.memory.processPerf.processPid', { pid: process.pid })}
                    </small>
                  </div>
                  <span className="perf-monitor-process-kind" role="cell">{kindLabel}</span>
                  <span className="perf-monitor-process-value" role="cell">{formatCpuPercent(process.cpuPercent)}</span>
                  <span className="perf-monitor-process-value" role="cell">{formatBytesMb(process.privateWorkingSetBytes)}</span>
                  <span className="perf-monitor-process-value" role="cell">{formatBytesMb(process.privateBytes)}</span>
                  <span className="perf-monitor-process-value" role="cell">{formatBytesMb(process.workingSetBytes)}</span>
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
