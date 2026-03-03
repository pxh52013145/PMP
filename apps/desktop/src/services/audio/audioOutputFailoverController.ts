export type AutoOutputFailoverConfig = {
  underrunWindowMs: number;
  underrunTriggerCount: number;
  underrunFrameSpikeTrigger: number;
  switchCooldownMs: number;
};

export type EvaluateAutoOutputSwitchInput = {
  reason: string;
  nowMs: number;
  backendSwitchInFlight: boolean;
  lastAutoSwitchAtMs: number | null;
  lastUnderrunFrames: number;
  underrunSpikeTimestampsMs: number[];
  config: AutoOutputFailoverConfig;
};

export type EvaluateAutoOutputSwitchResult = {
  shouldSwitch: boolean;
  prunedUnderrunSpikeTimestampsMs: number[];
};

export type ResolveAutoOutputBackendChainInput = {
  availableBackends: string[];
  currentBackendId: string | null;
  isWindows: boolean;
};

const SHARED_BACKENDS = new Set(['wasapi', 'wasapi-shared-raw', 'rodio-cpal']);

export function isSharedOutputBackendId(backendId: string | null | undefined): backendId is string {
  return typeof backendId === 'string' && SHARED_BACKENDS.has(backendId);
}

export function pruneUnderrunSpikeTimestamps(
  timestamps: number[],
  nowMs: number,
  windowMs: number
): number[] {
  const safeNowMs = Math.max(0, Math.floor(nowMs));
  const safeWindowMs = Math.max(1, Math.floor(windowMs));
  return timestamps.filter(
    (timestamp) =>
      Number.isFinite(timestamp) &&
      safeNowMs - timestamp <= safeWindowMs
  );
}

export function evaluateAutoOutputSwitch(
  input: EvaluateAutoOutputSwitchInput
): EvaluateAutoOutputSwitchResult {
  const nowMs = Math.max(0, Math.floor(input.nowMs));
  const prunedUnderrunSpikeTimestampsMs = pruneUnderrunSpikeTimestamps(
    input.underrunSpikeTimestampsMs,
    nowMs,
    input.config.underrunWindowMs
  );

  if (input.backendSwitchInFlight) {
    return {
      shouldSwitch: false,
      prunedUnderrunSpikeTimestampsMs,
    };
  }

  if (
    input.lastAutoSwitchAtMs !== null &&
    nowMs - input.lastAutoSwitchAtMs < Math.max(1, Math.floor(input.config.switchCooldownMs))
  ) {
    return {
      shouldSwitch: false,
      prunedUnderrunSpikeTimestampsMs,
    };
  }

  if (input.reason.startsWith('underrun')) {
    if (input.lastUnderrunFrames >= Math.max(1, Math.floor(input.config.underrunFrameSpikeTrigger))) {
      return {
        shouldSwitch: true,
        prunedUnderrunSpikeTimestampsMs,
      };
    }

    return {
      shouldSwitch:
        prunedUnderrunSpikeTimestampsMs.length >=
        Math.max(1, Math.floor(input.config.underrunTriggerCount)),
      prunedUnderrunSpikeTimestampsMs,
    };
  }

  return {
    shouldSwitch: true,
    prunedUnderrunSpikeTimestampsMs,
  };
}

export function resolveAutoOutputBackendChain(input: ResolveAutoOutputBackendChainInput): string[] {
  const backends = [...input.availableBackends];
  if (
    isSharedOutputBackendId(input.currentBackendId) &&
    !backends.includes(input.currentBackendId)
  ) {
    backends.unshift(input.currentBackendId);
  }

  const unique = Array.from(
    new Set(backends.filter((value) => value.length > 0 && isSharedOutputBackendId(value)))
  );
  if (unique.length <= 1) return unique;

  if (!input.isWindows) return unique;

  const preferredOrder = ['wasapi-shared-raw', 'wasapi', 'rodio-cpal'];
  const ordered: string[] = [];
  for (const preferred of preferredOrder) {
    if (unique.includes(preferred)) ordered.push(preferred);
  }
  for (const backend of unique) {
    if (!ordered.includes(backend)) ordered.push(backend);
  }
  return ordered;
}

export function resolveNextAutoOutputBackend(
  chain: string[],
  currentBackendId: string | null
): string | null {
  if (chain.length === 0) return null;
  if (!isSharedOutputBackendId(currentBackendId)) {
    return chain[0] ?? null;
  }

  const index = chain.indexOf(currentBackendId);
  if (index < 0) return chain[0] ?? null;
  return chain[(index + 1) % chain.length] ?? null;
}

