import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import './ProcessPerfMonitorMagnet.css';

type DisplaySnapshot = {
  updatedAtMs: number;
  systemMemoryLoadPercent: number | null;
  systemMemoryTotalBytes: number | null;
  systemMemoryAvailableBytes: number | null;
  totals: {
    privateBytes: number;
    webview2PrivateBytes: number;
    cpuPercent: number | null;
    webview2CpuPercent: number | null;
  };
};

function toMb(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value / 1024 / 1024).toFixed(0)}MB`;
}

function toCpu(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

function buildSnapshotHash(snapshot: DisplaySnapshot): string {
  const t = snapshot.totals;
  return [
    snapshot.systemMemoryLoadPercent ?? '-',
    snapshot.systemMemoryTotalBytes ?? '-',
    snapshot.systemMemoryAvailableBytes ?? '-',
    t.privateBytes ?? '-',
    t.webview2PrivateBytes ?? '-',
    t.cpuPercent ?? '-',
    t.webview2CpuPercent ?? '-',
  ].join('|');
}

export const ProcessPerfMonitorMagnet = memo(function ProcessPerfMonitorMagnet() {
  const t = useT();
  const navigation = useNavigation();
  const { renderMode, isVisible } = useWindowActivity();
  const { service, snapshot: perfSnapshot } = usePerformanceControlSettings();
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastHashRef = useRef<string>('');

  useEffect(() => {
    const webview2 = perfSnapshot.webview2;
    if (!webview2) {
      setError(t('magnet.processPerf.error.unavailable'));
      return;
    }

    const display: DisplaySnapshot = {
      updatedAtMs: perfSnapshot.updatedAtMs || Date.now(),
      systemMemoryLoadPercent: webview2.systemMemoryLoadPercent ?? null,
      systemMemoryTotalBytes: webview2.systemMemoryTotalBytes ?? null,
      systemMemoryAvailableBytes: webview2.systemMemoryAvailableBytes ?? null,
      totals: {
        privateBytes: webview2.treePrivateBytes ?? webview2.webview2PrivateBytes,
        webview2PrivateBytes: webview2.webview2PrivateBytes,
        cpuPercent: webview2.treeCpuPercent ?? webview2.webview2CpuPercent,
        webview2CpuPercent: webview2.webview2CpuPercent,
      },
    };

    const hash = buildSnapshotHash(display);
    if (hash !== lastHashRef.current) {
      lastHashRef.current = hash;
      setSnapshot(display);
    }
    setError(null);
  }, [perfSnapshot, t]);

  useEffect(() => {
    if (!isVisible) return;

    let cancelled = false;
    void service.refreshNow().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isVisible, renderMode, service]);

  const systemLine = useMemo(() => {
    if (!snapshot) return '-';
    if (snapshot.systemMemoryLoadPercent === null) return '-';
    return t('magnet.processPerf.line.system', {
      load: snapshot.systemMemoryLoadPercent,
      total: toMb(snapshot.systemMemoryTotalBytes),
      avail: toMb(snapshot.systemMemoryAvailableBytes),
    });
  }, [snapshot, t]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigation.navigateTo('debug', { tab: 'perf-monitor' })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigation.navigateTo('debug', { tab: 'perf-monitor' });
        }
      }}
      className="process-perf-monitor"
    >
      <div className="process-perf-monitor__header">
        <span className="process-perf-monitor__title">
          {t('magnet.processPerf.title')}
        </span>
        <span className="process-perf-monitor__badge">
          {renderMode === 'pause'
            ? t('magnet.processPerf.badge.paused')
            : renderMode === 'throttle'
              ? t('magnet.processPerf.badge.throttle')
              : t('magnet.processPerf.badge.live')}
        </span>
      </div>

      {error ? (
        <div className="process-perf-monitor__error">{error}</div>
      ) : null}

      <div className="process-perf-monitor__stats">
        <div className="process-perf-monitor__row">
          <span className="process-perf-monitor__label">{t('magnet.processPerf.row.webview2Private')}</span>
          <span>{toMb(snapshot?.totals.webview2PrivateBytes ?? null)}</span>
        </div>
        <div className="process-perf-monitor__row">
          <span className="process-perf-monitor__label">{t('magnet.processPerf.row.treePrivate')}</span>
          <span>{toMb(snapshot?.totals.privateBytes ?? null)}</span>
        </div>
        <div className="process-perf-monitor__row">
          <span className="process-perf-monitor__label">{t('magnet.processPerf.row.webview2Cpu')}</span>
          <span>{toCpu(snapshot?.totals.webview2CpuPercent ?? null)}</span>
        </div>
        <div className="process-perf-monitor__row">
          <span className="process-perf-monitor__label">{t('magnet.processPerf.row.treeCpu')}</span>
          <span>{toCpu(snapshot?.totals.cpuPercent ?? null)}</span>
        </div>
      </div>

      <div className="process-perf-monitor__footer">
        {systemLine}
      </div>
    </div>
  );
});
