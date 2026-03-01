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

  it('resolves netease and qqmusic dedicated workspace adapters', () => {
    const neteaseAdapter = getPlatformWorkspaceAdapter('netease');
    const qqmusicAdapter = getPlatformWorkspaceAdapter('qqmusic');

    expect(neteaseAdapter).not.toBeNull();
    expect(neteaseAdapter?.workspaceKind).toBe('netease');

    expect(qqmusicAdapter).not.toBeNull();
    expect(qqmusicAdapter?.workspaceKind).toBe('qqmusic');
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

  it('resolves netease/qqmusic adapters by connector id even with generic fallback kind', () => {
    const neteaseAdapter = resolvePlatformWorkspaceAdapter({
      connectorId: 'connector.platform.netease',
      workspaceKind: 'generic',
    });
    const qqmusicAdapter = resolvePlatformWorkspaceAdapter({
      connectorId: 'connector.platform.qqmusic',
      workspaceKind: 'generic',
    });

    expect(neteaseAdapter?.workspaceKind).toBe('netease');
    expect(qqmusicAdapter?.workspaceKind).toBe('qqmusic');
  });
});
