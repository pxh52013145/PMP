import { Magnet } from '../../types/pixel';

export const MATRIX_CHANGE_MAGNET: Magnet = {
  id: 'btn-matrix-change',
  type: 'custom',
  name: '空间切换',
  renderer: 'btn-matrix-change',
  previewText: 'SPACE',
  description: '管理 Magnet Spaces（点击打开面板）',
  tags: ['space', 'layout'],
  anchorType: 'horizontal',
  anchors: [],
  gridFootprint: { width: 3, height: 1 },
  content: '',
  style: {
    height: '36px',
    borderRadius: '2.7px',
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
