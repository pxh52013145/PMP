import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import { createPanelLayoutPreset } from '../../modules/magnets/layoutPresets';

const PROCESS_PERF_MONITOR_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  },
  hoverStyle: {
    border: '1px solid rgba(255, 255, 255, 0.22)',
  },
});
const PROCESS_PERF_MONITOR_LAYOUT = createPanelLayoutPreset({
  boundsOutset: { top: 9 },
  boundsAlign: { topToMagnetId: 'btn-back' },
});

export const PROCESS_PERF_MONITOR_MAGNET: Magnet = {
  id: 'process-perf-monitor',
  type: 'custom',
  name: 'Perf Monitor',
  renderer: 'process-perf-monitor',
  previewText: 'PERF',
  description: 'Process tree CPU/memory monitor (WebView2 included)',
  tags: ['debug', 'perf', 'webview2'],
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 6, height: 8 },
  ...PROCESS_PERF_MONITOR_LAYOUT,
  content: '',
  style: PROCESS_PERF_MONITOR_CHROME.style,
  animation: PROCESS_PERF_MONITOR_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};

