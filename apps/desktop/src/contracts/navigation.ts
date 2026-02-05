import type {
  AlbumPageParams,
  ArtistPageParams,
  PluginPageParams,
  PluginVisualizerParams,
  TrackPageParams,
} from './navigationParams';

export type PmpmPluginPageType = `pmpm:${string}:page:${string}`;

export type NavigationPageType =
  | 'home'
  | 'settings'
  | 'debug'
  | 'debug-center'
  | 'perf-monitor'
  | 'keyboard-shortcuts'
  | 'music-library'
  | 'playlists'
  | 'play-queue'
  | 'track'
  | 'album'
  | 'artist'
  | 'dsp-rack'
  | 'plugin-page'
  | 'plugin-visualizer'
  | 'native-debug'
  | PmpmPluginPageType;

export type NavigationParamsMap = {
  home: undefined;
  settings: undefined;
  debug: undefined;
  'debug-center': undefined;
  'perf-monitor': undefined;
  'keyboard-shortcuts': undefined;
  'music-library': undefined;
  playlists: undefined;
  'play-queue': undefined;
  'native-debug': undefined;
  'dsp-rack': undefined;
  track: TrackPageParams;
  album: AlbumPageParams;
  artist: ArtistPageParams;
  'plugin-page': PluginPageParams;
  'plugin-visualizer': PluginVisualizerParams;
};

export type NavigationParamsFor<T extends NavigationPageType> =
  T extends keyof NavigationParamsMap ? NavigationParamsMap[T] : undefined;

export interface NavigationPageData<T extends NavigationPageType = NavigationPageType> {
  type: T;
  params?: NavigationParamsFor<T>;
}
