# Smoke Tests (Phase 0)

> 目的：在重构/优化过程中快速验证关键路径；测试基于 Vitest + jsdom，可直接纳入 CI。

## Running

- `pnpm --filter @pixel-matrix/desktop test`
- `pnpm --filter @pixel-matrix/desktop test:watch`

## Current Coverage (Baseline)

- **Config Load/Save**: `apps/desktop/src/utils/__tests__/configManager.spec.ts`
- **Magnet Layout Solver**: `apps/desktop/src/utils/__tests__/magnetPositionResolver.spec.ts`
- **Native Audio Playback Lifecycle**: `apps/desktop/src/services/audio/__tests__/NativeAudioService.spec.ts`

## Conventions

- New tests should live near code under `apps/desktop/src/**/__tests__/*.spec.ts`.
