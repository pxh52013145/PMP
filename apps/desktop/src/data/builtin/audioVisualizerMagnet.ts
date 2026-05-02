import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  STANDARD_PANEL_CHROME_INSET,
  createPanelLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const AUDIO_VISUALIZER_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    padding: '6px',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  },
  hoverStyle: {
    border: '1px solid rgba(0, 255, 136, 0.25)',
    boxShadow: '0 10px 25px rgba(0, 255, 136, 0.08)',
  },
});
const AUDIO_VISUALIZER_LAYOUT = createPanelLayoutPreset({
  chromeInset: STANDARD_PANEL_CHROME_INSET,
});

/**
 * Audio Visualizer Magnet
 * Renders an audio spectrum visualization driven by IAudioService.getFrequencyData().
 */
export const AUDIO_VISUALIZER_MAGNET: Magnet = {
  id: 'audio-visualizer',
  type: 'visualizer',
  name: 'Audio Visualizer',
  renderer: 'audio-visualizer',
  previewText: 'Visualizer',
  description: '音频频谱可视化（FFT）',
  tags: ['audio', 'fft', 'spectrum', 'visualizer'],
  runtime: {
    memoryTier: 'medium',
    capabilities: ['audio.visualizer.spectrum'],
    activation: 'visible',
    backgroundPolicy: 'visible-only',
    warmRetentionMs: 8_000,
    hibernateAfterMs: 30_000,
  },
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 6, height: 6 },
  ...AUDIO_VISUALIZER_LAYOUT,
  content: '',
  style: AUDIO_VISUALIZER_CHROME.style,
  animation: AUDIO_VISUALIZER_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
