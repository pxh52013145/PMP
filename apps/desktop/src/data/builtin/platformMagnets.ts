import { Magnet } from '../../types/pixel';

export const PLATFORM_MAGNET: Magnet = {
  id: 'platform-magnet',
  type: 'navigation',
  name: 'Platform Magnet',
  renderer: 'platform-magnet',
  previewText: 'Platform',
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 27, height: 17 },
  content: '',
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '2.7px',
    overflow: 'hidden',
    boxShadow: '0 6px 28px rgba(0, 0, 0, 0.45)',
  },
  animation: {
    transition: 'all 0.3s ease',
    hoverStyle: {
      border: '1px solid rgba(255, 255, 255, 0.18)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};

export const PLATFORM_LOGIN_MAGNET: Magnet = {
  id: 'btn-platform-login',
  type: 'navigation',
  name: 'Platform Login',
  renderer: 'btn-platform-login',
  previewText: 'Login',
  anchorType: 'single',
  anchors: [],
  content: '',
  style: {
    width: '36px',
    height: '36px',
    backgroundColor: 'rgba(12, 12, 12, 0.86)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '2.7px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.36)',
  },
  animation: {
    transition: 'all 0.2s ease',
    hoverStyle: {
      transform: 'scale(1.04)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      backgroundColor: 'rgba(18, 18, 18, 0.96)',
    },
    activeStyle: {
      transform: 'scale(0.96)',
    },
  },
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
  },
};

