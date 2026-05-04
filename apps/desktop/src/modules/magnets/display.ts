import type { Magnet } from '../../types/pixel';

type MagnetTranslator = (key: string, params?: Record<string, unknown>) => string;

const BUILTIN_MAGNET_LABEL_KEYS: Record<string, string> = {
  'navigation-page': 'magnet.renderers.navigation-page.preview',
  'platform-magnet': 'magnet.renderers.platform-magnet.preview',
  'btn-platform-login': 'magnet.renderers.btn-platform-login.preview',
  'process-perf-monitor': 'magnet.renderers.process-perf-monitor.preview',
  'btn-window-pin': 'magnet.renderers.btn-window-pin.preview',
  'btn-play-pause': 'magnet.renderers.btn-play-pause.preview',
  'btn-previous': 'magnet.renderers.btn-previous.preview',
  'btn-next': 'magnet.renderers.btn-next.preview',
  'btn-mode': 'magnet.renderers.btn-mode.preview',
  'btn-volume': 'magnet.renderers.btn-volume.preview',
  'btn-desktop-lyrics': 'magnet.renderers.btn-desktop-lyrics.preview',
  'track-info': 'magnet.renderers.track-info.preview',
  'progress-bar': 'magnet.renderers.progress-bar.preview',
  'btn-play-queue': 'magnet.renderers.btn-play-queue.preview',
  'btn-playlists': 'magnet.renderers.btn-playlists.preview',
  'btn-music-library': 'magnet.renderers.btn-music-library.preview',
  'btn-back': 'magnet.renderers.btn-back.preview',
  'btn-debug': 'magnet.renderers.btn-debug.preview',
  'btn-matrix-change': 'magnet.renderers.btn-matrix-change.preview',
  'dsp-vst': 'magnet.renderers.dsp-vst.preview',
  'audio-visualizer': 'magnet.renderers.audio-visualizer.preview',
  'music-tag-workbench': 'magnet.renderers.music-tag-workbench.preview',
  'plugin-development-workspace': 'magnet.renderers.plugin-development-workspace.preview',
};

type MagnetLabelTarget = Pick<Magnet, 'id' | 'renderer' | 'name'>;
type MagnetPreviewTarget = Pick<Magnet, 'id' | 'renderer' | 'name' | 'previewText'>;

export function getBuiltinMagnetLabelKey(id: string | null | undefined): string | null {
  if (typeof id !== 'string' || id.trim().length === 0) return null;
  return BUILTIN_MAGNET_LABEL_KEYS[id] ?? null;
}

export function getMagnetDisplayName(
  magnet: MagnetLabelTarget,
  translate: MagnetTranslator
): string {
  const key =
    getBuiltinMagnetLabelKey(magnet.renderer ?? magnet.id) ?? getBuiltinMagnetLabelKey(magnet.id);
  if (key) {
    const translated = translate(key);
    if (translated !== key) return translated;
  }

  const name = typeof magnet.name === 'string' ? magnet.name.trim() : '';
  return name || magnet.id;
}

export function getMagnetPreviewText(
  magnet: MagnetPreviewTarget,
  translate: MagnetTranslator
): string | null {
  const key =
    getBuiltinMagnetLabelKey(magnet.renderer ?? magnet.id) ?? getBuiltinMagnetLabelKey(magnet.id);
  if (key) {
    const translated = translate(key);
    if (translated !== key) return translated;
  }

  const previewText = typeof magnet.previewText === 'string' ? magnet.previewText.trim() : '';
  if (previewText) return previewText;

  return getMagnetDisplayName(magnet, translate);
}
