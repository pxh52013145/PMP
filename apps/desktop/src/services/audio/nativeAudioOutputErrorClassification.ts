const RECOVERABLE_OUTPUT_ERROR_CODES = new Set([
  'NATIVE_AUDIO_OUTPUT_ERROR',
  'NATIVE_AUDIO_REBUILD_SINK_FAILED',
]);

const OUTPUT_ERROR_WRAPPER_CODES = new Set([
  'NATIVE_AUDIO_LOAD_FAILED',
  'NATIVE_AUDIO_LOAD_SOURCE_FAILED',
  'NATIVE_AUDIO_PLAY_FAILED',
]);

const OUTPUT_ERROR_MESSAGE_PATTERN = /\bAUDIO_OUTPUT_[A-Z0-9_]+\b/;

export function isRecoverableNativeOutputError(input: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = typeof input.code === 'string' ? input.code : '';
  if (RECOVERABLE_OUTPUT_ERROR_CODES.has(code)) {
    return true;
  }

  if (!OUTPUT_ERROR_WRAPPER_CODES.has(code)) {
    return false;
  }

  const message = typeof input.message === 'string' ? input.message : '';
  return OUTPUT_ERROR_MESSAGE_PATTERN.test(message);
}
