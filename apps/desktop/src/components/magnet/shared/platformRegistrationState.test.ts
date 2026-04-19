import { describe, expect, it } from 'vitest';

import type {
  PlatformConnectorDefinition,
  PlatformInstanceAuthSnapshot,
  PlatformRenderSelectionRecord,
} from '../../../modules/music-platform';
import {
  filterMountedPlatformRegistrationItems,
  resolveActiveMountedPlatformRegistrationItem,
  resolvePlatformRegistrationState,
} from './platformRegistrationState';

function createDefinition(
  connectorId: PlatformConnectorDefinition['connectorId'],
  enabled = true
): PlatformConnectorDefinition {
  return {
    connectorId,
    displayName: connectorId,
    labelKey: `label.${connectorId}`,
    iconKey: 'music',
    enabled,
    authFlow: 'qr',
    workspaceKind: 'generic',
    workspaceMode: 'generic-only',
    sortOrder: 1,
  };
}

function createSnapshot(authState: PlatformInstanceAuthSnapshot['authState']): PlatformInstanceAuthSnapshot {
  return {
    instanceId: 'instance',
    platformId: 'platform',
    connectorId: 'connector.platform.demo',
    displayName: 'Demo',
    authState,
  };
}

function createRenderSelection(mounted: boolean): PlatformRenderSelectionRecord {
  return {
    instanceId: 'instance',
    mounted,
  };
}

function createRegisteredItem(connectorId: string, mounted: boolean) {
  return {
    entry: {
      connectorId,
    },
    renderSelection: createRenderSelection(mounted),
  };
}

describe('resolvePlatformRegistrationState', () => {
  it('maps authorized instances to active or inactive based on render selection', () => {
    const definition = createDefinition('connector.platform.demo');

    expect(
      resolvePlatformRegistrationState(
        definition,
        createSnapshot('authorized'),
        createRenderSelection(true)
      )
    ).toBe('active');
    expect(
      resolvePlatformRegistrationState(
        definition,
        createSnapshot('authorized'),
        createRenderSelection(false)
      )
    ).toBe('inactive');
  });

  it('maps pending, unauthorized and disabled connectors to their visual states', () => {
    expect(
      resolvePlatformRegistrationState(
        createDefinition('connector.platform.pending'),
        createSnapshot('pending'),
        null
      )
    ).toBe('pending');
    expect(
      resolvePlatformRegistrationState(
        createDefinition('connector.platform.unauthorized'),
        createSnapshot('unauthorized'),
        null
      )
    ).toBe('unauthorized');
    expect(
      resolvePlatformRegistrationState(
        {
          ...createDefinition('connector.platform.disabled', false),
          authFlow: 'none',
        },
        null,
        null
      )
    ).toBe('disabled');
  });
});

describe('mounted platform registration helpers', () => {
  it('filters out unmounted registrations from page-level feature candidates', () => {
    const items = [
      createRegisteredItem('connector.platform.visible', true),
      createRegisteredItem('connector.platform.hidden', false),
    ];

    expect(filterMountedPlatformRegistrationItems(items)).toEqual([items[0]]);
  });

  it('resolves the active platform page item only from mounted registrations', () => {
    const mountedFallback = createRegisteredItem('connector.platform.visible', true);
    const hiddenSelected = createRegisteredItem('connector.platform.hidden', false);

    expect(
      resolveActiveMountedPlatformRegistrationItem(hiddenSelected.entry.connectorId, [
        hiddenSelected,
        mountedFallback,
      ])
    ).toBe(mountedFallback);
    expect(
      resolveActiveMountedPlatformRegistrationItem('connector.platform.none', [hiddenSelected])
    ).toBeNull();
  });
});
