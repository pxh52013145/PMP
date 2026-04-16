import { Magnet } from '../../types/pixel';
import { createControlChromePreset, createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  createCenteredSingleControlLayoutPreset,
  STANDARD_PANEL_CHROME_INSET,
  createPanelLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const PLATFORM_MAGNET_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '24px',
    boxShadow: '0 6px 28px rgba(0, 0, 0, 0.45)',
  },
  hoverStyle: {
    border: '1px solid rgba(255, 255, 255, 0.18)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
  },
});

const PLATFORM_LOGIN_CHROME = createControlChromePreset({
  style: {
    backgroundColor: 'rgba(12, 12, 12, 0.86)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.36)',
  },
  hoverStyle: {
    transform: 'scale(1.04)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    backgroundColor: 'rgba(18, 18, 18, 0.96)',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.36)',
  },
  activeStyle: {
    transform: 'scale(0.96)',
  },
});
const PLATFORM_MAGNET_LAYOUT = createPanelLayoutPreset({
  chromeInset: STANDARD_PANEL_CHROME_INSET,
});
const PLATFORM_LOGIN_LAYOUT = createCenteredSingleControlLayoutPreset();

export const PLATFORM_MAGNET: Magnet = {
  id: 'platform-magnet',
  type: 'navigation',
  name: 'Platform Magnet',
  renderer: 'platform-magnet',
  previewText: 'Platform',
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 27, height: 17 },
  ...PLATFORM_MAGNET_LAYOUT,
  content: '',
  style: PLATFORM_MAGNET_CHROME.style,
  animation: PLATFORM_MAGNET_CHROME.animation,
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
  ...PLATFORM_LOGIN_LAYOUT,
  content: '',
  style: PLATFORM_LOGIN_CHROME.style,
  animation: PLATFORM_LOGIN_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: true,
  },
};

