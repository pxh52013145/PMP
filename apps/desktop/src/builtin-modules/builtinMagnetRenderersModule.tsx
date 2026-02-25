import React from 'react';
import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import {
  getMagnetRenderer,
  registerMagnetRenderer,
  unregisterMagnetRenderer,
  type MagnetRendererDefinition,
} from '../magnet-system/registry';
import { subscribeLocale, t } from '../i18n/core';

const NavigationPageLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/NavigationPage')).NavigationPage,
}));
const PlatformMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlatformMagnet')).PlatformMagnet,
}));
const PlatformLoginButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlatformLoginButton')).PlatformLoginButton,
}));
const WindowPinButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/WindowPinButton')).WindowPinButton,
}));
const PlayPauseButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlaybackControls')).PlayPauseButton,
}));
const PreviousButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlaybackControls')).PreviousButton,
}));
const NextButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlaybackControls')).NextButton,
}));
const PlayModeButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlayModeButton')).PlayModeButton,
}));
const VolumeControlLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/VolumeControl')).VolumeControl,
}));
const TrackInfoLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/trackInfo/TrackInfo')).TrackInfo,
}));
const ProgressBarLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/progressBar/ProgressBar')).ProgressBar,
}));
const PlayQueueButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlayQueueButton')).PlayQueueButton,
}));
const PlaylistsButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PlaylistsButton')).PlaylistsButton,
}));
const MusicLibraryButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/MusicLibraryButton')).MusicLibraryButton,
}));
const BackButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/BackButton')).BackButton,
}));
const DebugButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/DebugButton')).DebugButton,
}));
const AudioVisualizerMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/AudioVisualizerMagnet')).AudioVisualizerMagnet,
}));
const MatrixChangeMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/MatrixChangeMagnet')).MatrixChangeMagnet,
}));
const DspVstMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/DspVstMagnet')).DspVstMagnet,
}));
const ProcessPerfMonitorMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/ProcessPerfMonitorMagnet')).ProcessPerfMonitorMagnet,
}));

function renderWithLazyBoundary(node: React.ReactNode): React.ReactNode {
  return <React.Suspense fallback={null}>{node}</React.Suspense>;
}

const createTextPreview = (label: string) => (
  <span className="magnet-preview-label">{label}</span>
);

function getBuiltinDefinitions(): MagnetRendererDefinition[] {
  return [
    {
      id: 'navigation-page',
      render: () => renderWithLazyBoundary(<NavigationPageLazy />),
      preview: () => createTextPreview(t('magnet.renderers.navigation-page.preview')),
      description: t('magnet.renderers.navigation-page.description'),
      group: 'layout',
      source: 'builtin',
    },
    {
      id: 'platform-magnet',
      render: () => renderWithLazyBoundary(<PlatformMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.platform-magnet.preview')),
      description: t('magnet.renderers.platform-magnet.description'),
      group: 'layout',
      tags: ['platform', 'source', 'adapter', 'sangreal'],
      source: 'builtin',
    },
    {
      id: 'btn-platform-login',
      render: () => renderWithLazyBoundary(<PlatformLoginButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-platform-login.preview')),
      description: t('magnet.renderers.btn-platform-login.description'),
      group: 'navigation',
      tags: ['platform', 'auth', 'login'],
      source: 'builtin',
    },
    {
      id: 'process-perf-monitor',
      render: () => renderWithLazyBoundary(<ProcessPerfMonitorMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.process-perf-monitor.preview')),
      description: t('magnet.renderers.process-perf-monitor.description'),
      group: 'debug',
      source: 'builtin',
    },
    {
      id: 'btn-window-pin',
      render: () => renderWithLazyBoundary(<WindowPinButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-window-pin.preview')),
      description: t('magnet.renderers.btn-window-pin.description'),
      group: 'window',
      source: 'builtin',
    },
    {
      id: 'btn-play-pause',
      render: () => renderWithLazyBoundary(<PlayPauseButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-play-pause.preview')),
      description: t('magnet.renderers.btn-play-pause.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-previous',
      render: () => renderWithLazyBoundary(<PreviousButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-previous.preview')),
      description: t('magnet.renderers.btn-previous.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-next',
      render: () => renderWithLazyBoundary(<NextButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-next.preview')),
      description: t('magnet.renderers.btn-next.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-mode',
      render: () => renderWithLazyBoundary(<PlayModeButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-mode.preview')),
      description: t('magnet.renderers.btn-mode.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-volume',
      render: () => renderWithLazyBoundary(<VolumeControlLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-volume.preview')),
      description: t('magnet.renderers.btn-volume.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'track-info',
      render: () => renderWithLazyBoundary(<TrackInfoLazy />),
      preview: () => createTextPreview(t('magnet.renderers.track-info.preview')),
      description: t('magnet.renderers.track-info.description'),
      group: 'information',
      source: 'builtin',
    },
    {
      id: 'progress-bar',
      render: () => renderWithLazyBoundary(<ProgressBarLazy />),
      preview: () => createTextPreview(t('magnet.renderers.progress-bar.preview')),
      description: t('magnet.renderers.progress-bar.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-play-queue',
      render: () => renderWithLazyBoundary(<PlayQueueButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-play-queue.preview')),
      description: t('magnet.renderers.btn-play-queue.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-playlists',
      render: () => renderWithLazyBoundary(<PlaylistsButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-playlists.preview')),
      description: t('magnet.renderers.btn-playlists.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-music-library',
      render: () => renderWithLazyBoundary(<MusicLibraryButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-music-library.preview')),
      description: t('magnet.renderers.btn-music-library.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-back',
      render: () => renderWithLazyBoundary(<BackButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-back.preview')),
      description: t('magnet.renderers.btn-back.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-debug',
      render: () => renderWithLazyBoundary(<DebugButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-debug.preview')),
      description: t('magnet.renderers.btn-debug.description'),
      group: 'utility',
      source: 'builtin',
    },
    {
      id: 'btn-matrix-change',
      render: () => renderWithLazyBoundary(<MatrixChangeMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-matrix-change.preview')),
      description: t('magnet.renderers.btn-matrix-change.description'),
      group: 'space',
      tags: ['space', 'layout'],
      source: 'builtin',
    },
    {
      id: 'dsp-vst',
      render: () => renderWithLazyBoundary(<DspVstMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.dsp-vst.preview')),
      description: t('magnet.renderers.dsp-vst.description'),
      group: 'navigation',
      tags: ['audio', 'dsp', 'vst', 'native'],
      source: 'builtin',
    },
    {
      id: 'audio-visualizer',
      render: () => renderWithLazyBoundary(<AudioVisualizerMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.audio-visualizer.preview')),
      description: t('magnet.renderers.audio-visualizer.description'),
      group: 'visualizer',
      tags: ['audio', 'fft', 'spectrum', 'visualizer', 'native'],
      source: 'builtin',
    },
  ];
}

export function createBuiltinMagnetRenderersModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-magnet-renderers',
    activate: () => {
      const sync = () => {
        for (const definition of getBuiltinDefinitions()) {
          const existing = getMagnetRenderer(definition.id);
          if (existing && existing.source !== 'builtin') {
            continue;
          }
          registerMagnetRenderer(definition, { overwrite: true });
        }
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          console.warn('[builtin-magnet-renderers] locale subscription cleanup failed', error);
        }

        for (const definition of getBuiltinDefinitions()) {
          const existing = getMagnetRenderer(definition.id);
          if (existing && existing.source !== 'builtin') {
            continue;
          }
          unregisterMagnetRenderer(definition.id);
        }
      };
    },
  };
}
