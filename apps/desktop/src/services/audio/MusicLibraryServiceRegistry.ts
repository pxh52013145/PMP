import type { MusicLibraryService } from './MusicLibraryService';

let registeredMusicLibraryService: MusicLibraryService | null = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    registeredMusicLibraryService = null;
  });
}

export function getRegisteredMusicLibraryService(): MusicLibraryService | null {
  return registeredMusicLibraryService;
}

export function setRegisteredMusicLibraryService(service: MusicLibraryService): void {
  registeredMusicLibraryService = service;
}
