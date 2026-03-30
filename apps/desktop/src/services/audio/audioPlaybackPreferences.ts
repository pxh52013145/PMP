import { readJson } from '../../modules/storage';
import {
  broadcastDataUpdate,
  setupDualListener,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import type { PlayMode } from './types';

export interface AudioPlaybackPreferences {
  volume: number;
  muted: boolean;
  playMode: PlayMode;
}

export const DEFAULT_AUDIO_PLAYBACK_PREFERENCES: AudioPlaybackPreferences = {
  volume: 0.7,
  muted: false,
  playMode: 'sequence',
};

const PLAY_MODES: PlayMode[] = ['sequence', 'loop', 'single-loop', 'shuffle'];

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function resolveMuted(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function resolvePlayMode(value: unknown, fallback: PlayMode): PlayMode {
  return typeof value === 'string' && PLAY_MODES.includes(value as PlayMode)
    ? (value as PlayMode)
    : fallback;
}

export function resolveAudioPlaybackPreferences(
  value:
    | {
        volume?: unknown;
        muted?: unknown;
        playMode?: unknown;
      }
    | null
    | undefined
): AudioPlaybackPreferences {
  return {
    volume: clamp01(value?.volume, DEFAULT_AUDIO_PLAYBACK_PREFERENCES.volume),
    muted: resolveMuted(value?.muted, DEFAULT_AUDIO_PLAYBACK_PREFERENCES.muted),
    playMode: resolvePlayMode(value?.playMode, DEFAULT_AUDIO_PLAYBACK_PREFERENCES.playMode),
  };
}

export function readPersistedAudioPlaybackPreferences(): AudioPlaybackPreferences {
  return resolveAudioPlaybackPreferences({
    volume: readJson<unknown>(STORAGE_KEYS.NATIVE_AUDIO_VOLUME, null),
    muted: readJson<unknown>(STORAGE_KEYS.NATIVE_AUDIO_MUTED, null),
    playMode: readJson<unknown>(STORAGE_KEYS.NATIVE_AUDIO_PLAY_MODE, null),
  });
}

export async function persistAudioPlaybackVolume(volume: number): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.NATIVE_AUDIO_VOLUME,
    clamp01(volume, DEFAULT_AUDIO_PLAYBACK_PREFERENCES.volume),
    TAURI_EVENTS.NATIVE_AUDIO_VOLUME_UPDATED
  );
}

export async function persistAudioPlaybackMuted(muted: boolean): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.NATIVE_AUDIO_MUTED,
    Boolean(muted),
    TAURI_EVENTS.NATIVE_AUDIO_MUTED_UPDATED
  );
}

export async function persistAudioPlaybackPlayMode(playMode: PlayMode): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.NATIVE_AUDIO_PLAY_MODE,
    resolvePlayMode(playMode, DEFAULT_AUDIO_PLAYBACK_PREFERENCES.playMode),
    TAURI_EVENTS.NATIVE_AUDIO_PLAY_MODE_UPDATED
  );
}

export async function setupAudioPlaybackPreferencesListener(
  callback: (preferences: AudioPlaybackPreferences) => void
): Promise<() => void> {
  return setupDualListener(
    [
      STORAGE_KEYS.NATIVE_AUDIO_VOLUME,
      STORAGE_KEYS.NATIVE_AUDIO_MUTED,
      STORAGE_KEYS.NATIVE_AUDIO_PLAY_MODE,
    ],
    [
      TAURI_EVENTS.NATIVE_AUDIO_VOLUME_UPDATED,
      TAURI_EVENTS.NATIVE_AUDIO_MUTED_UPDATED,
      TAURI_EVENTS.NATIVE_AUDIO_PLAY_MODE_UPDATED,
    ],
    () => callback(readPersistedAudioPlaybackPreferences())
  );
}
