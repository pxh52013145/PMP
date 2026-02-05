import { Magnet } from '../../types/pixel';

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
  content: '',
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '2.7px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      border: '1px solid rgba(255, 255, 255, 0.22)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};

