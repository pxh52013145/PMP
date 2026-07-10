import type {
  VisualizerFrameRatePolicy,
  VisualizerFrameRateSnapshot,
} from './types';

const FRAME_INTERVAL_EPSILON_MS = 0.5;
const FPS_STEPS = [240, 144, 120, 90, 72, 60, 48, 40, 30, 24, 20, 15, 12, 10, 8, 6, 4, 2, 1];

export const DEFAULT_VISUALIZER_FRAME_RATE_POLICY: VisualizerFrameRatePolicy = {
  mode: 'realtime',
  targetFps: 60,
  minFps: 24,
  backgroundFps: 0,
  adaptive: true,
  sampleWindowMs: 2_000,
  frameBudgetRatio: 0.9,
  downgradeRatio: 0.18,
  upgradeRatio: 0.04,
  minRenderScale: 1,
  maxRenderScale: 1,
  renderScaleStep: 0.1,
};

export type VisualizerFrameDecision = {
  shouldRender: boolean;
  deltaTime: number;
  targetFps: number;
  renderScale: number;
  isBackground: boolean;
};

export type VisualizerFrameCommit = {
  renderScaleChanged: boolean;
  effectiveFpsChanged: boolean;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}

function quantizeFps(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(240, Math.max(1, Math.round(value)));
}

export function normalizeVisualizerFrameRatePolicy(
  input: Partial<VisualizerFrameRatePolicy> = {},
  fallback: VisualizerFrameRatePolicy = DEFAULT_VISUALIZER_FRAME_RATE_POLICY
): VisualizerFrameRatePolicy {
  const targetFps = quantizeFps(input.targetFps ?? fallback.targetFps, fallback.targetFps);
  const minFps = clampInteger(input.minFps ?? fallback.minFps, 1, targetFps);
  const minRenderScale = clamp(input.minRenderScale ?? fallback.minRenderScale, 0.35, 1);
  const maxRenderScale = clamp(input.maxRenderScale ?? fallback.maxRenderScale, minRenderScale, 2);
  return {
    mode:
      input.mode === 'fixed' || input.mode === 'paused' || input.mode === 'realtime'
        ? input.mode
        : fallback.mode,
    targetFps,
    minFps,
    backgroundFps: clampInteger(input.backgroundFps ?? fallback.backgroundFps, 0, targetFps),
    adaptive: input.adaptive ?? fallback.adaptive,
    sampleWindowMs: clampInteger(input.sampleWindowMs ?? fallback.sampleWindowMs, 250, 15_000),
    frameBudgetRatio: clamp(input.frameBudgetRatio ?? fallback.frameBudgetRatio, 0.5, 1),
    downgradeRatio: clamp(input.downgradeRatio ?? fallback.downgradeRatio, 0.01, 1),
    upgradeRatio: clamp(input.upgradeRatio ?? fallback.upgradeRatio, 0, 1),
    minRenderScale,
    maxRenderScale,
    renderScaleStep: clamp(input.renderScaleStep ?? fallback.renderScaleStep, 0.025, 0.5),
  };
}

function resolveLowerFps(current: number, minFps: number): number {
  return FPS_STEPS.find((candidate) => candidate < current && candidate >= minFps) ?? minFps;
}

function resolveHigherFps(current: number, target: number): number {
  return [...FPS_STEPS].reverse().find((candidate) => candidate > current && candidate <= target) ?? target;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

export class VisualizerFrameGovernor {
  private policy: VisualizerFrameRatePolicy;
  private effectiveFps: number;
  private renderScale: number;
  private invalidated = true;
  private lastRenderAt: number | null = null;
  private lastFrameWasBackground: boolean | null = null;
  private lastEvaluationAt: number | null = null;
  private renderedFrames = 0;
  private skippedFrames = 0;
  private droppedFrames = 0;
  private lastFrameMs = 0;
  private sampleDurations: number[] = [];
  private sampleOverBudgetFrames = 0;
  private sampleFrames = 0;
  private avgFrameMs = 0;
  private p95FrameMs = 0;
  private actualFps = 0;

  constructor(policy?: Partial<VisualizerFrameRatePolicy>) {
    this.policy = normalizeVisualizerFrameRatePolicy(policy);
    this.effectiveFps = this.policy.targetFps;
    this.renderScale = this.policy.maxRenderScale;
  }

  setPolicy(policy: Partial<VisualizerFrameRatePolicy>): void {
    this.policy = normalizeVisualizerFrameRatePolicy(policy, this.policy);
    if (!this.policy.adaptive || this.policy.mode === 'fixed') {
      this.effectiveFps = this.policy.targetFps;
      this.renderScale = this.policy.maxRenderScale;
    } else {
      this.effectiveFps = clampInteger(this.effectiveFps, this.policy.minFps, this.policy.targetFps);
      this.renderScale = clamp(this.renderScale, this.policy.minRenderScale, this.policy.maxRenderScale);
    }
    this.invalidate();
  }

  invalidate(): void {
    this.invalidated = true;
  }

  beginFrame(timestamp: number, isBackground: boolean): VisualizerFrameDecision {
    if (
      this.lastFrameWasBackground !== null &&
      this.lastFrameWasBackground !== isBackground
    ) {
      // Background timer throttling is not render debt. Start a fresh
      // foreground/background pacing and sampling window after a visibility change.
      this.lastRenderAt = null;
      this.lastEvaluationAt = null;
      this.sampleDurations = [];
      this.sampleOverBudgetFrames = 0;
      this.sampleFrames = 0;
    }
    this.lastFrameWasBackground = isBackground;
    const targetFps = isBackground ? this.policy.backgroundFps : this.effectiveFps;
    if (this.policy.mode === 'paused' && !this.invalidated) {
      this.skippedFrames += 1;
      return {
        shouldRender: false,
        deltaTime: 0,
        targetFps,
        renderScale: this.renderScale,
        isBackground,
      };
    }

    // A background FPS of zero is a true scheduler suspension. An invalidation
    // may still present one final frame, which is useful for explicit redraws.
    if (targetFps <= 0 && !this.invalidated) {
      this.skippedFrames += 1;
      return {
        shouldRender: false,
        deltaTime: 0,
        targetFps,
        renderScale: this.renderScale,
        isBackground,
      };
    }

    const frameInterval = targetFps > 0 ? 1000 / targetFps : 0;
    const elapsed = this.lastRenderAt === null ? 0 : Math.max(0, timestamp - this.lastRenderAt);
    if (!this.invalidated && frameInterval > 0 && elapsed + FRAME_INTERVAL_EPSILON_MS < frameInterval) {
      this.skippedFrames += 1;
      return {
        shouldRender: false,
        deltaTime: 0,
        targetFps,
        renderScale: this.renderScale,
        isBackground,
      };
    }

    if (frameInterval > 0 && elapsed > frameInterval * 1.5) {
      this.droppedFrames += Math.max(0, Math.floor(elapsed / frameInterval) - 1);
    }
    this.invalidated = false;
    this.lastRenderAt = timestamp;
    return {
      shouldRender: true,
      deltaTime:
        this.policy.mode === 'fixed' && frameInterval > 0
          ? frameInterval
          : Math.min(250, elapsed || frameInterval || 1000 / 60),
      targetFps,
      renderScale: this.renderScale,
      isBackground,
    };
  }

  endFrame(
    timestamp: number,
    renderDurationMs: number,
    isBackground = false
  ): VisualizerFrameCommit {
    const duration = Math.max(0, Number.isFinite(renderDurationMs) ? renderDurationMs : 0);
    this.renderedFrames += 1;
    this.lastFrameMs = duration;
    if (isBackground) {
      return { renderScaleChanged: false, effectiveFpsChanged: false };
    }
    this.sampleDurations.push(duration);
    this.sampleFrames += 1;
    const frameBudgetMs = 1000 / Math.max(1, this.effectiveFps);
    if (duration > frameBudgetMs * this.policy.frameBudgetRatio) {
      this.sampleOverBudgetFrames += 1;
    }

    if (this.lastEvaluationAt === null) {
      this.lastEvaluationAt = timestamp;
      this.sampleDurations = [];
      this.sampleOverBudgetFrames = 0;
      this.sampleFrames = 0;
      return { renderScaleChanged: false, effectiveFpsChanged: false };
    }
    if (timestamp - this.lastEvaluationAt < this.policy.sampleWindowMs) {
      return { renderScaleChanged: false, effectiveFpsChanged: false };
    }

    const elapsedSinceEvaluation = Math.max(1, timestamp - this.lastEvaluationAt);
    this.avgFrameMs = this.sampleDurations.reduce((total, value) => total + value, 0) /
      Math.max(1, this.sampleDurations.length);
    this.p95FrameMs = percentile95(this.sampleDurations);
    this.actualFps = this.sampleFrames * 1000 / elapsedSinceEvaluation;
    const overloadedRatio = this.sampleOverBudgetFrames / Math.max(1, this.sampleFrames);
    let renderScaleChanged = false;
    let effectiveFpsChanged = false;

    if (this.policy.adaptive && overloadedRatio >= this.policy.downgradeRatio) {
      if (this.renderScale > this.policy.minRenderScale + 0.001) {
        this.renderScale = Math.max(this.policy.minRenderScale, this.renderScale - this.policy.renderScaleStep);
        renderScaleChanged = true;
      } else {
        const nextFps = resolveLowerFps(this.effectiveFps, this.policy.minFps);
        if (nextFps !== this.effectiveFps) {
          this.effectiveFps = nextFps;
          effectiveFpsChanged = true;
        }
      }
    } else if (this.policy.adaptive && overloadedRatio <= this.policy.upgradeRatio) {
      if (this.effectiveFps < this.policy.targetFps) {
        this.effectiveFps = resolveHigherFps(this.effectiveFps, this.policy.targetFps);
        effectiveFpsChanged = true;
      } else if (this.renderScale < this.policy.maxRenderScale - 0.001) {
        this.renderScale = Math.min(this.policy.maxRenderScale, this.renderScale + this.policy.renderScaleStep);
        renderScaleChanged = true;
      }
    }

    this.lastEvaluationAt = timestamp;
    this.sampleDurations = [];
    this.sampleOverBudgetFrames = 0;
    this.sampleFrames = 0;
    return { renderScaleChanged, effectiveFpsChanged };
  }

  shouldContinue(isBackground: boolean): boolean {
    return this.policy.mode !== 'paused' && (!isBackground || this.policy.backgroundFps > 0);
  }

  getRenderScale(): number {
    return this.renderScale;
  }

  getSnapshot(): VisualizerFrameRateSnapshot {
    return {
      mode: this.policy.mode,
      targetFps: this.policy.targetFps,
      effectiveFps: this.effectiveFps,
      backgroundFps: this.policy.backgroundFps,
      renderScale: this.renderScale,
      renderedFrames: this.renderedFrames,
      skippedFrames: this.skippedFrames,
      droppedFrames: this.droppedFrames,
      lastFrameMs: this.lastFrameMs,
      avgFrameMs: this.avgFrameMs,
      p95FrameMs: this.p95FrameMs,
      actualFps: this.actualFps,
      frameBudgetMs: 1000 / Math.max(1, this.effectiveFps),
      sampleWindowMs: this.policy.sampleWindowMs,
    };
  }
}
