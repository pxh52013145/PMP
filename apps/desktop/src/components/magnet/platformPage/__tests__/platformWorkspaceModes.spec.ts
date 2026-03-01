import { describe, expect, it } from 'vitest';

import type { PlatformConnectorDefinition } from '../../../../modules/music-platform';
import {
  buildPlatformWorkspaceDescriptors,
  GENERIC_PLATFORM_WORKSPACE_MODE,
  getWorkspaceConnectorId,
  normalizeWorkspaceMode,
  toConnectorWorkspaceMode,
} from '../platformWorkspaceModes';

function createDefinition(
  connectorId: PlatformConnectorDefinition['connectorId'],
  displayName: string,
  workspaceMode: PlatformConnectorDefinition['workspaceMode'],
  workspaceKind: PlatformConnectorDefinition['workspaceKind'] = 'generic'
): PlatformConnectorDefinition {
  return {
    connectorId,
    displayName,
    labelKey: `platform.${displayName}`,
    iconKey: displayName,
    enabled: true,
    authFlow: workspaceMode === 'dedicated' ? 'qr' : 'none',
    workspaceMode,
    workspaceKind,
    sortOrder: 1,
  };
}

describe('platformWorkspaceModes', () => {
  it('builds dedicated descriptors only for connectors with dedicated workspace', () => {
    const descriptors = buildPlatformWorkspaceDescriptors([
      createDefinition('connector.platform.qqmusic', 'QQ Music', 'generic-only'),
      createDefinition('connector.platform.bilibili', 'Bilibili', 'dedicated', 'bilibili'),
      createDefinition('connector.platform.netease', 'Netease', 'generic-only'),
    ]);

    expect(descriptors.map((item) => item.mode)).toEqual([
      'workspace:connector.platform.bilibili',
      GENERIC_PLATFORM_WORKSPACE_MODE,
    ]);
    expect(descriptors[0]?.connectorId).toBe('connector.platform.bilibili');
    expect(descriptors[0]?.workspaceKind).toBe('bilibili');
  });

  it('always appends generic fallback descriptor', () => {
    const descriptors = buildPlatformWorkspaceDescriptors([]);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.mode).toBe(GENERIC_PLATFORM_WORKSPACE_MODE);
    expect(descriptors[0]?.workspaceKind).toBe('generic');
  });

  it('normalizes invalid mode to first descriptor mode', () => {
    const descriptors = buildPlatformWorkspaceDescriptors([
      createDefinition('connector.platform.bilibili', 'Bilibili', 'dedicated', 'bilibili'),
    ]);

    const normalized = normalizeWorkspaceMode('workspace:connector.platform.unknown', descriptors);
    expect(normalized).toBe('workspace:connector.platform.bilibili');
  });

  it('supports mode <-> connector round trip', () => {
    const mode = toConnectorWorkspaceMode('connector.platform.bilibili');
    expect(mode).toBe('workspace:connector.platform.bilibili');
    expect(getWorkspaceConnectorId(mode)).toBe('connector.platform.bilibili');
    expect(getWorkspaceConnectorId(GENERIC_PLATFORM_WORKSPACE_MODE)).toBeNull();
  });
});
