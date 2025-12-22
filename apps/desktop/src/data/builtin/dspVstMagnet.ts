import { Magnet } from '../../types/pixel';

export const DSP_VST_MAGNET: Magnet = {
  id: 'dsp-vst',
  type: 'custom',
  name: 'VST Slot',
  renderer: 'dsp-vst',
  previewText: 'VST',
  description: '显示 DSP Graph 中的 VST 节点并打开编辑窗口',
  tags: ['dsp', 'vst', 'vst3', 'native'],
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 6,
      gridY: 18,
      role: 'anchor',
    },
  ],
  content: '',
  style: {
    width: '96px',
    height: '36px',
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

