import { ReactNode } from 'react';
import { NavigationPage } from '../components/magnet/NavigationPage';
import { WindowPinButton } from '../components/magnet/WindowPinButton';
import {
  PlayPauseButton,
  PreviousButton,
  NextButton,
} from '../components/magnet/PlaybackControls';
import { PlayModeButton } from '../components/magnet/PlayModeButton';
import { VolumeControl } from '../components/magnet/VolumeControl';
import { TrackInfo } from '../components/magnet/trackInfo/TrackInfo';
import { ProgressBar } from '../components/magnet/progressBar/ProgressBar';
import { PlayQueueButton } from '../components/magnet/PlayQueueButton';
import { PlaylistsButton } from '../components/magnet/PlaylistsButton';
import { MusicLibraryButton } from '../components/magnet/MusicLibraryButton';
import { BackButton } from '../components/magnet/BackButton';
import { DebugButton } from '../components/magnet/DebugButton';
import { AudioVisualizerMagnet } from '../components/magnet/AudioVisualizerMagnet';
import { Magnet } from '../types/pixel';
import { registerMagnetVariant } from './variantRegistry';

export type MagnetRendererSource = 'builtin' | 'plugin' | 'runtime';

export interface MagnetRendererDefinition {
  id: string;
  render: () => ReactNode;
  preview?: ReactNode | (() => ReactNode);
  description?: string;
  group?: string;
  tags?: string[];
  source?: MagnetRendererSource;
  metadata?: Record<string, unknown>;
}

type RendererMap = Map<string, MagnetRendererDefinition>;

const rendererRegistry: RendererMap = new Map();

function normalizePreview(preview?: ReactNode | (() => ReactNode)): ReactNode | undefined {
  if (typeof preview === 'function') {
    return (preview as () => ReactNode)();
  }
  return preview;
}

export interface RegisterOptions {
  overwrite?: boolean;
}

export function registerMagnetRenderer(
  definition: MagnetRendererDefinition,
  options: RegisterOptions = {}
): void {
  const { id } = definition;
  if (!id) {
    throw new Error('Magnet renderer id is required');
  }

  const exists = rendererRegistry.has(id);
  if (exists && options.overwrite === false) {
    console.warn(`[MagnetRegistry] Renderer "${id}" already exists, skip registering`);
    return;
  }

  rendererRegistry.set(id, definition);
}

export function unregisterMagnetRenderer(id: string): void {
  rendererRegistry.delete(id);
}

export function clearMagnetRenderers(): void {
  rendererRegistry.clear();
}

export function getMagnetRenderer(id: string): MagnetRendererDefinition | null {
  ensureBuiltinRenderers();
  return rendererRegistry.get(id) || null;
}

export function getMagnetPreviewNode(magnet: Magnet): ReactNode | null {
  const rendererId = magnet.renderer ?? magnet.id;
  const entry =
    getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
  return normalizePreview(entry?.preview) ?? magnet.previewText ?? null;
}

export function listRegisteredMagnetRenderers(): MagnetRendererDefinition[] {
  ensureBuiltinRenderers();
  return Array.from(rendererRegistry.values());
}

const createTextPreview = (label: string) => (
  <span className="magnet-preview-label">{label}</span>
);

let builtinRegistered = false;
let builtinVariantsRegistered = false;

function ensureBuiltinRenderers() {
  if (builtinRegistered) return;

  const builtinDefinitions: MagnetRendererDefinition[] = [
    {
      id: 'navigation-page',
      render: () => <NavigationPage />,
      preview: () => createTextPreview('Navigation'),
      description: '主内容导航区域',
      group: 'layout',
      source: 'builtin',
    },
    {
      id: 'btn-window-pin',
      render: () => <WindowPinButton />,
      preview: () => createTextPreview('PIN'),
      description: '窗口置顶',
      group: 'window',
      source: 'builtin',
    },
    {
      id: 'btn-play-pause',
      render: () => <PlayPauseButton />,
      preview: () => createTextPreview('▶ / ⏸'),
      description: '播放/暂停控制',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-previous',
      render: () => <PreviousButton />,
      preview: () => createTextPreview('Prev'),
      description: '上一首',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-next',
      render: () => <NextButton />,
      preview: () => createTextPreview('Next'),
      description: '下一首',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-mode',
      render: () => <PlayModeButton />,
      preview: () => createTextPreview('Mode'),
      description: '播放模式',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-volume',
      render: () => <VolumeControl />,
      preview: () => createTextPreview('Vol'),
      description: '音量控制',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'track-info',
      render: () => <TrackInfo />,
      preview: () => createTextPreview('Track Info'),
      description: '当前歌曲信息',
      group: 'information',
      source: 'builtin',
    },
    {
      id: 'progress-bar',
      render: () => <ProgressBar />,
      preview: () => createTextPreview('Progress'),
      description: '播放进度',
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-play-queue',
      render: () => <PlayQueueButton />,
      preview: () => createTextPreview('Queue'),
      description: '播放队列',
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-playlists',
      render: () => <PlaylistsButton />,
      preview: () => createTextPreview('Playlists'),
      description: '歌单列表',
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-music-library',
      render: () => <MusicLibraryButton />,
      preview: () => createTextPreview('Library'),
      description: '音乐媒体库',
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-back',
      render: () => <BackButton />,
      preview: () => createTextPreview('Back'),
      description: '返回按钮',
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-debug',
      render: () => <DebugButton />,
      preview: () => createTextPreview('Debug'),
      description: '主题/调试按钮',
      group: 'utility',
      source: 'builtin',
    },
    {
      id: 'audio-visualizer',
      render: () => <AudioVisualizerMagnet />,
      preview: () => createTextPreview('Visualizer'),
      description: '音频频谱可视化（FFT）',
      group: 'visualizer',
      tags: ['audio', 'fft', 'spectrum', 'visualizer', 'native'],
      source: 'builtin',
    },
  ];

  builtinDefinitions.forEach((definition) => registerMagnetRenderer(definition, { overwrite: false }));
  builtinRegistered = true;
  ensureBuiltinVariants();
}

function ensureBuiltinVariants() {
  if (builtinVariantsRegistered) return;

  const register = (rendererId: string, id: string, label: string, description?: string) => {
    registerMagnetVariant(
      rendererId,
      {
        id,
        label,
        description,
        source: 'builtin',
      },
      { overwrite: false }
    );
  };

  register('track-info', 'default', 'Default', 'Track info default variant');
  register('track-info', 'spinning-vinyl', 'Spinning Vinyl');
  register('track-info', 'minimal', 'Minimal');
  register('track-info', 'card', 'Card');

  register('progress-bar', 'default', 'Default');
  register('progress-bar', 'standard', 'Standard');
  register('progress-bar', 'minimal', 'Minimal');

  register('btn-play-pause', 'default', 'Default');
  register('btn-play-pause', 'standard', 'Standard');
  register('btn-play-pause', 'rounded', 'Rounded');

  register('btn-previous', 'default', 'Default');
  register('btn-previous', 'standard', 'Standard');
  register('btn-previous', 'rounded', 'Rounded');

  register('btn-next', 'default', 'Default');
  register('btn-next', 'standard', 'Standard');
  register('btn-next', 'rounded', 'Rounded');

  register('btn-mode', 'default', 'Default');
  register('btn-mode', 'standard', 'Standard');
  register('btn-mode', 'minimal', 'Minimal');

  register('btn-back', 'default', 'Default');
  register('btn-back', 'standard', 'Standard');
  register('btn-back', 'rounded', 'Rounded');

  register('btn-volume', 'default', 'Default');
  register('btn-volume', 'standard', 'Standard');
  register('btn-volume', 'cyber', 'Cyber');

  register('btn-window-pin', 'default', 'Default');
  register('btn-window-pin', 'standard', 'Standard');

  register('navigation-page', 'default', 'Default');
  register('navigation-page', 'standard', 'Standard');

  register('btn-debug', 'default', 'Default');
  register('btn-debug', 'standard', 'Standard');

  register('btn-play-queue', 'default', 'Default');
  register('btn-play-queue', 'standard', 'Standard');

  register('btn-playlists', 'default', 'Default');
  register('btn-playlists', 'standard', 'Standard');

  register('btn-music-library', 'default', 'Default');
  register('btn-music-library', 'standard', 'Standard');

  builtinVariantsRegistered = true;
}
