import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import { NavigationPage } from '../components/magnet/NavigationPage';
import { WindowPinButton } from '../components/magnet/WindowPinButton';
import { PlayPauseButton, PreviousButton, NextButton } from '../components/magnet/PlaybackControls';
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
import { MatrixChangeMagnet } from '../components/magnet/MatrixChangeMagnet';
import { DspVstMagnet } from '../components/magnet/DspVstMagnet';
import { ProcessPerfMonitorMagnet } from '../components/magnet/ProcessPerfMonitorMagnet';
import {
  getMagnetRenderer,
  registerMagnetRenderer,
  unregisterMagnetRenderer,
  type MagnetRendererDefinition,
} from '../magnet-system/registry';
import { clearMagnetVariants, listMagnetVariants, registerMagnetVariant } from '../magnet-system/variantRegistry';
import { subscribeLocale, t } from '../i18n/core';

const createTextPreview = (label: string) => (
  <span className="magnet-preview-label">{label}</span>
);

function getBuiltinDefinitions(): MagnetRendererDefinition[] {
  return [
    {
      id: 'navigation-page',
      render: () => <NavigationPage />,
      preview: () => createTextPreview(t('magnet.renderers.navigation-page.preview')),
      description: t('magnet.renderers.navigation-page.description'),
      group: 'layout',
      source: 'builtin',
    },
    {
      id: 'process-perf-monitor',
      render: () => <ProcessPerfMonitorMagnet />,
      preview: () => createTextPreview(t('magnet.renderers.process-perf-monitor.preview')),
      description: t('magnet.renderers.process-perf-monitor.description'),
      group: 'debug',
      source: 'builtin',
    },
    {
      id: 'btn-window-pin',
      render: () => <WindowPinButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-window-pin.preview')),
      description: t('magnet.renderers.btn-window-pin.description'),
      group: 'window',
      source: 'builtin',
    },
    {
      id: 'btn-play-pause',
      render: () => <PlayPauseButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-play-pause.preview')),
      description: t('magnet.renderers.btn-play-pause.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-previous',
      render: () => <PreviousButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-previous.preview')),
      description: t('magnet.renderers.btn-previous.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-next',
      render: () => <NextButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-next.preview')),
      description: t('magnet.renderers.btn-next.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-mode',
      render: () => <PlayModeButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-mode.preview')),
      description: t('magnet.renderers.btn-mode.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-volume',
      render: () => <VolumeControl />,
      preview: () => createTextPreview(t('magnet.renderers.btn-volume.preview')),
      description: t('magnet.renderers.btn-volume.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'track-info',
      render: () => <TrackInfo />,
      preview: () => createTextPreview(t('magnet.renderers.track-info.preview')),
      description: t('magnet.renderers.track-info.description'),
      group: 'information',
      source: 'builtin',
    },
    {
      id: 'progress-bar',
      render: () => <ProgressBar />,
      preview: () => createTextPreview(t('magnet.renderers.progress-bar.preview')),
      description: t('magnet.renderers.progress-bar.description'),
      group: 'playback',
      source: 'builtin',
    },
    {
      id: 'btn-play-queue',
      render: () => <PlayQueueButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-play-queue.preview')),
      description: t('magnet.renderers.btn-play-queue.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-playlists',
      render: () => <PlaylistsButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-playlists.preview')),
      description: t('magnet.renderers.btn-playlists.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-music-library',
      render: () => <MusicLibraryButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-music-library.preview')),
      description: t('magnet.renderers.btn-music-library.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-back',
      render: () => <BackButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-back.preview')),
      description: t('magnet.renderers.btn-back.description'),
      group: 'navigation',
      source: 'builtin',
    },
    {
      id: 'btn-debug',
      render: () => <DebugButton />,
      preview: () => createTextPreview(t('magnet.renderers.btn-debug.preview')),
      description: t('magnet.renderers.btn-debug.description'),
      group: 'utility',
      source: 'builtin',
    },
    {
      id: 'btn-matrix-change',
      render: () => <MatrixChangeMagnet />,
      preview: () => createTextPreview(t('magnet.renderers.btn-matrix-change.preview')),
      description: t('magnet.renderers.btn-matrix-change.description'),
      group: 'space',
      tags: ['space', 'layout'],
      source: 'builtin',
    },
    {
      id: 'dsp-vst',
      render: () => <DspVstMagnet />,
      preview: () => createTextPreview(t('magnet.renderers.dsp-vst.preview')),
      description: t('magnet.renderers.dsp-vst.description'),
      group: 'navigation',
      tags: ['audio', 'dsp', 'vst', 'native'],
      source: 'builtin',
    },
    {
      id: 'audio-visualizer',
      render: () => <AudioVisualizerMagnet />,
      preview: () => createTextPreview(t('magnet.renderers.audio-visualizer.preview')),
      description: t('magnet.renderers.audio-visualizer.description'),
      group: 'visualizer',
      tags: ['audio', 'fft', 'spectrum', 'visualizer', 'native'],
      source: 'builtin',
    },
  ];
}

const BUILTIN_VARIANT_RENDERERS = new Set<string>([
  'track-info',
  'progress-bar',
  'btn-play-pause',
  'btn-previous',
  'btn-next',
  'btn-mode',
  'btn-back',
  'btn-volume',
  'btn-window-pin',
  'navigation-page',
  'btn-debug',
  'btn-play-queue',
  'btn-playlists',
  'btn-music-library',
]);

function registerBuiltinVariants(): void {
  const register = (rendererId: string, id: string, label: string, description?: string) => {
    const existing = listMagnetVariants(rendererId).find((variant) => variant.id === id) ?? null;
    if (existing && existing.source !== 'builtin') {
      return;
    }

    registerMagnetVariant(
      rendererId,
      {
        id,
        label,
        description,
        source: 'builtin',
      },
      { overwrite: true }
    );
  };

  const labelDefault = t('magnet.variant.default');
  const labelStandard = t('magnet.variant.standard');
  const labelMinimal = t('magnet.variant.minimal');
  const labelRounded = t('magnet.variant.rounded');
  const labelCyber = t('magnet.variant.cyber');
  const labelCard = t('magnet.variant.card');
  const labelSpinningVinyl = t('magnet.variant.spinningVinyl');
  const labelCoverGlow = t('magnet.variant.coverGlow');

  register(
    'track-info',
    'default',
    labelDefault,
    t('magnet.variant.track-info.default.description')
  );
  register('track-info', 'spinning-vinyl', labelSpinningVinyl);
  register('track-info', 'minimal', labelMinimal);
  register('track-info', 'card', labelCard);

  register('progress-bar', 'default', labelDefault);
  register('progress-bar', 'standard', labelStandard);
  register('progress-bar', 'minimal', labelMinimal);

  register('btn-play-pause', 'default', labelDefault);
  register('btn-play-pause', 'standard', labelStandard);
  register('btn-play-pause', 'rounded', labelRounded);
  register(
    'btn-play-pause',
    'cover-glow',
    labelCoverGlow,
    t('magnet.variant.btn-play-pause.coverGlow.description')
  );

  register('btn-previous', 'default', labelDefault);
  register('btn-previous', 'standard', labelStandard);
  register('btn-previous', 'rounded', labelRounded);

  register('btn-next', 'default', labelDefault);
  register('btn-next', 'standard', labelStandard);
  register('btn-next', 'rounded', labelRounded);

  register('btn-mode', 'default', labelDefault);
  register('btn-mode', 'standard', labelStandard);
  register('btn-mode', 'minimal', labelMinimal);

  register('btn-back', 'default', labelDefault);
  register('btn-back', 'standard', labelStandard);
  register('btn-back', 'rounded', labelRounded);

  register('btn-volume', 'default', labelDefault);
  register('btn-volume', 'standard', labelStandard);
  register('btn-volume', 'cyber', labelCyber);

  register('btn-window-pin', 'default', labelDefault);
  register('btn-window-pin', 'standard', labelStandard);

  register('navigation-page', 'default', labelDefault);
  register('navigation-page', 'standard', labelStandard);

  register('btn-debug', 'default', labelDefault);
  register('btn-debug', 'standard', labelStandard);

  register('btn-play-queue', 'default', labelDefault);
  register('btn-play-queue', 'standard', labelStandard);

  register('btn-playlists', 'default', labelDefault);
  register('btn-playlists', 'standard', labelStandard);

  register('btn-music-library', 'default', labelDefault);
  register('btn-music-library', 'standard', labelStandard);
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
        registerBuiltinVariants();
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
        for (const rendererId of BUILTIN_VARIANT_RENDERERS) {
          clearMagnetVariants(rendererId);
        }
      };
    },
  };
}
