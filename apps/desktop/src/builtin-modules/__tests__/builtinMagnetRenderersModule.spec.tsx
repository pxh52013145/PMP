import { beforeEach, describe, expect, it } from 'vitest';

import { clearMagnetRenderers } from '../../magnet-system/registry';
import { clearMagnetVariants, listMagnetVariants } from '../../magnet-system/variantRegistry';
import { createBuiltinMagnetRenderersModule } from '../builtinMagnetRenderersModule';

beforeEach(() => {
  clearMagnetRenderers();
  clearMagnetVariants();
});

describe('builtinMagnetRenderersModule', () => {
  it('registers builtin variant catalogs for skin-authored magnets', () => {
    const module = createBuiltinMagnetRenderersModule();
    const deactivate = module.activate({} as never);

    expect(listMagnetVariants('navigation-page').map((variant) => variant.id)).toEqual([
      'default',
      'inline-sources',
      'compact-meta',
    ]);
    expect(listMagnetVariants('platform-magnet').map((variant) => variant.id)).toEqual([
      'default',
      'search-focus',
      'workspace-bilibili',
    ]);
    expect(listMagnetVariants('btn-platform-login').map((variant) => variant.id)).toEqual([
      'default',
      'quick-bilibili',
      'multi-platform',
    ]);
    expect(listMagnetVariants('btn-window-pin').map((variant) => variant.id)).toEqual([
      'default',
      'minimal',
      'signal',
    ]);
    expect(listMagnetVariants('btn-play-pause').map((variant) => variant.id)).toEqual([
      'default',
      'labeled',
      'queue-chip',
      'ambient',
    ]);
    expect(listMagnetVariants('btn-previous').map((variant) => variant.id)).toEqual([
      'default',
      'queue-hint',
      'labeled',
    ]);
    expect(listMagnetVariants('btn-next').map((variant) => variant.id)).toEqual([
      'default',
      'queue-hint',
      'labeled',
    ]);
    expect(listMagnetVariants('btn-mode').map((variant) => variant.id)).toEqual([
      'default',
      'badge-chip',
      'ambient',
    ]);
    expect(listMagnetVariants('btn-volume').map((variant) => variant.id)).toEqual([
      'default',
      'compact',
      'dock-start',
    ]);
    expect(listMagnetVariants('btn-desktop-lyrics').map((variant) => variant.id)).toEqual([
      'default',
      'status-dot',
      'full-label',
      'compact-icon',
    ]);
    expect(listMagnetVariants('progress-bar').map((variant) => variant.id)).toEqual([
      'default',
      'minimal',
      'monitor',
    ]);
    expect(listMagnetVariants('btn-play-queue').map((variant) => variant.id)).toEqual([
      'default',
      'monitor',
      'minimal',
    ]);
    expect(listMagnetVariants('btn-playlists').map((variant) => variant.id)).toEqual([
      'default',
      'badge',
      'chip',
    ]);
    expect(listMagnetVariants('btn-music-library').map((variant) => variant.id)).toEqual([
      'default',
      'indicator',
      'chip',
    ]);
    expect(listMagnetVariants('btn-back').map((variant) => variant.id)).toEqual([
      'default',
      'outline',
      'history-chip',
    ]);
    expect(listMagnetVariants('btn-debug').map((variant) => variant.id)).toEqual([
      'default',
      'status-dot',
      'quiet',
    ]);
    expect(listMagnetVariants('btn-matrix-change').map((variant) => variant.id)).toEqual([
      'default',
      'badge-only',
      'compact-panel',
    ]);
    expect(listMagnetVariants('process-perf-monitor').map((variant) => variant.id)).toEqual([
      'default',
      'compact',
      'cpu-focus',
    ]);
    expect(listMagnetVariants('dsp-vst').map((variant) => variant.id)).toEqual([
      'default',
      'status-chip',
      'compact',
    ]);
    expect(listMagnetVariants('audio-visualizer').map((variant) => variant.id)).toEqual([
      'default',
      'dense-halo',
      'minimal',
    ]);

    expect(listMagnetVariants('btn-matrix-change').find((variant) => variant.id === 'badge-only')?.metadata).toMatchObject({
      props: {
        showLabel: false,
        showPresetsAction: false,
        showHistoryAction: false,
        showDangerActions: false,
      },
    });
    expect(listMagnetVariants('dsp-vst').find((variant) => variant.id === 'status-chip')?.metadata).toMatchObject({
      props: {
        labelMode: 'status',
        showProgressDots: false,
        ringVisibility: 'status',
      },
    });
    expect(listMagnetVariants('audio-visualizer').find((variant) => variant.id === 'dense-halo')?.metadata).toMatchObject({
      props: {
        density: 'dense',
        energyProfile: 'bright',
        backdrop: 'soft',
      },
    });
    expect(listMagnetVariants('progress-bar').find((variant) => variant.id === 'monitor')?.metadata).toMatchObject({
      props: {
        trackDensity: 'thick',
        bufferLayers: 'all',
        thumbVisibility: 'always',
      },
    });
    expect(listMagnetVariants('btn-play-queue').find((variant) => variant.id === 'minimal')?.metadata).toMatchObject({
      props: {
        showCountBadge: false,
        showEditAction: false,
        showAddAction: false,
        showClearAction: false,
        autoScrollToActive: false,
      },
    });
    expect(listMagnetVariants('btn-back').find((variant) => variant.id === 'history-chip')?.metadata).toMatchObject({
      props: {
        iconStyle: 'outline',
        showHistoryCount: true,
      },
    });
    expect(listMagnetVariants('btn-play-pause').find((variant) => variant.id === 'ambient')?.metadata).toMatchObject({
      props: {
        showStateLabel: true,
        showQueueCount: true,
        pulseMode: 'always',
      },
    });
    expect(listMagnetVariants('btn-desktop-lyrics').find((variant) => variant.id === 'compact-icon')?.metadata).toMatchObject({
      props: {
        labelMode: 'icon',
        showActiveIndicator: true,
        showClickThroughBadge: true,
      },
    });
    expect(listMagnetVariants('navigation-page').find((variant) => variant.id === 'compact-meta')?.metadata).toMatchObject({
      props: {
        showLibraryStats: false,
        placeholderMode: 'minimal',
      },
    });

    if (typeof deactivate === 'function') {
      deactivate();
    }

    expect(listMagnetVariants('navigation-page')).toEqual([]);
    expect(listMagnetVariants('platform-magnet')).toEqual([]);
    expect(listMagnetVariants('btn-platform-login')).toEqual([]);
    expect(listMagnetVariants('btn-window-pin')).toEqual([]);
    expect(listMagnetVariants('btn-play-pause')).toEqual([]);
    expect(listMagnetVariants('btn-previous')).toEqual([]);
    expect(listMagnetVariants('btn-next')).toEqual([]);
    expect(listMagnetVariants('btn-mode')).toEqual([]);
    expect(listMagnetVariants('btn-volume')).toEqual([]);
    expect(listMagnetVariants('btn-desktop-lyrics')).toEqual([]);
    expect(listMagnetVariants('progress-bar')).toEqual([]);
    expect(listMagnetVariants('btn-play-queue')).toEqual([]);
    expect(listMagnetVariants('btn-playlists')).toEqual([]);
    expect(listMagnetVariants('btn-music-library')).toEqual([]);
    expect(listMagnetVariants('btn-back')).toEqual([]);
    expect(listMagnetVariants('btn-debug')).toEqual([]);
    expect(listMagnetVariants('btn-matrix-change')).toEqual([]);
    expect(listMagnetVariants('process-perf-monitor')).toEqual([]);
    expect(listMagnetVariants('dsp-vst')).toEqual([]);
    expect(listMagnetVariants('audio-visualizer')).toEqual([]);
  });
});
