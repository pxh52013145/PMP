import { Magnet } from '../../types/pixel';
import { createControlChromePreset } from '../../modules/magnets/chromePresets';
import { createCenteredSingleControlLayoutPreset } from '../../modules/magnets/layoutPresets';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';

const DESKTOP_LYRICS_CHROME = createControlChromePreset();
const DESKTOP_LYRICS_LAYOUT = createCenteredSingleControlLayoutPreset();
const telemetry = getTelemetryLogger('magnets', 'desktopLyricsMagnet');

export const DESKTOP_LYRICS_MAGNET: Magnet = {
  id: 'btn-desktop-lyrics',
  type: 'player',
  name: 'Desktop Lyrics',
  renderer: 'btn-desktop-lyrics',
  previewText: 'Lyrics',
  description: 'Toggle desktop lyrics overlay',
  anchorType: 'single',
  anchors: [],
  ...DESKTOP_LYRICS_LAYOUT,
  content: 'LRC',
  style: DESKTOP_LYRICS_CHROME.style,
  animation: DESKTOP_LYRICS_CHROME.animation,
  state: 'idle',
  interactions: {
    draggable: true,
    clickable: true,
    onClick: () => {
      telemetry.debug('desktop_lyrics.toggle.clicked');
    },
  },
};

