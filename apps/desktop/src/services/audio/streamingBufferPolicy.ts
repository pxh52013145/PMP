export type StreamingBufferSettings = {
  startOrSeekSeconds: number | null;
  crossfadeSeconds: number | null;
  decodeMode: 'streaming' | 'full-track';
  interactiveProfile: 'fast' | 'balanced' | 'stable';
};

export type ResolveStreamingBufferPolicyTargetInput = {
  storedSettings: StreamingBufferSettings;
  documentHidden: boolean;
  underrunRecoveryActive: boolean;
  protectionWindowActive: boolean;
  sharedStressWindowActive: boolean;
};

export function normalizeStreamingBufferSettings(
  settings: StreamingBufferSettings
): StreamingBufferSettings {
  const normalize = (value: number | null, min: number, max: number): number | null => {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return Math.max(min, Math.min(max, value));
  };

  return {
    startOrSeekSeconds: normalize(settings.startOrSeekSeconds, 0, 4),
    crossfadeSeconds: normalize(settings.crossfadeSeconds, 0, 3),
    decodeMode: settings.decodeMode === 'full-track' ? 'full-track' : 'streaming',
    interactiveProfile:
      settings.interactiveProfile === 'fast' ||
      settings.interactiveProfile === 'stable' ||
      settings.interactiveProfile === 'balanced'
        ? settings.interactiveProfile
        : 'balanced',
  };
}

export function buildBackgroundStreamingBufferSettings(
  base: StreamingBufferSettings
): StreamingBufferSettings {
  return {
    startOrSeekSeconds:
      typeof base.startOrSeekSeconds === 'number'
        ? Math.min(3.2, Math.max(1.2, base.startOrSeekSeconds))
        : 2.4,
    crossfadeSeconds:
      typeof base.crossfadeSeconds === 'number'
        ? Math.min(1.8, Math.max(0.4, base.crossfadeSeconds))
        : 1.0,
    decodeMode: base.decodeMode,
    interactiveProfile: base.interactiveProfile,
  };
}

export function buildRecoveryStreamingBufferSettings(
  base: StreamingBufferSettings
): StreamingBufferSettings {
  const background = buildBackgroundStreamingBufferSettings(base);
  return {
    startOrSeekSeconds: Math.min(4, Math.max(background.startOrSeekSeconds ?? 2.4, 3.2)),
    crossfadeSeconds: Math.min(3, Math.max(background.crossfadeSeconds ?? 1.0, 1.4)),
    decodeMode: background.decodeMode,
    interactiveProfile: background.interactiveProfile,
  };
}

export function buildProtectionStreamingBufferSettings(
  base: StreamingBufferSettings
): StreamingBufferSettings {
  const recovery = buildRecoveryStreamingBufferSettings(base);
  return {
    startOrSeekSeconds: Math.min(4, Math.max(recovery.startOrSeekSeconds ?? 3.2, 3.8)),
    crossfadeSeconds: Math.min(3, Math.max(recovery.crossfadeSeconds ?? 1.4, 1.8)),
    decodeMode: recovery.decodeMode,
    interactiveProfile: recovery.interactiveProfile,
  };
}

export function resolveStreamingBufferPolicyTarget(
  input: ResolveStreamingBufferPolicyTargetInput
): StreamingBufferSettings {
  let target = normalizeStreamingBufferSettings(input.storedSettings);

  if (input.documentHidden) {
    target = buildBackgroundStreamingBufferSettings(target);
  }

  if (input.underrunRecoveryActive) {
    target = buildRecoveryStreamingBufferSettings(target);
  }

  if (input.protectionWindowActive) {
    target = buildProtectionStreamingBufferSettings(target);
  }

  if (input.sharedStressWindowActive) {
    target = {
      startOrSeekSeconds: Math.min(4, Math.max(target.startOrSeekSeconds ?? 2.4, 3.6)),
      crossfadeSeconds: Math.min(3, Math.max(target.crossfadeSeconds ?? 1.0, 1.9)),
      decodeMode: target.decodeMode,
      interactiveProfile: target.interactiveProfile,
    };
  }

  return normalizeStreamingBufferSettings(target);
}

export function isSameStreamingBufferSettings(
  left: StreamingBufferSettings | null,
  right: StreamingBufferSettings | null
): boolean {
  if (!left || !right) return false;
  return (
    left.startOrSeekSeconds === right.startOrSeekSeconds &&
    left.crossfadeSeconds === right.crossfadeSeconds &&
    left.decodeMode === right.decodeMode &&
    left.interactiveProfile === right.interactiveProfile
  );
}
