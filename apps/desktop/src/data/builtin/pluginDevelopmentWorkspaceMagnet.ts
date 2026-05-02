import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  STANDARD_PANEL_CHROME_INSET,
  createPanelLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const PLUGIN_DEVELOPMENT_WORKSPACE_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(9, 14, 22, 0.9)',
    border: '1px solid rgba(124, 211, 255, 0.2)',
    borderRadius: '24px',
    boxShadow: '0 14px 42px rgba(0, 0, 0, 0.38)',
  },
  hoverStyle: {
    border: '1px solid rgba(124, 211, 255, 0.32)',
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.46)',
  },
});

const PLUGIN_DEVELOPMENT_WORKSPACE_LAYOUT = createPanelLayoutPreset({
  chromeInset: STANDARD_PANEL_CHROME_INSET,
});

export const PLUGIN_DEVELOPMENT_WORKSPACE_MAGNET: Magnet = {
  id: 'plugin-development-workspace',
  type: 'custom',
  name: 'Plugin Development Workspace',
  renderer: 'plugin-development-workspace',
  previewText: 'Plugin Dev',
  description: 'Host-managed development workspace for ext-v2 plugin dev sessions',
  tags: ['plugin', 'dev', 'workspace', 'extv2'],
  runtime: {
    memoryTier: 'heavy',
    capabilities: ['plugin.runtime'],
    activation: 'visible',
    backgroundPolicy: 'pinned',
    warmRetentionMs: 10_000,
    hibernateAfterMs: 60_000,
  },
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 27, height: 17 },
  ...PLUGIN_DEVELOPMENT_WORKSPACE_LAYOUT,
  content: '',
  style: PLUGIN_DEVELOPMENT_WORKSPACE_CHROME.style,
  animation: PLUGIN_DEVELOPMENT_WORKSPACE_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: false,
    clickable: false,
  },
};
