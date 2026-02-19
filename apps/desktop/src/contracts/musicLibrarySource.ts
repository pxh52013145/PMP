export type MusicLibrarySourceMode = 'local' | 'stable';

export interface MusicLibrarySourceChangeDetail {
  mode: MusicLibrarySourceMode;
}

export const MUSIC_LIBRARY_SOURCE_CHANGE_EVENT = 'pmp:music-library-source-change';
