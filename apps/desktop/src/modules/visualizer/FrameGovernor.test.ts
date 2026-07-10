import { describe, expect, it } from 'vitest';
import {
  normalizeVisualizerFrameRatePolicy,
  VisualizerFrameGovernor,
} from './FrameGovernor';

describe('VisualizerFrameGovernor', () => {
  it('normalizes a frame policy into a valid independent render budget', () => {
    expect(normalizeVisualizerFrameRatePolicy({})).toMatchObject({
      minRenderScale: 1,
      maxRenderScale: 1,
    });

    expect(normalizeVisualizerFrameRatePolicy({
      targetFps: 500,
      minFps: -2,
      backgroundFps: 999,
      minRenderScale: 1.5,
      maxRenderScale: 0.2,
    })).toMatchObject({
      targetFps: 240,
      minFps: 1,
      backgroundFps: 240,
      minRenderScale: 1,
      maxRenderScale: 1,
    });
  });

  it('paces rendering without using the shared application quality FPS', () => {
    const governor = new VisualizerFrameGovernor({
      targetFps: 60,
      minFps: 60,
      adaptive: false,
    });

    expect(governor.beginFrame(0, false)).toMatchObject({
      shouldRender: true,
      deltaTime: 1000 / 60,
      targetFps: 60,
    });
    governor.endFrame(0, 2);

    expect(governor.beginFrame(8, false).shouldRender).toBe(false);
    expect(governor.beginFrame(17, false)).toMatchObject({
      shouldRender: true,
      deltaTime: 17,
    });
  });

  it('suspends a background runtime at zero FPS until it is explicitly invalidated', () => {
    const governor = new VisualizerFrameGovernor({
      backgroundFps: 0,
      adaptive: false,
    });

    expect(governor.beginFrame(0, true).shouldRender).toBe(true);
    governor.endFrame(0, 1, true);
    expect(governor.shouldContinue(true)).toBe(false);
    expect(governor.beginFrame(16, true).shouldRender).toBe(false);

    governor.invalidate();
    expect(governor.beginFrame(32, true).shouldRender).toBe(true);
  });

  it('does not count time spent hidden as foreground render debt', () => {
    const governor = new VisualizerFrameGovernor({
      targetFps: 60,
      minFps: 60,
      backgroundFps: 0,
      adaptive: false,
    });

    governor.beginFrame(0, false);
    governor.endFrame(0, 1);
    governor.invalidate();
    governor.beginFrame(1_000, true);
    governor.endFrame(1_000, 1, true);
    governor.invalidate();
    const resumed = governor.beginFrame(5_000, false);

    expect(resumed).toMatchObject({ shouldRender: true, deltaTime: 1000 / 60 });
    expect(governor.getSnapshot().droppedFrames).toBe(0);
  });

  it('renders an invalidated paused frame but does not retain a render loop', () => {
    const governor = new VisualizerFrameGovernor({ mode: 'paused' });

    expect(governor.beginFrame(0, false).shouldRender).toBe(true);
    governor.endFrame(0, 1);
    expect(governor.shouldContinue(false)).toBe(false);
    expect(governor.beginFrame(16, false).shouldRender).toBe(false);

    governor.invalidate();
    expect(governor.beginFrame(32, false).shouldRender).toBe(true);
  });

  it('lowers render scale before reducing effective FPS, then reports sampled metrics', () => {
    const governor = new VisualizerFrameGovernor({
      targetFps: 60,
      minFps: 30,
      adaptive: true,
      sampleWindowMs: 250,
      frameBudgetRatio: 0.9,
      downgradeRatio: 0.1,
      minRenderScale: 0.8,
      maxRenderScale: 1,
      renderScaleStep: 0.1,
    });

    governor.beginFrame(0, false);
    governor.endFrame(0, 20);

    governor.beginFrame(250, false);
    expect(governor.endFrame(250, 20).renderScaleChanged).toBe(true);
    expect(governor.getSnapshot()).toMatchObject({ renderScale: 0.9, actualFps: 4 });

    governor.beginFrame(500, false);
    expect(governor.endFrame(500, 20).renderScaleChanged).toBe(true);
    expect(governor.getSnapshot().renderScale).toBeCloseTo(0.8, 5);

    governor.beginFrame(750, false);
    expect(governor.endFrame(750, 20).effectiveFpsChanged).toBe(true);
    expect(governor.getSnapshot()).toMatchObject({
      effectiveFps: 48,
      frameBudgetMs: 1000 / 48,
    });
  });
});
