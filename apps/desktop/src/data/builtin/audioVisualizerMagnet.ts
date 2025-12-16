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
  anchors: [
    {
      id: 'top-left',
      gridX: 0,
      gridY: 8,
      role: 'anchor',
    },
    {
      id: 'top-right',
      gridX: 5,
      gridY: 8,
      role: 'boundary',
    },
    {
      id: 'bottom-left',
      gridX: 0,
      gridY: 13,
      role: 'boundary',
    },
    {
      id: 'bottom-right',
      gridX: 5,
      gridY: 13,
      role: 'boundary',
    },
  ],
  content: '',
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
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
