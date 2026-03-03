export type RobustnessEmissionGateConfig = {
  minIntervalMs: number;
  forceBurstWindowMs: number;
  forceBurstLimit: number;
};

export type RobustnessEmissionPlan =
  | {
      action: 'emit';
      force: boolean;
    }
  | {
      action: 'defer';
      force: boolean;
      delayMs: number;
    };

function normalizeConfig(config: RobustnessEmissionGateConfig): Required<RobustnessEmissionGateConfig> {
  return {
    minIntervalMs: Math.max(1, Math.floor(config.minIntervalMs)),
    forceBurstWindowMs: Math.max(1, Math.floor(config.forceBurstWindowMs)),
    forceBurstLimit: Math.max(1, Math.floor(config.forceBurstLimit)),
  };
}

export class RobustnessEmissionGate {
  private readonly config: Required<RobustnessEmissionGateConfig>;
  private lastEmissionAtMs = 0;
  private forcedBurstWindowStartMs = 0;
  private forcedBurstCount = 0;

  constructor(config: RobustnessEmissionGateConfig) {
    this.config = normalizeConfig(config);
  }

  reset(): void {
    this.lastEmissionAtMs = 0;
    this.forcedBurstWindowStartMs = 0;
    this.forcedBurstCount = 0;
  }

  markEmitted(nowMs: number = Date.now()): void {
    this.lastEmissionAtMs = Math.max(0, Math.floor(nowMs));
  }

  plan(force: boolean = false, nowMs: number = Date.now()): RobustnessEmissionPlan {
    const now = Math.max(0, Math.floor(nowMs));

    if (force) {
      if (this.canEmitForced(now)) {
        return { action: 'emit', force: true };
      }

      const elapsedMs = now - this.lastEmissionAtMs;
      const delayMs =
        elapsedMs >= 0 && elapsedMs < this.config.minIntervalMs
          ? this.config.minIntervalMs - elapsedMs
          : Math.max(1, Math.floor(this.config.minIntervalMs / 2));
      return {
        action: 'defer',
        force: true,
        delayMs,
      };
    }

    const elapsedMs = now - this.lastEmissionAtMs;
    if (elapsedMs >= 0 && elapsedMs < this.config.minIntervalMs) {
      return {
        action: 'defer',
        force: false,
        delayMs: this.config.minIntervalMs - elapsedMs,
      };
    }

    return { action: 'emit', force: false };
  }

  private canEmitForced(nowMs: number): boolean {
    if (
      nowMs < this.forcedBurstWindowStartMs ||
      nowMs - this.forcedBurstWindowStartMs >= this.config.forceBurstWindowMs
    ) {
      this.forcedBurstWindowStartMs = nowMs;
      this.forcedBurstCount = 0;
    }

    if (this.forcedBurstCount < this.config.forceBurstLimit) {
      this.forcedBurstCount += 1;
      return true;
    }

    return false;
  }
}

