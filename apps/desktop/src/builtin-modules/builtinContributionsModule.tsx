import React from 'react';
import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { PageContribution, SettingsPanelContribution, WindowContribution } from '../contracts/contributions';
import { parseNavigationParams } from '../contracts/navigationParams';
import type { Track } from '../services/audio';
import { useAudioService } from '../contexts/AudioEngineContext';
import { calculateWindowPosition, openEditorWindow, type EditorWindowType } from '../utils/editorWindows';
import { closeVstManagerWindow, openVstManagerWindow } from '../utils/vstManagerWindows';
import { subscribeLocale, t } from '../i18n/core';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

const telemetry = getTelemetryLogger('navigation', 'builtinContributionsModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const HomePageLazy = React.lazy(async () => ({ default: (await import('../components/pages/HomePage')).HomePage }));
const SettingsPageLazy = React.lazy(async () => ({ default: (await import('../components/pages/SettingsPage')).SettingsPage }));
const KeyboardShortcutsPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/KeyboardShortcutsPage')).KeyboardShortcutsPage,
}));
const MusicLibraryLazy = React.lazy(async () => ({ default: (await import('../components/pages/MusicLibrary')).MusicLibrary }));
const TrackDetailPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/TrackDetailPage')).TrackDetailPage,
}));
const AlbumDetailPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/AlbumDetailPage')).AlbumDetailPage,
}));
const DebugCenterPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/DebugCenterPage')).DebugCenterPage,
}));
const NativeDebugPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/NativeDebugPage')).NativeDebugPage,
}));
const PerfMonitorPageLazy = React.lazy(async () => ({
  default: (await import('../components/pages/PerfMonitorPage')).PerfMonitorPage,
}));
const DebugPageLazy = React.lazy(async () => ({ default: (await import('../components/pages/DebugPage')).DebugPage }));
const DspRackPageLazy = React.lazy(async () => ({ default: (await import('../components/pages/DspRackPage')).DspRackPage }));
const AudioComponentsSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/AudioComponentsSettingsPanel')).AudioComponentsSettingsPanel,
}));
const AudioBufferSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/AudioBufferSettingsPanel')).AudioBufferSettingsPanel,
}));
const AudioEngineAdvancedSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/AudioEngineAdvancedSettingsPanel')).AudioEngineAdvancedSettingsPanel,
}));
const AudioDspSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/AudioDspSettingsPanel')).AudioDspSettingsPanel,
}));
const LanguageSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/LanguageSettingsPanel')).LanguageSettingsPanel,
}));
const WindowCloseSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/WindowCloseSettingsPanel')).WindowCloseSettingsPanel,
}));
const SystemDemoSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/SystemDemoSettingsPanel')).SystemDemoSettingsPanel,
}));
const PerformanceSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/PerformanceSettingsPanel')).PerformanceSettingsPanel,
}));
const PluginsSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/PluginsSettingsPanel')).PluginsSettingsPanel,
}));
const VisualizersSettingsPanelLazy = React.lazy(async () => ({
  default: (await import('../components/settings-panels/VisualizersSettingsPanel')).VisualizersSettingsPanel,
}));
const PluginPageHostLazy = React.lazy(async () => ({
  default: (await import('../magnet-system/plugins/PluginPageHost')).PluginPageHost,
}));
const PluginVisualizerHostLazy = React.lazy(async () => ({
  default: (await import('../magnet-system/plugins/PluginVisualizerHost')).PluginVisualizerHost,
}));

function LazyLoadingFallback() {
  return <PlaceholderPage icon="..." text={t('common.state.loading')} cssClass="page-loading" />;
}

function renderWithLazyBoundary(node: React.ReactNode) {
  return <React.Suspense fallback={<LazyLoadingFallback />}>{node}</React.Suspense>;
}

export function createBuiltinContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-contributions',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();

      const register = <T extends { kind: string; id: string }>(contribution: T) => {
        const key = `${contribution.kind}/${contribution.id}`;
        const unregister = contributions.register(contribution, { replace: true });
        unregisters.set(key, unregister);
      };

      const registerEditorWindow = (type: EditorWindowType, title: string) => {
        register<WindowContribution>({
          kind: 'window',
          id: `editor:${type}`,
          title,
          label: `editor-${type}`,
          route: `/#/editor/${type}`,
          source: 'builtin',
          open: async () => {
            const position = await calculateWindowPosition(type);
            await openEditorWindow({ type, ...position });
          },
        });
      };

      const sync = () => {
        // Pages
        register<PageContribution>({
          kind: 'page',
          id: 'home',
          title: t('pages.home.title'),
          render: () => renderWithLazyBoundary(<HomePageLazy />),
          source: 'builtin',
          order: 10,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'settings',
          title: t('pages.settings.title'),
          render: () => renderWithLazyBoundary(<SettingsPageLazy />),
          source: 'builtin',
          order: 20,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'keyboard-shortcuts',
          title: t('pages.keyboard-shortcuts.title'),
          render: () => renderWithLazyBoundary(<KeyboardShortcutsPageLazy />),
          source: 'builtin',
          order: 25,
          group: 'core',
          tags: ['core', 'keybindings'],
        });

        // Settings panels (rendered inside SettingsPage)
        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'language',
          title: t('settings.panels.language.title'),
          render: () => renderWithLazyBoundary(<LanguageSettingsPanelLazy />),
          source: 'builtin',
          order: 1,
          group: 'core',
          metadata: { settingsSection: 'system' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'window-close',
          title: t('settings.panels.windowClose.title'),
          description: t('settings.panels.windowClose.desc'),
          render: () => renderWithLazyBoundary(<WindowCloseSettingsPanelLazy />),
          source: 'builtin',
          order: 7,
          group: 'core',
          metadata: { settingsSection: 'system' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'performance',
          title: t('settings.panels.performance.title'),
          render: () => renderWithLazyBoundary(<PerformanceSettingsPanelLazy />),
          source: 'builtin',
          order: 10,
          group: 'core',
          metadata: { settingsSection: 'system' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'system-demo',
          title: t('settings.panels.systemDemo.title'),
          description: t('settings.panels.systemDemo.desc'),
          render: () => renderWithLazyBoundary(<SystemDemoSettingsPanelLazy />),
          source: 'builtin',
          order: 12,
          group: 'core',
          metadata: { settingsSection: 'system' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-engine-advanced',
          title: t('settings.panels.audioAdvanced.title'),
          description: t('settings.panels.audioAdvanced.desc'),
          render: () => renderWithLazyBoundary(<AudioEngineAdvancedSettingsPanelLazy />),
          source: 'builtin',
          order: 24,
          group: 'audio',
          metadata: { settingsSection: 'audio' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-components',
          title: t('settings.panels.audioComponents.title'),
          description: t('settings.panels.audioComponents.desc'),
          render: () => renderWithLazyBoundary(<AudioComponentsSettingsPanelLazy />),
          source: 'builtin',
          order: 21,
          group: 'audio',
          metadata: { settingsSection: 'audio' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-dsp',
          title: t('settings.panels.audioDsp.title'),
          description: t('settings.panels.audioDsp.desc'),
          render: () => renderWithLazyBoundary(<AudioDspSettingsPanelLazy />),
          source: 'builtin',
          order: 23,
          group: 'audio',
          metadata: { settingsSection: 'audio' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-buffer',
          title: t('settings.panels.audioBuffer.title'),
          description: t('settings.panels.audioBuffer.desc'),
          render: () => renderWithLazyBoundary(<AudioBufferSettingsPanelLazy />),
          source: 'builtin',
          order: 22,
          group: 'audio',
          metadata: { settingsSection: 'audio' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'plugins',
          title: t('settings.panels.plugins.title'),
          render: () => renderWithLazyBoundary(<PluginsSettingsPanelLazy />),
          source: 'builtin',
          order: 30,
          group: 'plugin',
          metadata: { settingsSection: 'plugins' },
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'visualizers',
          title: t('settings.panels.visualizers.title'),
          render: () => renderWithLazyBoundary(<VisualizersSettingsPanelLazy />),
          source: 'builtin',
          order: 40,
          group: 'visualizer',
          metadata: { settingsSection: 'visualizers' },
        });

        register<PageContribution>({
          kind: 'page',
          id: 'music-library',
          title: t('pages.music-library.title'),
          render: () => renderWithLazyBoundary(<BuiltinMusicLibraryPage />),
          source: 'builtin',
          order: 30,
          group: 'core',
          tags: ['music', 'library'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'track',
          title: t('pages.track.title'),
          render: (page) => {
            const params = parseNavigationParams('track', page.params);
            return renderWithLazyBoundary(<TrackDetailPageLazy trackId={params?.trackId} />);
          },
          source: 'builtin',
          order: 40,
          group: 'details',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'album',
          title: t('pages.album.title'),
          render: (page) => {
            const params = parseNavigationParams('album', page.params);
            return renderWithLazyBoundary(
              <AlbumDetailPageLazy albumName={params?.albumName} artist={params?.artist} />
            );
          },
          source: 'builtin',
          order: 50,
          group: 'details',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'playlists',
          title: t('pages.playlists.title'),
          render: () => (
            <PlaceholderPage
              icon="?"
              text={t('pages.playlists.placeholder')}
              cssClass="page-playlists"
            />
          ),
          source: 'builtin',
          order: 60,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'play-queue',
          title: t('pages.play-queue.title'),
          render: () => (
            <PlaceholderPage
              icon="?"
              text={t('pages.play-queue.placeholder')}
              cssClass="page-play-queue"
            />
          ),
          source: 'builtin',
          order: 70,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'artist',
          title: t('pages.artist.title'),
          render: () => <PlaceholderPage icon="?" text={t('pages.artist.placeholder')} cssClass="page-artist" />,
          source: 'builtin',
          order: 80,
          group: 'details',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'debug-center',
          title: t('pages.debug-center.title'),
          render: () => renderWithLazyBoundary(<DebugCenterPageLazy />),
          source: 'builtin',
          order: 88,
          group: 'debug',
          tags: ['debug'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'debug',
          title: t('pages.debug.title'),
          render: () => renderWithLazyBoundary(<DebugPageLazy />),
          source: 'builtin',
          order: 89,
          group: 'core',
          tags: ['debug'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'perf-monitor',
          title: t('pages.perf-monitor.title'),
          render: () => renderWithLazyBoundary(<PerfMonitorPageLazy />),
          source: 'builtin',
          order: 90,
          group: 'debug',
          tags: ['debug', 'perf', 'webview2'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'native-debug',
          title: t('pages.native-debug.title'),
          render: () => renderWithLazyBoundary(<NativeDebugPageLazy />),
          source: 'builtin',
          order: 90,
          group: 'debug',
          tags: ['debug', 'native'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'dsp-rack',
          title: t('pages.dsp-rack.title'),
          render: () => renderWithLazyBoundary(<DspRackPageLazy />),
          source: 'builtin',
          order: 95,
          group: 'plugin',
          tags: ['audio', 'dsp', 'vst'],
        });

        register<WindowContribution>({
          kind: 'window',
          id: 'vst-manager',
          title: t('windows.vst-manager.title'),
          label: 'vst-manager',
          route: '/#/vst-manager',
          source: 'builtin',
          open: async () => {
            await openVstManagerWindow({ title: t('windows.vst-manager.title') });
          },
          close: async () => {
            await closeVstManagerWindow();
          },
        });

        register<WindowContribution>({
          kind: 'window',
          id: 'keyboard-shortcuts',
          title: t('pages.keyboard-shortcuts.title'),
          label: 'keyboard-shortcuts',
          route: '/#/keyboard-shortcuts',
          source: 'builtin',
          open: async () => {
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('keyboard-shortcuts');
          },
        });

        register<PageContribution>({
          kind: 'page',
          id: 'plugin-page',
          title: t('pages.plugin-page.title'),
          render: (page) => {
            const params = parseNavigationParams('plugin-page', page.params);
            if (!params) {
              return (
                <PlaceholderPage icon="?" text={t('pages.plugin-page.invalidParams')} cssClass="page-plugin" />
              );
            }
            return renderWithLazyBoundary(
              <PluginPageHostLazy pluginId={params.pluginId} pageId={params.pageId} />
            );
          },
          source: 'builtin',
          order: 100,
          group: 'plugin',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'plugin-visualizer',
          title: t('pages.plugin-visualizer.title'),
          render: (page) => {
            const params = parseNavigationParams('plugin-visualizer', page.params);
            if (!params) {
              return (
                <PlaceholderPage
                  icon="?"
                  text={t('pages.plugin-visualizer.invalidParams')}
                  cssClass="page-plugin-visualizer"
                />
              );
            }
            return renderWithLazyBoundary(
              <PluginVisualizerHostLazy pluginId={params.pluginId} visualizerId={params.visualizerId} />
            );
          },
          source: 'builtin',
          order: 110,
          group: 'plugin',
        });

        // Windows (Editor)
        registerEditorWindow('control', t('windows.editor.control.title'));
        registerEditorWindow('statistics', t('windows.editor.statistics.title'));
        registerEditorWindow('library', t('windows.editor.library.title'));
        registerEditorWindow('style', t('windows.editor.style.title'));
        registerEditorWindow('creator', t('windows.editor.creator.title'));
        registerEditorWindow('background', t('windows.editor.background.title'));
        registerEditorWindow('custom-background', t('windows.editor.custom-background.title'));
        registerEditorWindow('theme', t('windows.editor.theme.title'));
        registerEditorWindow('debug', t('windows.editor.debug.title'));
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          telemetry.warn('contributions.locale_subscription.cleanup_failed', {
            message: readErrorMessage(error),
          });
        }

        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            telemetry.warn('contributions.unregister.failed', {
              message: readErrorMessage(error),
            });
          }
        }
        unregisters.clear();
      };
    },
  };
}

function PlaceholderPage({
  icon,
  text,
  cssClass,
}: {
  icon: string;
  text: string;
  cssClass?: string;
}) {
  return (
    <div className={`page-placeholder ${cssClass || ''}`}>
      <div className="placeholder-icon">{icon}</div>
      <div className="placeholder-text">{text}</div>
    </div>
  );
}

function BuiltinMusicLibraryPage() {
  const audioService = useAudioService();

  const Library = MusicLibraryLazy;

  const resolveTrackIdentity = (track: Track): string => {
    const id = String(track.id || '').trim();
    if (id.length > 0) return `id:${id}`;

    const filePath = String(track.filePath || track.path || track.originalPath || '').trim();
    if (filePath.length > 0) return `path:${filePath}`;

    return `title:${String(track.title || '').trim()}`;
  };

  const isSameQueueOrder = (left: Track[], right: Track[]): boolean => {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (resolveTrackIdentity(left[index]) !== resolveTrackIdentity(right[index])) {
        return false;
      }
    }
    return true;
  };

  const handlePlayNow = async (tracks: Track[], startIndex: number = 0) => {
    if (tracks.length === 0) return;

    const safeStartIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    const currentQueue = audioService.getQueue();
    if (!isSameQueueOrder(currentQueue, tracks)) {
      audioService.clearQueue();
      audioService.addMultipleToQueue(tracks);
    }

    await audioService.playTrackAtIndex(safeStartIndex);
  };

  const handleAddToQueue = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    audioService.addMultipleToQueue(tracks);
  };

  return <Library embedded onPlayNow={handlePlayNow} onAddToQueue={handleAddToQueue} />;
}
