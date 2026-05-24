import { describe, expect, it } from 'vitest';
import { isRecoverableNativeOutputError } from './nativeAudioOutputErrorClassification';

describe('isRecoverableNativeOutputError', () => {
  it('recognizes explicit native output error codes', () => {
    expect(isRecoverableNativeOutputError({ code: 'NATIVE_AUDIO_OUTPUT_ERROR' })).toBe(true);
    expect(isRecoverableNativeOutputError({ code: 'NATIVE_AUDIO_REBUILD_SINK_FAILED' })).toBe(true);
  });

  it('recognizes output backend errors wrapped by transport-level failures', () => {
    expect(
      isRecoverableNativeOutputError({
        code: 'NATIVE_AUDIO_PLAY_FAILED',
        message:
          '[AUDIO_OUTPUT_WASAPI_SHARED_RAW_UNSUPPORTED_FORMAT] Failed to init wasapi-shared-raw stream',
      })
    ).toBe(true);
  });

  it('does not treat ordinary play failures as output failover candidates', () => {
    expect(
      isRecoverableNativeOutputError({
        code: 'NATIVE_AUDIO_PLAY_FAILED',
        message: 'No track loaded',
      })
    ).toBe(false);
  });
});
