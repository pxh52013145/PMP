export const RENDER_MODES = ['full', 'throttle', 'pause'] as const;

export type RenderMode = (typeof RENDER_MODES)[number];

export type BackgroundRenderPolicy = RenderMode;

export const DEFAULT_BACKGROUND_RENDER_POLICY: BackgroundRenderPolicy = 'pause';

// A conservative default that noticeably reduces background CPU/GPU while keeping some motion visible.
export const BACKGROUND_RENDER_THROTTLE_FPS = 10;

export function parseRenderMode(value: unknown, fallback: RenderMode = DEFAULT_BACKGROUND_RENDER_POLICY): RenderMode {
  if (value === 'full' || value === 'throttle' || value === 'pause') return value;
  return fallback;
}

export function parseBackgroundRenderPolicy(
  value: unknown,
  fallback: BackgroundRenderPolicy = DEFAULT_BACKGROUND_RENDER_POLICY
): BackgroundRenderPolicy {
  return parseRenderMode(value, fallback);
}

