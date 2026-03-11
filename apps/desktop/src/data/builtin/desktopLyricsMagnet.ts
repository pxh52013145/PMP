import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';

const DESKTOP_LYRICS_CHROME = createControlChromePreset();

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
  style: DESKTOP_LYRICS_CHROME.style,
  animation: DESKTOP_LYRICS_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      console.log('toggle desktop lyrics');
    },
  },
};

