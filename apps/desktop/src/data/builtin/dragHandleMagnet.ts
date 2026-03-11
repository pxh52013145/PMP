import type { Magnet } from '../../types/pixel';

export const DRAG_HANDLE_MAGNET: Magnet = {
  id: 'drag-handle',
  type: 'drag-handle',
  name: '拖动区域',
  anchorType: 'horizontal',
  anchors: [],
  gridFootprint: { width: 9, height: 1 },
  content: '\u22ee\u22ee',
  style: {
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2.7px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.32)',
    fontSize: '15px',
    fontWeight: '700',
    letterSpacing: '2px',
    color: 'rgba(255, 255, 255, 0.62)',
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  animation: {
    transition:
      'transform 140ms ease, background-color 140ms ease, border-color 140ms ease, box-shadow 180ms ease, color 140ms ease',
    hoverStyle: {
      backgroundColor: 'rgba(60, 60, 60, 0.9)',
      border: '1px solid rgba(255, 255, 255, 0.16)',
      transform: 'translateY(-1px)',
      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.36)',
      color: 'rgba(255, 255, 255, 0.82)',
    },
    activeStyle: {
      transform: 'translateY(0)',
      backgroundColor: 'rgba(32, 32, 32, 0.92)',
      border: '1px solid rgba(255, 255, 255, 0.22)',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
      color: 'rgba(255, 255, 255, 0.92)',
    },
    dragStyle: {
      backgroundColor: 'rgba(76, 76, 76, 0.96)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.42)',
      color: 'rgba(255, 255, 255, 0.96)',
      cursor: 'grabbing',
    },
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};
