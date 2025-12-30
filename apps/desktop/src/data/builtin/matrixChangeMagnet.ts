import { Magnet } from '../../types/pixel';

export const MATRIX_CHANGE_MAGNET: Magnet = {
  id: 'btn-matrix-change',
  type: 'custom',
  name: '空间切换',
  renderer: 'btn-matrix-change',
  previewText: 'SPACE',
  description: '管理 Magnet Spaces（点击打开面板）',
  tags: ['space', 'layout'],
  anchorType: 'single',
  anchors: [
    {
      id: 'anchor',
      gridX: 0,
      gridY: 18,
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
