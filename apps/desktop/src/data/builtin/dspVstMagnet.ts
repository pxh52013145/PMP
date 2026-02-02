import { Magnet } from '../../types/pixel';

export const DSP_VST_MAGNET: Magnet = {
  id: 'dsp-vst',
  type: 'custom',
  name: 'VST Slot',
  renderer: 'dsp-vst',
  previewText: 'VST',
  description: 'VST 管理入口：打开 DSP Rack（读取 DSP Graph）',
  tags: ['dsp', 'vst', 'vst3', 'native'],
  anchorType: 'horizontal',
  anchors: [],
  gridFootprint: { width: 3, height: 1 },
  content: '',
  style: {
    height: '36px',
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
