import type {
  AlbumPageParams,
  ArtistPageParams,
  PluginPageParams,
  PluginVisualizerParams,
  TrackPageParams,
} from './navigationParams';

export type NavigationPageType =
  | 'home'
  | 'settings'
  | 'music-library'
  | 'playlists'
  | 'play-queue'
  | 'track'
  | 'album'
  | 'artist'
  | 'plugin-page'
  | 'plugin-visualizer'
  | 'native-debug';

export type NavigationParamsMap = {
  home: undefined;
  settings: undefined;
  'music-library': undefined;
  playlists: undefined;
  'play-queue': undefined;
  'native-debug': undefined;
  track: TrackPageParams;
  album: AlbumPageParams;
  artist: ArtistPageParams;
  'plugin-page': PluginPageParams;
  'plugin-visualizer': PluginVisualizerParams;
};

export interface NavigationPageData {
  type: NavigationPageType;
  params?: NavigationParamsMap[NavigationPageType];
}
