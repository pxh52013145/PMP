import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_AUDIO_PLAYBACK_PREFERENCES,
  readPersistedAudioPlaybackPreferences,
  resolveAudioPlaybackPreferences,
} from './audioPlaybackPreferences';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

describe('audioPlaybackPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('falls back to defaults for missing or invalid values', () => {
    expect(readPersistedAudioPlaybackPreferences()).toEqual(DEFAULT_AUDIO_PLAYBACK_PREFERENCES);

    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_VOLUME, JSON.stringify(3));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_MUTED, JSON.stringify('bad'));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_PLAY_MODE, JSON.stringify('invalid'));

    expect(readPersistedAudioPlaybackPreferences()).toEqual({
      volume: 1,
      muted: false,
      playMode: 'sequence',
    });
  });

  it('reads persisted playback preferences', () => {
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_VOLUME, JSON.stringify(0.42));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_MUTED, JSON.stringify(true));
    localStorage.setItem(STORAGE_KEYS.NATIVE_AUDIO_PLAY_MODE, JSON.stringify('shuffle'));

    expect(readPersistedAudioPlaybackPreferences()).toEqual({
      volume: 0.42,
      muted: true,
      playMode: 'shuffle',
    });
  });

  it('normalizes partial preference payloads', () => {
    expect(
      resolveAudioPlaybackPreferences({
        volume: -1,
        muted: true,
        playMode: 'loop',
      })
    ).toEqual({
      volume: 0,
      muted: true,
      playMode: 'loop',
    });
  });
});
