import { Magnet } from '../../types/pixel';

/**
 * Audio Visualizer Magnet
 * Renders a pixel-style frequency spectrum driven by IAudioService.getFrequencyData().
 */
export const AUDIO_VISUALIZER_MAGNET: Magnet = {
  id: 'audio-visualizer',
  type: 'visualizer',
  name: 'Audio Visualizer',
  renderer: 'audio-visualizer',
  previewText: 'Visualizer',
  description: '音频频谱可视化（FFT）',
  tags: ['audio', 'fft', 'spectrum', 'visualizer'],
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 6, height: 6 },
  content: '',
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2.7px',
    overflow: 'hidden',
    padding: '6px',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      border: '1px solid rgba(0, 255, 136, 0.25)',
      boxShadow: '0 10px 25px rgba(0, 255, 136, 0.08)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
