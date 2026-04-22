import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BilibiliFavoriteResourceItem,
  BilibiliPlaybackQualityOption,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';
import { buildBilibiliResourceIdentity } from '../../../modules/music-platform/bilibiliWorkspaceModel';
import { useBilibiliResourceEnhancer } from './useBilibiliResourceEnhancer';

const runtimeState = vi.hoisted(() => ({
  resolveCoverAssetUrl: vi.fn(),
  listPlaybackQualities: vi.fn(),
}));

vi.mock('./bilibiliWorkspaceRuntime', () => ({
  resolveBilibiliWorkspaceCoverAssetUrl: runtimeState.resolveCoverAssetUrl,
  listBilibiliWorkspacePlaybackQualities: runtimeState.listPlaybackQualities,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

function createResource(
  overrides: Partial<BilibiliFavoriteResourceItem> & Pick<BilibiliFavoriteResourceItem, 'resourceId'>
): BilibiliFavoriteResourceItem {
  return {
    resourceId: overrides.resourceId,
    title: overrides.title ?? overrides.resourceId,
    ownerName: overrides.ownerName ?? 'Uploader',
    durationSeconds: overrides.durationSeconds ?? 120,
    coverUrl: overrides.coverUrl,
    sourceLocator: overrides.sourceLocator ?? `bilibili://video/${overrides.resourceId}`,
    lyricLocator: overrides.lyricLocator,
    bvid: overrides.bvid,
    cid: overrides.cid,
    contentKind: overrides.contentKind ?? 'video',
    webUrl: overrides.webUrl,
  };
}

type HookParams = Parameters<typeof useBilibiliResourceEnhancer>[0];
type HookResult = ReturnType<typeof useBilibiliResourceEnhancer>;

function HookHarness(props: { params: HookParams; onChange: (value: HookResult) => void }) {
  const value = useBilibiliResourceEnhancer(props.params);
  useEffect(() => {
    props.onChange(value);
  }, [props, value]);
  return null;
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function renderHarness(params: HookParams): Promise<{
  root: Root;
  container: HTMLDivElement;
  getLatestResult: () => HookResult | null;
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestResult: HookResult | null = null;

  await act(async () => {
    root.render(
      <HookHarness
        params={params}
        onChange={(value) => {
          latestResult = value;
        }}
      />
    );
    await flushEffects();
  });

  return {
    root,
    container,
    getLatestResult: () => latestResult,
  };
}

let mountedRoot: { root: Root; container: HTMLDivElement } | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  runtimeState.resolveCoverAssetUrl.mockReset();
  runtimeState.listPlaybackQualities.mockReset();
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => {
      mountedRoot?.root.unmount();
      await flushEffects();
    });
    mountedRoot = null;
  }
  document.body.innerHTML = '';
});

describe('useBilibiliResourceEnhancer', () => {
  it('does not re-request in-flight cover resolutions after state updates', async () => {
    const firstCover = createDeferred<string | undefined>();
    const secondCover = createDeferred<string | undefined>();
    runtimeState.resolveCoverAssetUrl.mockImplementation((target: unknown, coverUrl: string) => {
      void target;
      if (coverUrl === 'https://img.example/one.jpg') return firstCover.promise;
      if (coverUrl === 'https://img.example/two.jpg') return secondCover.promise;
      throw new Error(`Unexpected cover url: ${coverUrl}`);
    });

    const resources = [
      createResource({
        resourceId: 'cover-1',
        coverUrl: 'https://img.example/one.jpg',
        sourceLocator: 'bilibili://video/BVcover1',
      }),
      createResource({
        resourceId: 'cover-2',
        coverUrl: 'https://img.example/two.jpg',
        sourceLocator: 'bilibili://video/BVcover2',
      }),
    ];

    const mounted = await renderHarness({
      bilibiliRuntimeTarget: {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        instanceId: 'instance:cover',
      },
      bilibiliAuthorized: true,
      selectedFolderId: null,
      bilibiliResources: resources,
      filteredBilibiliResources: resources,
      isVideoSourceLocator: () => true,
      getResourceCacheKey: buildBilibiliResourceIdentity,
    });
    mountedRoot = {
      root: mounted.root,
      container: mounted.container,
    };

    expect(runtimeState.resolveCoverAssetUrl).toHaveBeenCalledTimes(2);

    await act(async () => {
      firstCover.resolve('asset://cover-one');
      await flushEffects();
    });

    expect(runtimeState.resolveCoverAssetUrl).toHaveBeenCalledTimes(2);
    expect(mounted.getLatestResult()?.resourceCoverUrlMap).toMatchObject({
      [buildBilibiliResourceIdentity(resources[0])]: 'asset://cover-one',
    });

    await act(async () => {
      secondCover.resolve('asset://cover-two');
      await flushEffects();
    });

    expect(runtimeState.resolveCoverAssetUrl).toHaveBeenCalledTimes(2);
    expect(mounted.getLatestResult()?.resourceCoverUrlMap).toMatchObject({
      [buildBilibiliResourceIdentity(resources[0])]: 'asset://cover-one',
      [buildBilibiliResourceIdentity(resources[1])]: 'asset://cover-two',
    });
  });

  it('probes each visible video locator only once and fans out badges to matching resources', async () => {
    const firstLocator = createDeferred<BilibiliPlaybackQualityOption[]>();
    const secondLocator = createDeferred<BilibiliPlaybackQualityOption[]>();
    runtimeState.listPlaybackQualities.mockImplementation((target: unknown, locator: string) => {
      void target;
      if (locator === 'bilibili://video/BVshared') return firstLocator.promise;
      if (locator === 'bilibili://video/BVunique') return secondLocator.promise;
      throw new Error(`Unexpected locator: ${locator}`);
    });

    const sharedLocator = 'bilibili://video/BVshared';
    const uniqueLocator = 'bilibili://video/BVunique';
    const resources = [
      createResource({
        resourceId: 'quality-1',
        sourceLocator: sharedLocator,
      }),
      createResource({
        resourceId: 'quality-2',
        sourceLocator: sharedLocator,
      }),
      createResource({
        resourceId: 'quality-3',
        sourceLocator: uniqueLocator,
      }),
    ];

    const mounted = await renderHarness({
      bilibiliRuntimeTarget: {
        connectorId: 'connector.platform.bilibili',
        displayName: 'Bilibili',
        instanceId: 'instance:quality',
      },
      bilibiliAuthorized: true,
      selectedFolderId: 'favorites',
      bilibiliResources: resources,
      filteredBilibiliResources: resources,
      isVideoSourceLocator: (locator) => locator.includes('bilibili://video/'),
      getResourceCacheKey: buildBilibiliResourceIdentity,
    });
    mountedRoot = {
      root: mounted.root,
      container: mounted.container,
    };

    expect(runtimeState.listPlaybackQualities).toHaveBeenCalledTimes(2);
    expect(runtimeState.listPlaybackQualities).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      sharedLocator
    );
    expect(runtimeState.listPlaybackQualities).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      uniqueLocator
    );

    await act(async () => {
      firstLocator.resolve([
        { key: 'hires', label: 'Hi-Res', available: true },
        { key: 'auto', label: 'Auto', available: true },
      ]);
      await flushEffects();
    });

    expect(runtimeState.listPlaybackQualities).toHaveBeenCalledTimes(2);
    expect(mounted.getLatestResult()?.resourceQualityTagMap).toMatchObject({
      [buildBilibiliResourceIdentity(resources[0])]: ['hires'],
      [buildBilibiliResourceIdentity(resources[1])]: ['hires'],
    });

    await act(async () => {
      secondLocator.resolve([
        { key: 'dolby', label: 'Dolby', available: true },
        { key: 'auto', label: 'Auto', available: true },
      ]);
      await flushEffects();
    });

    expect(runtimeState.listPlaybackQualities).toHaveBeenCalledTimes(2);
    expect(mounted.getLatestResult()?.resourceQualityTagMap).toMatchObject({
      [buildBilibiliResourceIdentity(resources[0])]: ['hires'],
      [buildBilibiliResourceIdentity(resources[1])]: ['hires'],
      [buildBilibiliResourceIdentity(resources[2])]: ['dolby'],
    });
  });
});
