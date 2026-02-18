import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel, ModuleLoader } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { createAudioModule } from '../audioModule';
import { clearCloudPlaybackFallbackQueue, getCloudPlaybackFallbackAdapter } from '../cloudPlaybackFallbackAdapter';

describe('audioModule cloud fallback queue bridge', () => {
  beforeEach(() => {
    clearCloudPlaybackFallbackQueue();
  });

  it('emits kernel event when fallback request is queued', async () => {
    const kernel = createKernel<AppEvents>();
    const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);
    const listener = vi.fn();
    const unsubscribe = kernel.events.on('music-library/cloudFallbackQueued', listener);

    loader.activate([
      createAudioModule({
        mode: 'noop',
        enableTaskbarMediaControls: false,
      }),
    ]);

    try {
      const adapter = getCloudPlaybackFallbackAdapter();
      await adapter.dispatch({
        entryId: 'entry-audio-module-1',
        ownerUid: 'u_audio_module',
        quickFingerprint: 'abcdef1234567890',
        requestedAtMs: 1700001000,
        reason: 'local-miss',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      const [payload, meta] = listener.mock.calls[0] ?? [];
      expect(payload).toMatchObject({
        request: {
          entryId: 'entry-audio-module-1',
          ownerUid: 'u_audio_module',
          quickFingerprint: 'qf2:abcdef1234567890',
        },
        dispatch: {
          accepted: true,
          deduped: false,
          queueSize: 1,
        },
      });
      expect(meta.source).toBe('audio');

      loader.deactivateAll();

      await adapter.dispatch({
        entryId: 'entry-audio-module-2',
        ownerUid: 'u_audio_module',
        quickFingerprint: 'abcdef1234567891',
        requestedAtMs: 1700001001,
        reason: 'local-miss',
      });

      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      loader.deactivateAll();
      unsubscribe();
    }
  });
});
