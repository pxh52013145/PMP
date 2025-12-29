import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { PageContribution, SettingsPanelContribution, WindowContribution } from '../contracts/contributions';
import { parseNavigationParams } from '../contracts/navigationParams';
import { HomePage } from '../components/pages/HomePage';
import { SettingsPage } from '../components/pages/SettingsPage';
import { MusicLibrary } from '../components/pages/MusicLibrary';
import { TrackDetailPage } from '../components/pages/TrackDetailPage';
import { AlbumDetailPage } from '../components/pages/AlbumDetailPage';
import { NativeDebugPage } from '../components/pages/NativeDebugPage';
import { DspRackPage } from '../components/pages/DspRackPage';
import { AudioSettingsPanel } from '../components/settings-panels/AudioSettingsPanel';
import { WorkbenchSettingsPanel } from '../components/settings-panels/WorkbenchSettingsPanel';
import { PerformanceSettingsPanel } from '../components/settings-panels/PerformanceSettingsPanel';
import { PluginsSettingsPanel } from '../components/settings-panels/PluginsSettingsPanel';
import { VisualizersSettingsPanel } from '../components/settings-panels/VisualizersSettingsPanel';
import { PluginPageHost } from '../magnet-system/plugins/PluginPageHost';
import { PluginVisualizerHost } from '../magnet-system/plugins/PluginVisualizerHost';
import type { Track } from '../services/audio';
import { useAudioService } from '../contexts/AudioEngineContext';
import { calculateWindowPosition, openEditorWindow, type EditorWindowType } from '../utils/editorWindows';
import { closeVstManagerWindow, openVstManagerWindow } from '../utils/vstManagerWindows';

export function createBuiltinContributionsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-contributions',
    activate: ({ contributions }) => {
      const unregisters: Array<() => void> = [];

      const register = <T extends { kind: string; id: string }>(contribution: T) => {
        unregisters.push(contributions.register(contribution));
      };

      // Pages
      register<PageContribution>({
        kind: 'page',
        id: 'home',
        title: '首页',
        render: () => <HomePage />,
        source: 'builtin',
        order: 10,
        group: 'core',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'settings',
        title: '设置',
        render: () => <SettingsPage />,
        source: 'builtin',
        order: 20,
        group: 'core',
      });

      // Settings panels (rendered inside SettingsPage)
      register<SettingsPanelContribution>({
        kind: 'settings-panel',
        id: 'workbench',
        title: 'Workbench',
        render: () => <WorkbenchSettingsPanel />,
        source: 'builtin',
        order: 5,
        group: 'core',
      });

      register<SettingsPanelContribution>({
        kind: 'settings-panel',
        id: 'performance',
        title: '性能',
        render: () => <PerformanceSettingsPanel />,
        source: 'builtin',
        order: 10,
        group: 'core',
      });

      register<SettingsPanelContribution>({
        kind: 'settings-panel',
        id: 'audio',
        title: '音频',
        render: () => <AudioSettingsPanel />,
        source: 'builtin',
        order: 20,
        group: 'core',
      });

      register<SettingsPanelContribution>({
        kind: 'settings-panel',
        id: 'plugins',
        title: '插件',
        render: () => <PluginsSettingsPanel />,
        source: 'builtin',
        order: 30,
        group: 'plugin',
      });

      register<SettingsPanelContribution>({
        kind: 'settings-panel',
        id: 'visualizers',
        title: '可视化',
        render: () => <VisualizersSettingsPanel />,
        source: 'builtin',
        order: 40,
        group: 'visualizer',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'music-library',
        title: '音乐库',
        render: () => <BuiltinMusicLibraryPage />,
        source: 'builtin',
        order: 30,
        group: 'core',
        tags: ['music', 'library'],
      });

      register<PageContribution>({
        kind: 'page',
        id: 'track',
        title: '歌曲详情',
        render: (page) => {
          const params = parseNavigationParams('track', page.params);
          return <TrackDetailPage initialTrack={params?.track} />;
        },
        source: 'builtin',
        order: 40,
        group: 'details',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'album',
        title: '专辑',
        render: (page) => {
          const params = parseNavigationParams('album', page.params);
          return (
            <AlbumDetailPage
              albumName={params?.albumName}
              artist={params?.artist}
              tracks={params?.tracks}
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
        title: '歌单',
        render: () => <PlaceholderPage icon="?" text="歌单页面" cssClass="page-playlists" />,
        source: 'builtin',
        order: 60,
        group: 'core',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'play-queue',
        title: '播放队列',
        render: () => <PlaceholderPage icon="?" text="播放列表页面" cssClass="page-play-queue" />,
        source: 'builtin',
        order: 70,
        group: 'core',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'artist',
        title: '艺术家',
        render: () => <PlaceholderPage icon="?" text="艺术家页面" cssClass="page-artist" />,
        source: 'builtin',
        order: 80,
        group: 'details',
      });

      register<PageContribution>({
        kind: 'page',
        id: 'native-debug',
        title: '原生引擎调试',
        render: () => <NativeDebugPage />,
        source: 'builtin',
        order: 90,
        group: 'debug',
        tags: ['debug', 'native'],
      });

      register<PageContribution>({
        kind: 'page',
        id: 'dsp-rack',
        title: 'DSP Rack',
        render: () => <DspRackPage />,
        source: 'builtin',
        order: 95,
        group: 'plugin',
        tags: ['audio', 'dsp', 'vst'],
      });

      register<WindowContribution>({
        kind: 'window',
        id: 'vst-manager',
        title: 'VST3 Plugin Manager',
        label: 'vst-manager',
        route: '/#/vst-manager',
        source: 'builtin',
        open: async () => {
          await openVstManagerWindow({ title: 'VST3 Plugin Manager' });
        },
        close: async () => {
          await closeVstManagerWindow();
        },
      });

      register<PageContribution>({
        kind: 'page',
        id: 'plugin-page',
        title: '插件页面',
        render: (page) => {
          const params = parseNavigationParams('plugin-page', page.params);
          if (!params) {
            return <PlaceholderPage icon="?" text="插件页面：参数无效" cssClass="page-plugin" />;
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
        title: '插件可视化',
        render: (page) => {
          const params = parseNavigationParams('plugin-visualizer', page.params);
          if (!params) {
            return <PlaceholderPage icon="?" text="插件可视化：参数无效" cssClass="page-plugin-visualizer" />;
          }
          return <PluginVisualizerHost pluginId={params.pluginId} visualizerId={params.visualizerId} />;
        },
        source: 'builtin',
        order: 110,
        group: 'plugin',
      });

      // Windows (Editor)
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

      registerEditorWindow('control', 'Control');
      registerEditorWindow('statistics', 'Statistics');
      registerEditorWindow('library', 'Library');
      registerEditorWindow('style', 'Style');
      registerEditorWindow('creator', 'Creator');
      registerEditorWindow('background', 'Background');
      registerEditorWindow('custom-background', 'Custom Background');
      registerEditorWindow('debug', 'Debug');

      return () => {
        for (const unregister of unregisters.splice(0)) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-contributions] unregister failed', error);
          }
        }
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
