import { describe, expect, it } from 'vitest';
import { MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT } from '@pixel-matrix/plugin-platform-contracts';

import { buildViewMountRequestSnapshot } from './runtimeBridgeSnapshots';

describe('runtimeBridgeSnapshots', () => {
  it('allows music platform workspace mounts to override view metadata', () => {
    const snapshot = buildViewMountRequestSnapshot({
      pluginId: 'platform-pack.test',
      runtimeId: 'platform-pack.test.workspace',
      runtimeInstanceId: 'runtime-instance-1',
      kind: 'page',
      surfaceId: 'workspace-root',
      mountContext: {
        connectorId: 'connector.platform.test',
      },
      viewType: 'music-platform-workspace-root',
      surfaceSlot: MUSIC_PLATFORM_WORKSPACE_ROOT_SURFACE_SLOT,
      mountMetadata: {
        scope: 'music-platform-workspace',
        connectorId: 'connector.platform.test',
        platformId: 'test',
        instanceId: 'test:builtin',
        workspace: {
          ownership: 'pack',
          requiredRuntimeCarrier: 'webview-frame',
        },
        root: {
          viewId: 'workspace-root',
          viewType: 'music-platform-workspace-root',
        },
      },
    });

    expect(snapshot).toMatchObject({
      viewId: 'workspace-root',
      viewType: 'music-platform-workspace-root',
      surfaceSlot: 'host.pmp.music-platform.workspace.root',
      mountMetadata: {
        scope: 'music-platform-workspace',
        connectorId: 'connector.platform.test',
        platformId: 'test',
        instanceId: 'test:builtin',
      },
      props: {
        surface: 'page',
        surfaceId: 'workspace-root',
        mountContext: {
          connectorId: 'connector.platform.test',
        },
      },
    });
  });
});
