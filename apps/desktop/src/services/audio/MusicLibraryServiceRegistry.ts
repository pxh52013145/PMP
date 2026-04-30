import type { MusicLibraryService } from './MusicLibraryService';

let registeredMusicLibraryService: MusicLibraryService | null = null;

export function getRegisteredMusicLibraryService(): MusicLibraryService | null {
  return registeredMusicLibraryService;
}

export function setRegisteredMusicLibraryService(service: MusicLibraryService): void {
  registeredMusicLibraryService = service;
}
