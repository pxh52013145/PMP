import { Magnet } from '../../types/pixel';

export const MATRIX_CHANGE_MAGNET: Magnet = {
  id: 'btn-matrix-change',
  type: 'custom',
  name: 'Matrix Switch',
  renderer: 'btn-matrix-change',
  previewText: 'M1/M2',
  description: '切换 Matrix 1 / Matrix 2（Workbench layout）',
  tags: ['layout', 'workbench', 'matrix'],
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 2,
      gridY: 19,
      role: 'anchor',
    },
  ],
  content: '',
  style: {
    width: '78px',
    height: '36px',
    borderRadius: '10px',
    overflow: 'hidden',
  },
  animation: {
    transition: 'all 0.2s ease',
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};

