import React from 'react';
import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import {
  getMagnetRenderer,
  registerMagnetRenderer,
  unregisterMagnetRenderer,
  type MagnetRendererDefinition,
} from '../magnet-system/registry';
import { clearMagnetVariants, registerMagnetVariant } from '../magnet-system/variantRegistry';
import { subscribeLocale, t } from '../i18n/core';
import {
  toMagnetVariantDefinitions,
  type MagnetVariantPreset,
} from '../components/magnet/shared/magnetVariantCatalog';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { DSP_VST_VARIANT_PRESETS } from '../components/magnet/dspVstSkin';
import { MATRIX_CHANGE_VARIANT_PRESETS } from '../components/magnet/matrixChangeSkin';
import { PROCESS_PERF_MONITOR_VARIANT_PRESETS } from '../components/magnet/processPerfMonitorSkin';
import { BACK_BUTTON_VARIANT_PRESETS } from '../components/magnet/backButton/backButtonSkin';
import { DESKTOP_LYRICS_VARIANT_PRESETS } from '../components/magnet/desktopLyricsButton/desktopLyricsSkin';
import { DEBUG_BUTTON_VARIANT_PRESETS } from '../components/magnet/debugButton/debugButtonSkin';
import { MUSIC_LIBRARY_VARIANT_PRESETS } from '../components/magnet/musicLibraryButton/musicLibrarySkin';
import { NAVIGATION_PAGE_VARIANT_PRESETS } from '../components/magnet/navigationPage/navigationPageSkin';
import { PLAY_MODE_VARIANT_PRESETS } from '../components/magnet/playMode/playModeSkin';
import { PLAY_PAUSE_VARIANT_PRESETS } from '../components/magnet/playbackControls/playPauseSkin';
import { PLAY_QUEUE_VARIANT_PRESETS } from '../components/magnet/playQueue/playQueueSkin';
import { PLAYBACK_STEP_VARIANT_PRESETS } from '../components/magnet/playbackControls/playbackStepSkin';
import { PLAYLISTS_VARIANT_PRESETS } from '../components/magnet/playlistsButton/playlistsSkin';
import { PROGRESS_BAR_VARIANT_PRESETS } from '../components/magnet/progressBar/progressBarSkin';
import { AUDIO_VISUALIZER_VARIANT_PRESETS } from '../components/magnet/audioVisualizerSkin';
import { VOLUME_VARIANT_PRESETS } from '../components/magnet/volumeControl/volumeSkin';
import { WINDOW_PIN_VARIANT_PRESETS } from '../components/magnet/windowPinButton/windowPinSkin';

const NavigationPageLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/NavigationPage')).NavigationPage,
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
const DesktopLyricsButtonLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/DesktopLyricsButton')).DesktopLyricsButton,
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
const MusicTagWorkbenchMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/musicTagWorkbench/MusicTagWorkbenchMagnet'))
    .MusicTagWorkbenchMagnet,
}));
const PluginDevelopmentWorkspaceMagnetLazy = React.lazy(async () => ({
  default: (await import('../components/magnet/PluginDevelopmentWorkspaceMagnet'))
    .PluginDevelopmentWorkspaceMagnet,
}));
const telemetry = getTelemetryLogger('magnets', 'builtinMagnetRenderersModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      id: 'btn-desktop-lyrics',
      render: () => renderWithLazyBoundary(<DesktopLyricsButtonLazy />),
      preview: () => createTextPreview(t('magnet.renderers.btn-desktop-lyrics.preview')),
      description: t('magnet.renderers.btn-desktop-lyrics.description'),
      group: 'playback',
      tags: ['lyrics', 'desktop', 'overlay', 'native'],
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
    {
      id: 'music-tag-workbench',
      render: () => renderWithLazyBoundary(<MusicTagWorkbenchMagnetLazy />),
      preview: () => createTextPreview(t('magnet.renderers.music-tag-workbench.preview')),
      description: t('magnet.renderers.music-tag-workbench.description'),
      group: 'navigation',
      tags: ['music', 'metadata', 'tags', 'lyrics', 'library'],
      source: 'builtin',
    },
    {
      id: 'plugin-development-workspace',
      render: () => renderWithLazyBoundary(<PluginDevelopmentWorkspaceMagnetLazy />),
      preview: () =>
        createTextPreview(t('magnet.renderers.plugin-development-workspace.preview')),
      description: t('magnet.renderers.plugin-development-workspace.description'),
      group: 'debug',
      tags: ['plugin', 'development', 'workspace', 'extv2'],
      source: 'builtin',
    },
  ];
}

function getBuiltinVariantCatalog(): ReadonlyArray<readonly [string, readonly MagnetVariantPreset<object>[]]> {
  return [
    ['navigation-page', NAVIGATION_PAGE_VARIANT_PRESETS],
    ['btn-window-pin', WINDOW_PIN_VARIANT_PRESETS],
    ['btn-play-pause', PLAY_PAUSE_VARIANT_PRESETS],
    ['btn-previous', PLAYBACK_STEP_VARIANT_PRESETS],
    ['btn-next', PLAYBACK_STEP_VARIANT_PRESETS],
    ['btn-mode', PLAY_MODE_VARIANT_PRESETS],
    ['btn-volume', VOLUME_VARIANT_PRESETS],
    ['btn-desktop-lyrics', DESKTOP_LYRICS_VARIANT_PRESETS],
    ['progress-bar', PROGRESS_BAR_VARIANT_PRESETS],
    ['btn-play-queue', PLAY_QUEUE_VARIANT_PRESETS],
    ['btn-playlists', PLAYLISTS_VARIANT_PRESETS],
    ['btn-music-library', MUSIC_LIBRARY_VARIANT_PRESETS],
    ['btn-back', BACK_BUTTON_VARIANT_PRESETS],
    ['btn-debug', DEBUG_BUTTON_VARIANT_PRESETS],
    ['btn-matrix-change', MATRIX_CHANGE_VARIANT_PRESETS],
    ['process-perf-monitor', PROCESS_PERF_MONITOR_VARIANT_PRESETS],
    ['dsp-vst', DSP_VST_VARIANT_PRESETS],
    ['audio-visualizer', AUDIO_VISUALIZER_VARIANT_PRESETS],
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

        for (const [rendererId, presets] of getBuiltinVariantCatalog()) {
          const existing = getMagnetRenderer(rendererId);
          if (existing && existing.source !== 'builtin') {
            continue;
          }
          clearMagnetVariants(rendererId);
          for (const variant of toMagnetVariantDefinitions(presets, t)) {
            registerMagnetVariant(rendererId, variant, { overwrite: true });
          }
        }
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          telemetry.warn('magnet_renderers.locale_subscription.cleanup_failed', {
            message: readErrorMessage(error),
          });
        }

        for (const definition of getBuiltinDefinitions()) {
          const existing = getMagnetRenderer(definition.id);
          if (existing && existing.source !== 'builtin') {
            continue;
          }
          unregisterMagnetRenderer(definition.id);
        }

        for (const [rendererId] of getBuiltinVariantCatalog()) {
          const existing = getMagnetRenderer(rendererId);
          if (existing && existing.source !== 'builtin') {
            continue;
          }
          clearMagnetVariants(rendererId);
        }
      };
    },
  };
}
