import { describe, expect, it } from 'vitest';

import {
  getPlatformWorkspaceAdapter,
  resolvePlatformWorkspaceAdapter,
} from '../platformWorkspaceAdapterRegistry';

describe('platformWorkspaceAdapterRegistry', () => {
  it('resolves bilibili dedicated workspace adapter', () => {
    const adapter = getPlatformWorkspaceAdapter('bilibili');
    expect(adapter).not.toBeNull();
    expect(adapter?.workspaceKind).toBe('bilibili');
  });

  it('returns null for generic workspace kind', () => {
    const adapter = getPlatformWorkspaceAdapter('generic');
    expect(adapter).toBeNull();
  });

  it('resolves connector-specific adapter before workspace kind fallback', () => {
    const adapter = resolvePlatformWorkspaceAdapter({
      connectorId: 'connector.platform.bilibili',
      workspaceKind: 'generic',
    });
    expect(adapter).not.toBeNull();
    expect(adapter?.workspaceKind).toBe('bilibili');
  });

  it('returns null for unknown connector and generic kind', () => {
    const adapter = resolvePlatformWorkspaceAdapter({
      connectorId: 'connector.platform.unknown',
      workspaceKind: 'generic',
    });
    expect(adapter).toBeNull();
  });
});
