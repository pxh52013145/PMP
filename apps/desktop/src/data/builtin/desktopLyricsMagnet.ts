import { Magnet } from '../../types/pixel';

export const DESKTOP_LYRICS_MAGNET: Magnet = {
  id: 'btn-desktop-lyrics',
  type: 'player',
  name: 'Desktop Lyrics',
  renderer: 'btn-desktop-lyrics',
  previewText: 'Lyrics',
  description: 'Toggle desktop lyrics overlay',
  anchorType: 'single',
  anchors: [],
  content: 'LRC',
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2.7px',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.05)',
      backgroundColor: 'rgba(60, 60, 60, 0.9)',
      boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
    },
    activeStyle: {
      transform: 'scale(0.95)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('toggle desktop lyrics');
    },
  },
};

