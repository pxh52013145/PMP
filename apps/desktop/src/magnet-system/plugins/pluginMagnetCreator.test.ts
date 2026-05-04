import { describe, expect, it } from 'vitest';
import type { InstalledHostExtensionRecord } from './extensions';
import { validateInstalledExtensionManifest } from './extensions';
import { supportsInstalledExtensionMagnetSurface } from './installedExtensionHostPmp';
import {
  buildPluginMagnetCreatorArtifacts,
  buildPluginMagnetMinimalManifest,
  createPluginMagnetCreatorDraftFromInstalledExtension,
  normalizePluginMagnetCreatorDraft,
  validatePluginMagnetCreatorDraft,
} from './pluginMagnetCreator';

describe('plugin magnet creator', () => {
  it('builds a manifest-v2 webview magnet contribution accepted by the installed extension validator', () => {
    const draft = normalizePluginMagnetCreatorDraft({
      pluginId: 'creator-demo',
      displayName: 'Creator Demo',
      anchorMode: 'rectangular',
      originX: 2,
      originY: 3,
      width: 4,
      height: 2,
      defaultVariant: 'expanded',
      variants: [
        {
          id: 'compact',
          label: 'Compact',
          description: '',
        },
        {
          id: 'expanded',
          label: 'Expanded',
          description: 'Roomier surface',
        },
      ],
    });

    const manifest = buildPluginMagnetMinimalManifest(draft);

    expect(() => validateInstalledExtensionManifest(manifest)).not.toThrow();
    expect(supportsInstalledExtensionMagnetSurface({ manifest })).toBe(true);
    expect(manifest.activationEvents).toEqual(['onView:creator-demo']);
    expect(manifest.contributes?.host?.pmp?.magnets?.defaultAnchor).toEqual({
      type: 'range',
      coordinates: [
        { x: 2, y: 3 },
        { x: 5, y: 4 },
      ],
    });
  });

  it('keeps manifest and runtime snippets aligned with the normal surface host chain', () => {
    const artifacts = buildPluginMagnetCreatorArtifacts({
      pluginId: 'runtime-template-demo',
      displayName: 'Runtime Template Demo',
    });

    expect(artifacts.validation.ok).toBe(true);
    expect(artifacts.manifestPatch).toMatchObject({
      runtimes: [
        {
          runtimeId: 'webview.main',
          kind: 'webview',
          entry: 'index.js',
          bridge: 'pxp.runtime.bridge.v1',
        },
      ],
      activationEvents: ['onView:runtime-template-demo'],
      contributes: {
        host: {
          pmp: {
            magnets: expect.any(Object),
          },
        },
      },
    });
    expect(artifacts.runtimeTemplate).toContain('export function mount');
    expect(artifacts.runtimeTemplate).toContain('Runtime Template Demo');
  });

  it('flags runtime paths and variants that would not survive installed extension validation', () => {
    const result = validatePluginMagnetCreatorDraft({
      pluginId: 'bad_plugin',
      runtimeEntry: '../dist/index.js',
      defaultVariant: 'missing',
      variants: [
        {
          id: 'bad_variant',
          label: '',
          description: '',
        },
        {
          id: 'bad_variant',
          label: 'Duplicate',
          description: '',
        },
      ],
      defaultStyleText: '[]',
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'runtimeEntry.segments',
        'variant.pattern',
        'variant.duplicate',
        'defaultStyle.json',
      ])
    );
  });

  it('seeds drafts from installed extension magnet metadata', () => {
    const record: InstalledHostExtensionRecord = {
      enabled: true,
      installedAt: 100,
      manifest: {
        schemaVersion: '2.0',
        kind: 'extension',
        identity: {
          id: 'seed-demo',
          publisher: 'pixel-matrix.dev',
          version: '0.2.0',
          name: 'seed-demo',
          displayName: 'Seed Demo',
        },
        hostTargets: [{ hostId: 'pmp', required: true }],
        runtimes: [
          {
            runtimeId: 'webview.main',
            kind: 'webview',
            entry: 'src/index.js',
          },
        ],
        contributes: {
          host: {
            pmp: {
              magnets: {
                defaultAnchor: {
                  type: 'range',
                  coordinates: [
                    { x: 1, y: 1 },
                    { x: 1, y: 3 },
                  ],
                },
                defaultStyle: {
                  width: '100%',
                  height: '100%',
                },
                defaultVariant: 'tall',
                variants: [
                  {
                    id: 'tall',
                    label: 'Tall',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const draft = createPluginMagnetCreatorDraftFromInstalledExtension(record);

    expect(draft).toMatchObject({
      pluginId: 'seed-demo',
      displayName: 'Seed Demo',
      runtimeEntry: 'src/index.js',
      anchorMode: 'vertical',
      originX: 1,
      originY: 1,
      height: 3,
      defaultVariant: 'tall',
    });
  });
});
