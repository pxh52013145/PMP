export type MusicLibrarySourceMode = 'local' | 'nas' | 'stable';

export interface MusicLibrarySourceChangeDetail {
  mode: MusicLibrarySourceMode;
}

export interface MusicLibraryFooterStatItem {
  value: string;
  unit?: string;
}

export interface MusicLibraryStatsChangeDetail {
  mode: MusicLibrarySourceMode;
  items: MusicLibraryFooterStatItem[];
}

export const MUSIC_LIBRARY_SOURCE_CHANGE_EVENT = 'pmp:music-library-source-change';
export const MUSIC_LIBRARY_STATS_CHANGE_EVENT = 'pmp:music-library-stats-change';
