import type { PixelAnchor } from '../../types/pixel';

function clonePixelAnchors(anchors: PixelAnchor[]): PixelAnchor[] {
  return anchors.map((anchor) => ({ ...anchor }));
}

export const SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID: Record<string, PixelAnchor[]> = {
  'drag-handle': [
    { id: 'left', gridX: 8, gridY: 0, role: 'anchor' },
    { id: 'right', gridX: 16, gridY: 0, role: 'boundary' },
  ],
  'btn-window-pin': [{ id: 'anchor', gridX: 20, gridY: 0, role: 'anchor' }],
  'btn-minimize': [{ id: 'anchor', gridX: 22, gridY: 0, role: 'anchor' }],
  'btn-maximize': [{ id: 'anchor', gridX: 24, gridY: 0, role: 'anchor' }],
  'btn-close': [{ id: 'anchor', gridX: 26, gridY: 0, role: 'anchor' }],
  'btn-matrix-change': [{ id: 'anchor', gridX: 0, gridY: 18, role: 'anchor' }],
  'btn-editor': [{ id: 'anchor', gridX: 19, gridY: 18, role: 'anchor' }],
};

export const SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID: Record<string, PixelAnchor[]> = {
  ...SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID,
  'btn-back': [{ id: 'anchor', gridX: 6, gridY: 0, role: 'anchor' }],
  'navigation-page': [
    { id: 'top-left', gridX: 6, gridY: 1, role: 'anchor' },
    { id: 'top-right', gridX: 26, gridY: 1, role: 'boundary' },
    { id: 'bottom-left', gridX: 6, gridY: 17, role: 'boundary' },
    { id: 'bottom-right', gridX: 26, gridY: 17, role: 'boundary' },
  ],
  'track-info': [
    { id: 'top-left', gridX: 0, gridY: 14, role: 'anchor' },
    { id: 'top-right', gridX: 5, gridY: 14, role: 'boundary' },
    { id: 'bottom-left', gridX: 0, gridY: 17, role: 'boundary' },
    { id: 'bottom-right', gridX: 5, gridY: 17, role: 'boundary' },
  ],
  'progress-bar': [
    { id: 'left', gridX: 0, gridY: 19, role: 'anchor' },
    { id: 'right', gridX: 26, gridY: 19, role: 'boundary' },
  ],
  'btn-previous': [{ id: 'anchor', gridX: 9, gridY: 18, role: 'anchor' }],
  'btn-play-pause': [{ id: 'anchor', gridX: 11, gridY: 18, role: 'anchor' }],
  'btn-next': [{ id: 'anchor', gridX: 13, gridY: 18, role: 'anchor' }],
  'btn-mode': [{ id: 'anchor', gridX: 15, gridY: 18, role: 'anchor' }],
  'btn-volume': [{ id: 'anchor', gridX: 17, gridY: 18, role: 'anchor' }],
  'dsp-vst': [{ id: 'anchor', gridX: 6, gridY: 18, role: 'anchor' }],
  'btn-play-queue': [{ id: 'anchor', gridX: 21, gridY: 18, role: 'anchor' }],
  'btn-playlists': [{ id: 'anchor', gridX: 23, gridY: 18, role: 'anchor' }],
  'btn-music-library': [{ id: 'anchor', gridX: 25, gridY: 18, role: 'anchor' }],
};

export function getSystemAnchorsByMagnetId(spaceId: string): Record<string, PixelAnchor[]> {
  const normalized = spaceId.trim();
  if (normalized === 'space1') return SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID;
  return SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID;
}

export function getSystemAnchorsForActiveMagnets(
  spaceId: string,
  activeMagnetIds: ReadonlySet<string>
): Record<string, PixelAnchor[]> {
  const systemAnchors = getSystemAnchorsByMagnetId(spaceId);
  const result: Record<string, PixelAnchor[]> = {};
  for (const [magnetId, anchors] of Object.entries(systemAnchors)) {
    if (!activeMagnetIds.has(magnetId)) continue;
    result[magnetId] = clonePixelAnchors(anchors);
  }
  return result;
}

