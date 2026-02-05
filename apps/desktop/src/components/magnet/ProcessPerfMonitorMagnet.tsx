import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { getProcessPerfTotalsSnapshot, type ProcessPerfTotalsSnapshot } from '../../modules/debug';

type DisplaySnapshot = {
  updatedAtMs: number;
  systemMemoryLoadPercent: number | null;
  systemMemoryTotalBytes: number | null;
  systemMemoryAvailableBytes: number | null;
  totals: ProcessPerfTotalsSnapshot['totals'];
};

function toMb(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${(value / 1024 / 1024).toFixed(0)}MB`;
}

function toCpu(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

function getPollIntervalMs(renderMode: 'full' | 'throttle' | 'pause'): number {
  if (renderMode === 'pause') return 0;
  if (renderMode === 'throttle') return 2000;
  return 1000;
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
  const pollIntervalMs = useMemo(() => getPollIntervalMs(renderMode), [renderMode]);
  const [snapshot, setSnapshot] = useState<DisplaySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const lastHashRef = useRef<string>('');

  useEffect(() => {
    if (!isVisible) return;
    if (pollIntervalMs <= 0) return;

    let cancelled = false;
    const poll = async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const result = await getProcessPerfTotalsSnapshot();
        if (cancelled) return;
        if (!result) {
          setError(t('magnet.processPerf.error.unavailable'));
          setSnapshot(null);
          return;
        }

        const display: DisplaySnapshot = {
          updatedAtMs: Date.now(),
          systemMemoryLoadPercent: result.systemMemory?.memoryLoadPercent ?? null,
          systemMemoryTotalBytes: result.systemMemory?.totalPhysicalBytes ?? null,
          systemMemoryAvailableBytes: result.systemMemory?.availablePhysicalBytes ?? null,
          totals: result.totals,
        };

        const hash = buildSnapshotHash(display);
        if (hash !== lastHashRef.current) {
          lastHashRef.current = hash;
          setSnapshot(display);
        }
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        busyRef.current = false;
      }
    };

    void poll();
    const handle = window.setInterval(() => {
      void poll();
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [isVisible, pollIntervalMs, t]);

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
      style={{
        width: '100%',
        height: '100%',
        padding: 8,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        color: 'rgba(255,255,255,0.92)',
        fontSize: 11,
        lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
        contain: 'content',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <span style={{ fontSize: 11, letterSpacing: 0.5, opacity: 0.92 }}>
          {t('magnet.processPerf.title')}
        </span>
        <span style={{ fontSize: 10, opacity: 0.65 }}>
          {renderMode === 'pause'
            ? t('magnet.processPerf.badge.paused')
            : renderMode === 'throttle'
              ? t('magnet.processPerf.badge.throttle')
              : t('magnet.processPerf.badge.live')}
        </span>
      </div>

      {error ? (
        <div style={{ color: 'rgba(255,140,140,0.92)', fontSize: 10 }}>{error}</div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ opacity: 0.72 }}>{t('magnet.processPerf.row.webview2Private')}</span>
          <span>{toMb(snapshot?.totals.webview2PrivateBytes ?? null)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ opacity: 0.72 }}>{t('magnet.processPerf.row.treePrivate')}</span>
          <span>{toMb(snapshot?.totals.privateBytes ?? null)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ opacity: 0.72 }}>{t('magnet.processPerf.row.webview2Cpu')}</span>
          <span>{toCpu(snapshot?.totals.webview2CpuPercent ?? null)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ opacity: 0.72 }}>{t('magnet.processPerf.row.treeCpu')}</span>
          <span>{toCpu(snapshot?.totals.cpuPercent ?? null)}</span>
        </div>
      </div>

      <div style={{ marginTop: 'auto', fontSize: 10, opacity: 0.68, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {systemLine}
      </div>
    </div>
  );
});
