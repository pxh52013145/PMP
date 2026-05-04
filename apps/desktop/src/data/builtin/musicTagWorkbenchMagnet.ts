import { Magnet } from '../../types/pixel';
import { createPanelChromePreset } from '../../modules/magnets/chromePresets';
import {
  STANDARD_PANEL_CHROME_INSET,
  createPanelLayoutPreset,
} from '../../modules/magnets/layoutPresets';

const MUSIC_TAG_WORKBENCH_CHROME = createPanelChromePreset({
  style: {
    backgroundColor: 'rgba(12, 15, 18, 0.68)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
  },
  hoverStyle: {
    border: '1px solid rgba(122, 205, 214, 0.38)',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.24)',
  },
});

const MUSIC_TAG_WORKBENCH_LAYOUT = createPanelLayoutPreset({
  chromeInset: STANDARD_PANEL_CHROME_INSET,
});

export const MUSIC_TAG_WORKBENCH_MAGNET: Magnet = {
  id: 'music-tag-workbench',
  type: 'custom',
  name: 'MusicTag Workbench',
  renderer: 'music-tag-workbench',
  previewText: 'MusicTag',
  description: 'Music metadata tag workbench entry',
  tags: ['music', 'metadata', 'tags', 'lyrics', 'library'],
  runtime: {
    memoryTier: 'light',
    capabilities: ['audio.playback'],
    activation: 'visible',
    backgroundPolicy: 'visible-only',
    warmRetentionMs: 5_000,
    hibernateAfterMs: 20_000,
  },
  anchorType: 'rectangular',
  anchors: [],
  gridFootprint: { width: 27, height: 17 },
  ...MUSIC_TAG_WORKBENCH_LAYOUT,
  content: '',
  style: MUSIC_TAG_WORKBENCH_CHROME.style,
  animation: MUSIC_TAG_WORKBENCH_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: false,
  },
};
