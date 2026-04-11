import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from '../../services/commands';
import { buildMagnetVariantRenderers } from './shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from './shared/useResolvedMagnetSkinRenderer';
import {
  PROCESS_PERF_MONITOR_VARIANT_PRESETS,
  parseProcessPerfMonitorSkinProps,
} from './processPerfMonitorSkin';
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

type ProcessPerfMonitorRendererProps = {
  skinProps?: Record<string, unknown>;
};

const ProcessPerfMonitorDefaultRenderer = memo(function ProcessPerfMonitorDefaultRenderer({
  skinProps: rawSkinProps,
}: ProcessPerfMonitorRendererProps) {
  const skinProps = useMemo(() => parseProcessPerfMonitorSkinProps(rawSkinProps), [rawSkinProps]);
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
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

  const statRows = useMemo(() => {
    const rows = [
      {
        key: 'webview2-private',
        label: t('magnet.processPerf.row.webview2Private'),
        value: toMb(snapshot?.totals.webview2PrivateBytes ?? null),
        group: 'memory' as const,
      },
      {
        key: 'tree-private',
        label: t('magnet.processPerf.row.treePrivate'),
        value: toMb(snapshot?.totals.privateBytes ?? null),
        group: 'memory' as const,
      },
      {
        key: 'webview2-cpu',
        label: t('magnet.processPerf.row.webview2Cpu'),
        value: toCpu(snapshot?.totals.webview2CpuPercent ?? null),
        group: 'cpu' as const,
      },
      {
        key: 'tree-cpu',
        label: t('magnet.processPerf.row.treeCpu'),
        value: toCpu(snapshot?.totals.cpuPercent ?? null),
        group: 'cpu' as const,
      },
    ];

    if (skinProps.metricSet === 'memory') {
      return rows.filter((row) => row.group === 'memory');
    }
    if (skinProps.metricSet === 'cpu') {
      return rows.filter((row) => row.group === 'cpu');
    }
    return rows;
  }, [skinProps.metricSet, snapshot, t]);

  const openPerfMonitor = useMemo(() => {
    return () => {
      void dispatchCommandOrFallback(commands, 'app:navigate-perf-monitor', () =>
        navigation.navigateTo('debug', { tab: 'perf-monitor' })
      );
    };
  }, [commands, navigation]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openPerfMonitor}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPerfMonitor();
        }
      }}
      className="process-perf-monitor"
    >
      <div className="process-perf-monitor__header">
        <span className="process-perf-monitor__title">
          {t('magnet.processPerf.title')}
        </span>
        {skinProps.showModeBadge ? (
          <span className="process-perf-monitor__badge">
            {renderMode === 'pause'
              ? t('magnet.processPerf.badge.paused')
              : renderMode === 'throttle'
                ? t('magnet.processPerf.badge.throttle')
                : t('magnet.processPerf.badge.live')}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="process-perf-monitor__error">{error}</div>
      ) : null}

      <div className="process-perf-monitor__stats">
        {statRows.map((row) => (
          <div key={row.key} className="process-perf-monitor__row">
            <span className="process-perf-monitor__label">{row.label}</span>
            <span>{row.value}</span>
          </div>
        ))}
      </div>

      {skinProps.showSystemSummary ? (
        <div className="process-perf-monitor__footer">
          {systemLine}
        </div>
      ) : null}
    </div>
  );
});

const PROCESS_PERF_MONITOR_RENDERERS = {
  ...buildMagnetVariantRenderers(ProcessPerfMonitorDefaultRenderer, PROCESS_PERF_MONITOR_VARIANT_PRESETS),
} satisfies Record<string, ComponentType<ProcessPerfMonitorRendererProps>>;

export const ProcessPerfMonitorMagnet = memo(function ProcessPerfMonitorMagnet() {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer(
    'process-perf-monitor',
    PROCESS_PERF_MONITOR_RENDERERS,
    {
      defaultRendererId: 'default',
      defaultVariant: 'default',
    }
  );

  return <Renderer skinProps={skin.props} />;
});
