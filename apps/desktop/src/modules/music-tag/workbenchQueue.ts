import { readJson, writeJson } from '../storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import type {
  CoverArtCandidate,
  MusicTagCanonicalMetadata,
  MusicTagMetadataFieldKey,
} from '../../contracts/musicTag';

const MAX_QUEUE_SIZE = 200;

export interface MusicTagWorkbenchDraft {
  metadata: MusicTagCanonicalMetadata;
  lockedFields: MusicTagMetadataFieldKey[];
  selectedPatchFields: MusicTagMetadataFieldKey[];
  selectedCover: CoverArtCandidate | null;
  updatedAtMs: number;
}

type MusicTagWorkbenchDraftMap = Record<string, MusicTagWorkbenchDraft>;

function normalizeTrackIds(values: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trackId = value.trim();
    if (!trackId || result.includes(trackId)) continue;
    result.push(trackId);
    if (result.length >= MAX_QUEUE_SIZE) break;
  }
  return result;
}

export function readMusicTagWorkbenchQueue(): string[] {
  return normalizeTrackIds(readJson<unknown[]>(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_QUEUE_V1, []));
}

export function addMusicTagWorkbenchTracks(trackIds: readonly string[]): string[] {
  const queue = normalizeTrackIds([...readMusicTagWorkbenchQueue(), ...trackIds]);
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_QUEUE_V1, queue);
  return queue;
}

export function removeMusicTagWorkbenchTrack(trackId: string): string[] {
  const normalizedTrackId = trackId.trim();
  const queue = readMusicTagWorkbenchQueue().filter((id) => id !== normalizedTrackId);
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_QUEUE_V1, queue);
  removeMusicTagWorkbenchDraft(normalizedTrackId);
  return queue;
}

export function clearMusicTagWorkbenchQueue(): void {
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_QUEUE_V1, []);
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_DRAFTS_V1, {});
}

export function readMusicTagWorkbenchDraft(trackId: string): MusicTagWorkbenchDraft | null {
  const normalizedTrackId = trackId.trim();
  if (!normalizedTrackId) return null;
  const drafts = readMusicTagWorkbenchDrafts();
  const draft = drafts[normalizedTrackId];
  if (!draft || typeof draft !== 'object' || !draft.metadata || typeof draft.metadata !== 'object') {
    return null;
  }
  return draft;
}

export function readMusicTagWorkbenchDrafts(): MusicTagWorkbenchDraftMap {
  return readJson<MusicTagWorkbenchDraftMap>(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_DRAFTS_V1, {});
}

export function writeMusicTagWorkbenchDraft(
  trackId: string,
  draft: Omit<MusicTagWorkbenchDraft, 'updatedAtMs'>
): void {
  const normalizedTrackId = trackId.trim();
  if (!normalizedTrackId) return;
  const drafts = readMusicTagWorkbenchDrafts();
  drafts[normalizedTrackId] = {
    ...draft,
    updatedAtMs: Date.now(),
  };
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_DRAFTS_V1, drafts);
}

export function removeMusicTagWorkbenchDraft(trackId: string): void {
  const normalizedTrackId = trackId.trim();
  if (!normalizedTrackId) return;
  const drafts = readMusicTagWorkbenchDrafts();
  if (!drafts[normalizedTrackId]) return;
  delete drafts[normalizedTrackId];
  writeJson(STORAGE_KEYS.MUSIC_TAG_WORKBENCH_DRAFTS_V1, drafts);
}
