import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { PageContribution, SettingsPanelContribution, WindowContribution } from '../contracts/contributions';
import { parseNavigationParams } from '../contracts/navigationParams';
import { HomePage } from '../components/pages/HomePage';
import { SettingsPage } from '../components/pages/SettingsPage';
import { KeyboardShortcutsPage } from '../components/pages/KeyboardShortcutsPage';
import { MusicLibrary } from '../components/pages/MusicLibrary';
import { TrackDetailPage } from '../components/pages/TrackDetailPage';
import { AlbumDetailPage } from '../components/pages/AlbumDetailPage';
import { DebugCenterPage } from '../components/pages/DebugCenterPage';
import { NativeDebugPage } from '../components/pages/NativeDebugPage';
import { DspRackPage } from '../components/pages/DspRackPage';
import { AudioSettingsPanel } from '../components/settings-panels/AudioSettingsPanel';
import { AudioComponentsSettingsPanel } from '../components/settings-panels/AudioComponentsSettingsPanel';
import { AudioBufferSettingsPanel } from '../components/settings-panels/AudioBufferSettingsPanel';
import { DebugSettingsPanel } from '../components/settings-panels/DebugSettingsPanel';
import { LanguageSettingsPanel } from '../components/settings-panels/LanguageSettingsPanel';
import { WorkbenchSettingsPanel } from '../components/settings-panels/WorkbenchSettingsPanel';
import { WindowCloseSettingsPanel } from '../components/settings-panels/WindowCloseSettingsPanel';
import { PerformanceSettingsPanel } from '../components/settings-panels/PerformanceSettingsPanel';
import { PluginsSettingsPanel } from '../components/settings-panels/PluginsSettingsPanel';
import { VisualizersSettingsPanel } from '../components/settings-panels/VisualizersSettingsPanel';
import { PluginPageHost } from '../magnet-system/plugins/PluginPageHost';
import { PluginVisualizerHost } from '../magnet-system/plugins/PluginVisualizerHost';
import type { Track } from '../services/audio';
import { useAudioService } from '../contexts/AudioEngineContext';
import { calculateWindowPosition, openEditorWindow, type EditorWindowType } from '../utils/editorWindows';
import { closeVstManagerWindow, openVstManagerWindow } from '../utils/vstManagerWindows';
import { subscribeLocale, t } from '../i18n/core';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';

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
          render: () => <HomePage />,
          source: 'builtin',
          order: 10,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'settings',
          title: t('pages.settings.title'),
          render: () => <SettingsPage />,
          source: 'builtin',
          order: 20,
          group: 'core',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'keyboard-shortcuts',
          title: t('pages.keyboard-shortcuts.title'),
          render: () => <KeyboardShortcutsPage />,
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
          render: () => <LanguageSettingsPanel />,
          source: 'builtin',
          order: 1,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'workbench',
          title: t('settings.panels.workbench.title'),
          render: () => <WorkbenchSettingsPanel />,
          source: 'builtin',
          order: 5,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'window-close',
          title: t('settings.panels.windowClose.title'),
          description: t('settings.panels.windowClose.desc'),
          render: () => <WindowCloseSettingsPanel />,
          source: 'builtin',
          order: 7,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'performance',
          title: t('settings.panels.performance.title'),
          render: () => <PerformanceSettingsPanel />,
          source: 'builtin',
          order: 10,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'debug',
          title: t('settings.panels.debug.title'),
          description: t('settings.panels.debug.desc'),
          render: () => <DebugSettingsPanel />,
          source: 'builtin',
          order: 90,
          group: 'debug',
          tags: ['debug'],
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio',
          title: t('settings.panels.audio.title'),
          render: () => <AudioSettingsPanel />,
          source: 'builtin',
          order: 20,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-components',
          title: t('settings.panels.audioComponents.title'),
          description: t('settings.panels.audioComponents.desc'),
          render: () => <AudioComponentsSettingsPanel />,
          source: 'builtin',
          order: 22,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'audio-buffer',
          title: t('settings.panels.audioBuffer.title'),
          description: t('settings.panels.audioBuffer.desc'),
          render: () => <AudioBufferSettingsPanel />,
          source: 'builtin',
          order: 25,
          group: 'core',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'plugins',
          title: t('settings.panels.plugins.title'),
          render: () => <PluginsSettingsPanel />,
          source: 'builtin',
          order: 30,
          group: 'plugin',
        });

        register<SettingsPanelContribution>({
          kind: 'settings-panel',
          id: 'visualizers',
          title: t('settings.panels.visualizers.title'),
          render: () => <VisualizersSettingsPanel />,
          source: 'builtin',
          order: 40,
          group: 'visualizer',
        });

        register<PageContribution>({
          kind: 'page',
          id: 'music-library',
          title: t('pages.music-library.title'),
          render: () => <BuiltinMusicLibraryPage />,
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
            return <TrackDetailPage trackId={params?.trackId} />;
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
            return (
              <AlbumDetailPage
                albumName={params?.albumName}
                artist={params?.artist}
              />
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
          render: () => <DebugCenterPage />,
          source: 'builtin',
          order: 88,
          group: 'debug',
          tags: ['debug'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'native-debug',
          title: t('pages.native-debug.title'),
          render: () => <NativeDebugPage />,
          source: 'builtin',
          order: 90,
          group: 'debug',
          tags: ['debug', 'native'],
        });

        register<PageContribution>({
          kind: 'page',
          id: 'dsp-rack',
          title: t('pages.dsp-rack.title'),
          render: () => <DspRackPage />,
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
            return <PluginPageHost pluginId={params.pluginId} pageId={params.pageId} />;
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
            return <PluginVisualizerHost pluginId={params.pluginId} visualizerId={params.visualizerId} />;
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
          console.warn('[builtin-contributions] locale subscription cleanup failed', error);
        }

        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-contributions] unregister failed', error);
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

  const handlePlayNow = async (tracks: Track[], startIndex: number = 0) => {
    if (tracks.length === 0) return;
    audioService.clearQueue();
    audioService.addMultipleToQueue(tracks);
    await audioService.playTrackAtIndex(Math.max(0, startIndex));
  };

  const handleAddToQueue = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    audioService.addMultipleToQueue(tracks);
  };

  return <MusicLibrary embedded onPlayNow={handlePlayNow} onAddToQueue={handleAddToQueue} />;
}
