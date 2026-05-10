import { describe, expect, it } from 'vitest';
import type { Magnet } from '../../types/pixel';
import {
  applyMagnetSkinPropsToLibrary,
  applyMagnetVariantToLibrary,
  buildPluginStudioDiagnostics,
  getPluginStudioDiagnosticAreaLabelKey,
  getPluginStudioDiagnosticSeverityLabelKey,
} from './pluginStudioModel';

function createMagnet(overrides: Partial<Magnet> = {}): Magnet {
  return {
    id: 'demo-magnet',
    type: 'custom',
    name: 'Demo Magnet',
    renderer: 'demo-renderer',
    anchors: [{ id: 'anchor', gridX: 0, gridY: 0, role: 'anchor' }],
    anchorType: 'single',
    bounds: {
      horizontal: {
        start: { source: 'slot', edge: 'start' },
        end: { source: 'slot', edge: 'end' },
      },
      vertical: {
        start: { source: 'slot', edge: 'start' },
        end: { source: 'slot', edge: 'end' },
      },
    },
    content: '',
    style: {},
    state: 'idle',
    interactions: { draggable: false, clickable: true },
    ...overrides,
  };
}

function buildDiagnosticsForMagnets(args: {
  magnets: Magnet[];
  activeIds?: string[];
  rendererIds?: string[];
  variantsByRendererId?: Map<string, Array<{ id: string; label: string }>>;
}) {
  return buildPluginStudioDiagnostics({
    installedExtensions: [],
    runtimeResolutionByExtensionId: new Map(),
    devSessions: [],
    auditLog: [],
    magnetLibrary: args.magnets,
    activeMagnetIds: new Set(args.activeIds ?? []),
    registeredRenderers: (args.rendererIds ?? []).map((id) => ({ id, render: () => null })),
    variantsByRendererId: args.variantsByRendererId ?? new Map(),
  });
}

describe('plugin studio model', () => {
  it('updates and clears a magnet variant without mutating the original library', () => {
    const magnet = createMagnet();
    const library = [magnet];

    const withVariant = applyMagnetVariantToLibrary(library, 'demo-magnet', 'compact');
    expect(withVariant[0]).toMatchObject({ id: 'demo-magnet', variant: 'compact' });
    expect(library[0].variant).toBeUndefined();

    const cleared = applyMagnetVariantToLibrary(withVariant, 'demo-magnet', null);
    expect(cleared[0].variant).toBeUndefined();
  });

  it('updates and clears magnet skin props without mutating the original library', () => {
    const magnet = createMagnet();
    const library = [magnet];

    const withSkinProps = applyMagnetSkinPropsToLibrary(library, 'demo-magnet', {
      showLabel: true,
    });
    expect(withSkinProps[0]).toMatchObject({
      id: 'demo-magnet',
      skinProps: { showLabel: true },
    });
    expect(library[0].skinProps).toBeUndefined();

    const cleared = applyMagnetSkinPropsToLibrary(withSkinProps, 'demo-magnet', null);
    expect(cleared[0].skinProps).toBeUndefined();
  });

  it('maps diagnostic labels to i18n keys', () => {
    expect(getPluginStudioDiagnosticAreaLabelKey('runtime')).toBe(
      'settings.plugins.studio.diagnostics.area.runtime'
    );
    expect(getPluginStudioDiagnosticSeverityLabelKey('warning')).toBe(
      'settings.plugins.studio.diagnostics.severity.warning'
    );
  });

  it('reports active magnets with missing renderers', () => {
    const diagnostics = buildDiagnosticsForMagnets({
      magnets: [createMagnet({ renderer: 'missing-renderer' })],
      activeIds: ['demo-magnet'],
      rendererIds: ['demo-renderer'],
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'magnet:demo-magnet:missingRenderer',
          severity: 'error',
        }),
      ])
    );
  });

  it('reports unknown variants only when the renderer publishes a variant catalog', () => {
    const diagnostics = buildDiagnosticsForMagnets({
      magnets: [createMagnet({ variant: 'ghost' })],
      activeIds: ['demo-magnet'],
      rendererIds: ['demo-renderer'],
      variantsByRendererId: new Map([
        [
          'demo-renderer',
          [
            { id: 'default', label: 'Default' },
            { id: 'compact', label: 'Compact' },
          ],
        ],
      ]),
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'magnet:demo-magnet:unknownVariant',
          severity: 'warning',
        }),
      ])
    );
  });

  it('returns a clean diagnostic when plugin-domain checks pass', () => {
    const diagnostics = buildDiagnosticsForMagnets({
      magnets: [createMagnet()],
      activeIds: ['demo-magnet'],
      rendererIds: ['demo-renderer'],
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        id: 'studio:clean',
        severity: 'info',
      }),
    ]);
  });
});
