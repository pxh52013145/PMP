import { describe, expect, it } from 'vitest';
import { parseNavigationParams } from './navigationParams';

describe('parseNavigationParams', () => {
  it('preserves sourceKind for plugin-page params', () => {
    expect(
      parseNavigationParams('plugin-page', {
        pluginId: 'demo-plugin',
        pageId: 'demo-page',
        sourceKind: 'extv2',
      })
    ).toEqual({
      pluginId: 'demo-plugin',
      pageId: 'demo-page',
      sourceKind: 'extv2',
    });
  });

  it('preserves sourceKind for plugin-visualizer params', () => {
    expect(
      parseNavigationParams('plugin-visualizer', {
        pluginId: 'demo-plugin',
        visualizerId: 'demo-visualizer',
        sourceKind: 'extv2',
      })
    ).toEqual({
      pluginId: 'demo-plugin',
      visualizerId: 'demo-visualizer',
      sourceKind: 'extv2',
    });
  });

  it('drops invalid sourceKind values while keeping valid plugin route params', () => {
    expect(
      parseNavigationParams('plugin-page', {
        pluginId: 'demo-plugin',
        pageId: 'demo-page',
        sourceKind: 'invalid-kind',
      })
    ).toEqual({
      pluginId: 'demo-plugin',
      pageId: 'demo-page',
      sourceKind: undefined,
    });
  });
});
