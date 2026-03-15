import type { MagnetVariantPreset } from './shared/magnetVariantCatalog';
import { readBooleanProp, readEnumProp } from './shared/skinPropUtils';

const PROCESS_PERF_METRIC_SETS = ['full', 'memory', 'cpu'] as const;

export type ProcessPerfMetricSet = (typeof PROCESS_PERF_METRIC_SETS)[number];

export interface ProcessPerfMonitorSkinProps {
  metricSet: ProcessPerfMetricSet;
  showModeBadge: boolean;
  showSystemSummary: boolean;
}

export function parseProcessPerfMonitorSkinProps(value: unknown): ProcessPerfMonitorSkinProps {
  return {
    metricSet: readEnumProp(value, 'metricSet', PROCESS_PERF_METRIC_SETS, 'full'),
    showModeBadge: readBooleanProp(value, 'showModeBadge', true),
    showSystemSummary: readBooleanProp(value, 'showSystemSummary', true),
  };
}

export const PROCESS_PERF_MONITOR_VARIANT_PRESETS = [
  {
    id: 'default',
    labelKey: 'magnet.variants.process-perf-monitor.default.label',
    descriptionKey: 'magnet.variants.process-perf-monitor.default.description',
  },
  {
    id: 'compact',
    labelKey: 'magnet.variants.process-perf-monitor.compact.label',
    descriptionKey: 'magnet.variants.process-perf-monitor.compact.description',
    props: {
      metricSet: 'memory',
      showModeBadge: false,
      showSystemSummary: false,
    },
  },
  {
    id: 'cpu-focus',
    labelKey: 'magnet.variants.process-perf-monitor.cpu-focus.label',
    descriptionKey: 'magnet.variants.process-perf-monitor.cpu-focus.description',
    props: {
      metricSet: 'cpu',
      showModeBadge: true,
      showSystemSummary: false,
    },
  },
] satisfies readonly MagnetVariantPreset<ProcessPerfMonitorSkinProps>[];
