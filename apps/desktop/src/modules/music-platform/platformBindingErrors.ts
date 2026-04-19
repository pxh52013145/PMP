export class PlatformBindingPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlatformBindingPayloadError';
  }
}

export function isPlatformBindingPayloadError(
  error: unknown
): error is PlatformBindingPayloadError {
  return error instanceof Error && error.name === 'PlatformBindingPayloadError';
}
