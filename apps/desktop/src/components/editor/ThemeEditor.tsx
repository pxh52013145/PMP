import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { listRegisteredMagnetRenderers, type MagnetRendererDefinition } from '../../magnet-system/registry';
import { getInstalledPmpmPlugin, installPmpmPluginFromZipBytes } from '../../magnet-system/plugins/pmpm';
import { getInstalledPmpsShaderPack } from '../../shader-system/pmps';
import { installPmpsShaderPackFromZipBytes } from '../../shader-system/pmps';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import {
  createThemePackZipBytes,
  parseThemePackFromZipBytes,
  readPmpmMetaFromZipBytes,
  readPmpsMetaFromZipBytes,
  validateThemePackManifestV1,
  type ParsedThemePack,
  type ThemePackManifestV1,
} from '../../themes/packs/pmpk';
import { parseVariantPresetFromText, type VariantPresetV1 } from '../../themes/packs/pmpv';
import { satisfiesSemverRange } from '../../themes/packs/semver';
import type { ComponentTheme, Theme } from '../../themes/types/theme';
import type { Magnet } from '../../types/pixel';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from '../../utils/windowCommunication';

function formatRendererSource(
  t: (key: string, params?: Record<string, unknown>) => string,
  value: string | null | undefined
) {
  if (value === 'builtin') return t('common.source.builtin');
  if (value === 'plugin') return t('common.source.plugin');
  if (value === 'runtime') return t('common.source.runtime');
  return value || t('common.source.builtin');
}

function formatRendererGroup(
  t: (key: string, params?: Record<string, unknown>) => string,
  value: string | null | undefined
): string {
  if (!value) return t('editor.theme-debug.renderers.defaultGroup');
  return value;
}

type PanelMessage = { kind: 'error' | 'success'; text: string };

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error(`${path} must be an object`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateThemeJson(value: unknown): asserts value is Theme {
  assertObject(value, 'theme');

  if (typeof value.id !== 'string' || value.id.length < 1) {
    throw new Error('theme.id is required');
  }
  if (typeof value.name !== 'string' || value.name.length < 1) {
    throw new Error('theme.name is required');
  }
  if (typeof value.version !== 'string' || value.version.length < 1) {
    throw new Error('theme.version is required');
  }

  assertObject(value.shader, 'theme.shader');
  if (typeof value.shader.id !== 'string' || value.shader.id.length < 1) {
    throw new Error('theme.shader.id is required');
  }
  if (typeof value.shader.name !== 'string' || value.shader.name.length < 1) {
    throw new Error('theme.shader.name is required');
  }
  assertObject(value.shader.colors, 'theme.shader.colors');

  for (const slot of ['primary', 'secondary', 'accent', 'detail'] as const) {
    assertObject(value.shader.colors[slot], `theme.shader.colors.${slot}`);
    if (typeof value.shader.colors[slot].base !== 'string') {
      throw new Error(`theme.shader.colors.${slot}.base is required`);
    }
  }

  assertObject(value.pixel, 'theme.pixel');
  if (typeof value.pixel.shape !== 'string') {
    throw new Error('theme.pixel.shape is required');
  }
  if (typeof value.pixel.size !== 'number' || !Number.isFinite(value.pixel.size)) {
    throw new Error('theme.pixel.size must be a number');
  }
  if (typeof value.pixel.opacity !== 'number' || !Number.isFinite(value.pixel.opacity)) {
    throw new Error('theme.pixel.opacity must be a number');
  }

  assertObject(value.background, 'theme.background');
  assertObject(value.background.maximized, 'theme.background.maximized');
  assertObject(value.background.windowed, 'theme.background.windowed');

  assertObject(value.fonts, 'theme.fonts');
  if (typeof value.fonts.primary !== 'string' || value.fonts.primary.length < 1) {
    throw new Error('theme.fonts.primary is required');
  }
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

function normalizeBundlePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function buildDefaultThemePackManifest(theme: Theme): ThemePackManifestV1 {
  const id = isValidId(theme.id) ? theme.id : 'theme-pack';
  return {
    formatVersion: '1.0',
    type: 'theme-pack',
    metadata: {
      id,
      name: theme.name || id,
      version: theme.version || '0.0.0',
    },
    entry: {
      theme: 'theme.pmpt',
    },
  };
}

type ThemePackExportBundle = {
  kind: 'pmpm' | 'pmps';
  depId: string;
  bundlePath: string;
  fileName: string;
  bytes: Uint8Array;
  meta?: { id: string; version: string; name: string; permissions?: string[] };
  metaError?: string;
};

export type ThemeEditorProps = {
  magnetLibrary: Magnet[];
  applyRendererBindings: (
    bindings: Array<{ magnetId: string; rendererId: string }>
  ) => Promise<{ updated: number }>;
};

export function ThemeEditor({ magnetLibrary, applyRendererBindings }: ThemeEditorProps) {
  const t = useT();
  const { theme, applyTheme, updateComponentTheme } = useTheme();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [debugOpen, setDebugOpen] = useState(false);
  const [rendererList, setRendererList] = useState<MagnetRendererDefinition[]>(() =>
    listRegisteredMagnetRenderers()
  );
  const [selectedRendererId, setSelectedRendererId] = useState<string>(() => rendererList[0]?.id ?? '');
  const [themeJson, setThemeJson] = useState(() => JSON.stringify(theme, null, 2));
  const [themeMessage, setThemeMessage] = useState<PanelMessage | null>(null);
  const [themePack, setThemePack] = useState<ParsedThemePack | null>(null);
  const [themePackMessage, setThemePackMessage] = useState<PanelMessage | null>(null);
  const [variantPresetMessage, setVariantPresetMessage] = useState<PanelMessage | null>(null);
  const [dependencyRevision, setDependencyRevision] = useState(0);
  const [themePackExportManifestJson, setThemePackExportManifestJson] = useState(() =>
    JSON.stringify(buildDefaultThemePackManifest(theme), null, 2)
  );
  const [themePackExportBundles, setThemePackExportBundles] = useState<Record<string, ThemePackExportBundle>>(
    {}
  );
  const [themePackExportChecksumsEnabled, setThemePackExportChecksumsEnabled] = useState(true);

  const refreshRenderers = useCallback(() => {
    setRendererList(listRegisteredMagnetRenderers());
  }, []);

  const refreshDebugOpen = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/window');
      const win = WebviewWindow.getByLabel('editor-debug');
      if (!win) {
        setDebugOpen(false);
        return;
      }
      const visible = await win.isVisible().catch(() => false);
      setDebugOpen(visible);
    } catch {
      setDebugOpen(false);
    }
  }, []);

  useEffect(() => {
    void refreshDebugOpen();

    if (!isTauriRuntime()) return;

    const setup = async () => {
      const unlistenHidden = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_HIDDEN,
        (payload) => {
          if (payload === 'debug') setDebugOpen(false);
        }
      );

      const unlistenShown = await setupTauriListenerWithPayload<string>(
        TAURI_EVENTS.EDITOR_WINDOW_SHOWN,
        (payload) => {
          if (payload === 'debug') setDebugOpen(true);
        }
      );

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = setup();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [refreshDebugOpen]);

  const toggleDebug = useCallback(async () => {
    try {
      const { openEditorWindow, closeEditorWindow, calculateWindowPosition } = await import(
        '../../utils/editorWindows'
      );
      if (debugOpen) {
        await closeEditorWindow('debug');
        return;
      }
      const position = await calculateWindowPosition('debug');
      await openEditorWindow({ type: 'debug', ...position });
    } catch (error) {
      console.error('[ThemeEditor] Failed to toggle debug window', error);
    }
  }, [debugOpen]);

  useEffect(() => {
    setThemeJson(JSON.stringify(theme, null, 2));
  }, [theme]);

  const downloadVariantPresetPmpv = useCallback(() => {
    if (!selectedRendererId) {
      setVariantPresetMessage({ kind: 'error', text: t('editor.theme-editor.pmpv.message.noRenderer') });
      return;
    }

    try {
      const rendererId = selectedRendererId;
      const rawId = `${theme.id}-${rendererId}`;
      const id = isValidId(rawId) ? rawId : isValidId(rendererId) ? rendererId : 'variant-preset';

      const componentTheme = isPlainObject(theme.componentThemes?.[rendererId])
        ? (theme.componentThemes?.[rendererId] as unknown as Record<string, unknown>)
        : {};

      const preset: VariantPresetV1 = {
        formatVersion: '1.0',
        type: 'variant-preset',
        metadata: {
          id,
          name: `${theme.name || theme.id} / ${rendererId}`,
          version: theme.version || '0.0.0',
        },
        target: { rendererId },
        componentTheme,
      };

      const text = JSON.stringify(preset, null, 2);
      const filename = `${preset.metadata.id}.pmpv`;
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setVariantPresetMessage({
        kind: 'success',
        text: t('editor.theme-editor.pmpv.message.exported', { name: filename }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVariantPresetMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpv.message.exportFailed', { message }),
      });
    }
  }, [selectedRendererId, t, theme.componentThemes, theme.id, theme.name, theme.version]);

  const handleVariantPresetUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseVariantPresetFromText(text);

        const rendererId = parsed.target.rendererId;

        const ok = await confirm({
          title: t('editor.theme-editor.pmpv.import.confirm.title'),
          message: t('editor.theme-editor.pmpv.import.confirm.message', {
            rendererId,
            name: file.name,
          }),
          confirmText: t('editor.theme-editor.pmpv.import.confirm.confirm'),
        });
        if (!ok) return;

        const componentTheme = parsed.componentTheme as unknown as ComponentTheme;
        await updateComponentTheme(rendererId, componentTheme);

        setVariantPresetMessage({
          kind: 'success',
          text: t('editor.theme-editor.pmpv.message.applied', { rendererId }),
        });

        setSelectedRendererId((current) => {
          const exists = rendererList.some((renderer) => renderer.id === rendererId);
          return exists ? rendererId : current;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setVariantPresetMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpv.message.fileLoadFailed', { message }),
        });
      } finally {
        event.target.value = '';
      }
    },
    [confirm, rendererList, t, updateComponentTheme]
  );

  const applyThemeJson = useCallback(async () => {
    try {
      const parsed = JSON.parse(themeJson) as unknown;
      validateThemeJson(parsed);
      await applyTheme(parsed);
      setThemeMessage({ kind: 'success', text: t('editor.theme-editor.pmpt.message.applied') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemeMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpt.message.invalidJson', { message }),
      });
    }
  }, [applyTheme, t, themeJson]);

  const copyThemeJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(themeJson);
      setThemeMessage({ kind: 'success', text: t('editor.theme-editor.pmpt.message.copied') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemeMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpt.message.copyFailed', { message }),
      });
    }
  }, [t, themeJson]);

  const downloadThemePmpt = useCallback(() => {
    try {
      const filename = `${theme.id || 'theme'}.pmpt`;
      const blob = new Blob([themeJson], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setThemeMessage({ kind: 'success', text: t('editor.theme-editor.pmpt.message.exported', { name: filename }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemeMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpt.message.exportFailed', { message }),
      });
    }
  }, [t, theme.id, themeJson]);

  const handleThemeFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        validateThemeJson(parsed);
        await applyTheme(parsed);
        setThemeMessage({ kind: 'success', text: t('editor.theme-editor.pmpt.message.fileLoaded', { name: file.name }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setThemeMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpt.message.fileLoadFailed', { message }),
        });
      } finally {
        event.target.value = '';
      }
    },
    [applyTheme, t]
  );

  const handleThemePackUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parseThemePackFromZipBytes(bytes);
        setThemePack(parsed);
        setThemePackMessage({
          kind: 'success',
          text: t('editor.theme-editor.pmpk.message.fileLoaded', { name: file.name }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setThemePack(null);
        setThemePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpk.message.fileLoadFailed', { message }),
        });
      } finally {
        event.target.value = '';
      }
    },
    [t]
  );

  const applyThemePackTheme = useCallback(async () => {
    if (!themePack?.entryThemeText) {
      setThemePackMessage({ kind: 'error', text: t('editor.theme-editor.pmpk.message.themeMissing') });
      return;
    }
    try {
      const parsed = JSON.parse(themePack.entryThemeText) as unknown;
      validateThemeJson(parsed);
      await applyTheme(parsed);
      setThemePackMessage({ kind: 'success', text: t('editor.theme-editor.pmpk.message.themeApplied') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpk.message.themeApplyFailed', { message }),
      });
    }
  }, [applyTheme, t, themePack]);

  const themePackExportManifest = useMemo(() => {
    try {
      const parsed = JSON.parse(themePackExportManifestJson) as unknown;
      validateThemePackManifestV1(parsed);
      return { manifest: parsed as ThemePackManifestV1, error: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { manifest: null as ThemePackManifestV1 | null, error: message };
    }
  }, [themePackExportManifestJson]);

  const themePackExportBundledDeps = useMemo(() => {
    const manifest = themePackExportManifest.manifest;
    if (!manifest) return [];

    const deps: Array<{
      kind: 'pmpm' | 'pmps';
      id: string;
      version?: string;
      bundlePath: string;
      normalizedPath: string;
    }> = [];

    for (const dep of manifest.dependencies?.pmpm ?? []) {
      if (!dep.bundlePath) continue;
      deps.push({
        kind: 'pmpm',
        id: dep.id,
        version: dep.version,
        bundlePath: dep.bundlePath,
        normalizedPath: normalizeBundlePath(dep.bundlePath),
      });
    }

    for (const dep of manifest.dependencies?.pmps ?? []) {
      if (!dep.bundlePath) continue;
      deps.push({
        kind: 'pmps',
        id: dep.id,
        version: dep.version,
        bundlePath: dep.bundlePath,
        normalizedPath: normalizeBundlePath(dep.bundlePath),
      });
    }

    return deps;
  }, [themePackExportManifest.manifest]);

  const resetThemePackExport = useCallback(() => {
    setThemePackExportManifestJson(JSON.stringify(buildDefaultThemePackManifest(theme), null, 2));
    setThemePackExportBundles({});
    setThemePackMessage(null);
  }, [theme]);

  const attachThemePackExportBundle = useCallback(
    async (dep: (typeof themePackExportBundledDeps)[number], file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let meta: ThemePackExportBundle['meta'];
      let metaError: string | undefined;

      try {
        meta =
          dep.kind === 'pmpm'
            ? await readPmpmMetaFromZipBytes(bytes)
            : await readPmpsMetaFromZipBytes(bytes);

        if (meta.id !== dep.id) {
          metaError = t('editor.theme-editor.pmpk.export.bundle.idMismatch', {
            expected: dep.id,
            actual: meta.id,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        metaError = t('editor.theme-editor.pmpk.export.bundle.invalid', { message });
      }

      setThemePackExportBundles((prev) => ({
        ...prev,
        [dep.normalizedPath]: {
          kind: dep.kind,
          depId: dep.id,
          bundlePath: dep.bundlePath,
          fileName: file.name,
          bytes,
          meta,
          metaError,
        },
      }));
    },
    [t]
  );

  const removeThemePackExportBundle = useCallback((normalizedPath: string) => {
    setThemePackExportBundles((prev) => {
      if (!prev[normalizedPath]) return prev;
      const next = { ...prev };
      delete next[normalizedPath];
      return next;
    });
  }, []);

  const downloadThemePackPmpk = useCallback(async () => {
    const manifest = themePackExportManifest.manifest;
    if (!manifest) {
      setThemePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpk.export.manifestInvalid', {
          message: themePackExportManifest.error ?? 'invalid',
        }),
      });
      return;
    }

    let themeText: string;
    try {
      const parsed = JSON.parse(themeJson) as unknown;
      validateThemeJson(parsed);
      themeText = JSON.stringify(parsed, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpk.export.themeInvalid', { message }),
      });
      return;
    }

    const bundles: Record<string, Uint8Array> = {};
    const bundleErrors: string[] = [];

    for (const dep of themePackExportBundledDeps) {
      const attached = themePackExportBundles[dep.normalizedPath];
      if (!attached) {
        bundleErrors.push(
          t('editor.theme-editor.pmpk.export.bundle.missing', { path: dep.normalizedPath })
        );
        continue;
      }
      if (attached.kind !== dep.kind) {
        bundleErrors.push(
          t('editor.theme-editor.pmpk.export.bundle.kindMismatch', {
            path: dep.normalizedPath,
            expected: dep.kind,
            actual: attached.kind,
          })
        );
        continue;
      }
      if (attached.metaError) {
        bundleErrors.push(attached.metaError);
        continue;
      }
      if (attached.depId !== dep.id) {
        bundleErrors.push(
          t('editor.theme-editor.pmpk.export.bundle.idMismatch', { expected: dep.id, actual: attached.depId })
        );
        continue;
      }

      bundles[dep.normalizedPath] = attached.bytes;
    }

    if (bundleErrors.length > 0) {
      setThemePackMessage({
        kind: 'error',
        text: bundleErrors.join('\n'),
      });
      return;
    }

    try {
      const bytes = await createThemePackZipBytes({
        manifest,
        themeText,
        bundles,
        checksums: { enabled: themePackExportChecksumsEnabled },
      });

      const filename = `${manifest.metadata.id}-${manifest.metadata.version}.pmpk`;
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      setThemePackMessage({
        kind: 'success',
        text: t('editor.theme-editor.pmpk.export.success', { name: filename }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThemePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.pmpk.export.failed', { message }),
      });
    }
  }, [
    t,
    themeJson,
    themePackExportBundles,
    themePackExportBundledDeps,
    themePackExportChecksumsEnabled,
    themePackExportManifest.error,
    themePackExportManifest.manifest,
  ]);

  const themePackDepsView = useMemo(() => {
    void dependencyRevision;
    if (!themePack) return [];

    return themePack.dependencies.map((dep) => {
      const installedVersion =
        dep.kind === 'pmpm'
          ? getInstalledPmpmPlugin(dep.id)?.manifest.metadata.version ?? null
          : getInstalledPmpsShaderPack(dep.id)?.manifest.metadata.version ?? null;

      const bundledVersion = dep.bundleMeta?.version ?? null;

      const requiredRange = dep.version ?? null;

      const installedSatisfaction =
        installedVersion && requiredRange ? satisfiesSemverRange(installedVersion, requiredRange) : 'unknown';
      const bundledSatisfaction =
        bundledVersion && requiredRange ? satisfiesSemverRange(bundledVersion, requiredRange) : 'unknown';

      const bundleMissing = !dep.bundleBytes;
      const bundleMetaError = Boolean(dep.bundleMetaError) || (Boolean(dep.bundleBytes) && !dep.bundleMeta);
      const bundleIdMismatch = dep.bundleMeta ? dep.bundleMeta.id !== dep.id : false;
      const bundleOutOfRange = Boolean(requiredRange) && bundledSatisfaction === 'violates';

      const installBlockedReason = bundleMissing
        ? 'missingBundle'
        : bundleMetaError
          ? 'bundleMetaError'
          : bundleIdMismatch
            ? 'bundleIdMismatch'
            : bundleOutOfRange
              ? 'bundleOutOfRange'
              : null;

      const installedSatisfied = Boolean(requiredRange) && installedSatisfaction === 'satisfies';

      return {
        dep,
        requiredRange,
        installedVersion,
        bundledVersion,
        installedSatisfaction,
        bundledSatisfaction,
        installBlockedReason,
        installedSatisfied,
      };
    });
  }, [dependencyRevision, themePack]);

  const installThemePackDependency = useCallback(
    async (dep: (typeof themePackDepsView)[number]) => {
      const bundleBytes = dep.dep.bundleBytes;
      if (!bundleBytes) return;

      if (dep.installBlockedReason) {
        setThemePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpk.deps.installBlocked', {
            reason: dep.installBlockedReason,
          }),
        });
        return;
      }

      const needsConfirm = Boolean(dep.installedVersion);
      if (needsConfirm) {
        const ok = await confirm({
          title: t('editor.theme-editor.pmpk.deps.installConfirm.title'),
          message: [
            `${dep.dep.kind} ${dep.dep.id}`,
            `${t('editor.theme-editor.pmpk.deps.field.required')}: ${dep.requiredRange ?? '*'}`,
            `${t('editor.theme-editor.pmpk.deps.field.installed')}: ${dep.installedVersion ?? '-'}`,
            `${t('editor.theme-editor.pmpk.deps.field.bundle')}: ${dep.bundledVersion ?? '-'}`,
          ].join('\n'),
          confirmText: t('common.action.install'),
        });
        if (!ok) return;
      }

      try {
        if (dep.dep.kind === 'pmpm') {
          await installPmpmPluginFromZipBytes(bundleBytes, { defaultEnabled: false });
        } else {
          await installPmpsShaderPackFromZipBytes(bundleBytes);
        }

        setDependencyRevision((prev) => prev + 1);
        setThemePackMessage({
          kind: 'success',
          text: t('editor.theme-editor.pmpk.deps.installSuccess', { id: dep.dep.id }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setThemePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpk.deps.installFailed', { message }),
        });
      }
    },
    [confirm, t]
  );

  const installAllThemePackDependencies = useCallback(async () => {
    if (!themePack) return;

    const candidates = themePackDepsView.filter(
      (item) => !item.installBlockedReason && !item.installedSatisfied && Boolean(item.dep.bundleBytes)
    );

    if (candidates.length === 0) {
      setThemePackMessage({ kind: 'error', text: t('editor.theme-editor.pmpk.installAll.none') });
      return;
    }

    const skipped = themePackDepsView
      .filter((item) => item.installBlockedReason || item.installedSatisfied)
      .map((item) => {
        const status = item.installBlockedReason
          ? t('editor.theme-editor.pmpk.installAll.skipped.blocked')
          : t('editor.theme-editor.pmpk.installAll.skipped.satisfied');
        return `${item.dep.kind} ${item.dep.id} - ${status}`;
      });

    const lines = candidates.map((item) => {
      const installed = item.installedVersion ? ` (${t('editor.theme-editor.pmpk.deps.field.installed')}: ${item.installedVersion})` : '';
      return `${item.dep.kind} ${item.dep.id}@${item.bundledVersion ?? '?'}${installed}`;
    });

    const ok = await confirm({
      title: t('editor.theme-editor.pmpk.installAll.confirm.title'),
      message: [...lines, ...(skipped.length > 0 ? ['', t('editor.theme-editor.pmpk.installAll.skipped.title'), ...skipped] : [])].join('\n'),
      confirmText: t('common.action.install'),
    });
    if (!ok) return;

    const failures: string[] = [];
    for (const item of candidates) {
      const bundleBytes = item.dep.bundleBytes;
      if (!bundleBytes) continue;
      try {
        if (item.dep.kind === 'pmpm') {
          await installPmpmPluginFromZipBytes(bundleBytes, { defaultEnabled: false });
        } else {
          await installPmpsShaderPackFromZipBytes(bundleBytes);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${item.dep.kind} ${item.dep.id}: ${message}`);
      }
    }

    setDependencyRevision((prev) => prev + 1);

    if (failures.length === 0) {
      setThemePackMessage({ kind: 'success', text: t('editor.theme-editor.pmpk.installAll.success') });
      return;
    }

    setThemePackMessage({
      kind: 'error',
      text: t('editor.theme-editor.pmpk.installAll.failed', { message: failures.join('\n') }),
    });
  }, [confirm, t, themePack, themePackDepsView]);

  const themePackRecommendedBindings = useMemo(() => {
    const bindings = themePack?.manifest.recommended?.bindings ?? [];
    if (bindings.length === 0) return [];

    const magnetById = new Map(magnetLibrary.map((magnet) => [magnet.id, magnet]));
    const rendererById = new Map(rendererList.map((renderer) => [renderer.id, renderer]));

    return bindings.map((binding) => ({
      binding,
      magnet: magnetById.get(binding.magnetId) ?? null,
      renderer: rendererById.get(binding.rendererId) ?? null,
    }));
  }, [magnetLibrary, rendererList, themePack]);

  const applyThemePackRendererBindings = useCallback(
    async (bindings: Array<{ magnetId: string; rendererId: string }>) => {
      const magnetIds = new Set(magnetLibrary.map((magnet) => magnet.id));
      const missing = bindings.filter((binding) => !magnetIds.has(binding.magnetId));
      const applicable = bindings.filter((binding) => magnetIds.has(binding.magnetId));

      if (applicable.length === 0) {
        setThemePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpk.recommended.bindings.noneApplicable', {
            missing: missing.length,
          }),
        });
        return;
      }

      try {
        const result = await applyRendererBindings(applicable);
        const summary = t('editor.theme-editor.pmpk.recommended.bindings.applied', {
          updated: result.updated,
          missing: missing.length,
        });
        const missingLines = missing.map((binding) => `${binding.magnetId} -> ${binding.rendererId}`);
        setThemePackMessage({
          kind: 'success',
          text: missingLines.length > 0 ? `${summary}\n${missingLines.join('\n')}` : summary,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setThemePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.pmpk.recommended.bindings.applyFailed', { message }),
        });
      }
    },
    [applyRendererBindings, magnetLibrary, t]
  );

  const rendererGroups = useMemo(() => {
    const grouped = new Map<string, MagnetRendererDefinition[]>();
    for (const renderer of rendererList) {
      const group = (renderer.group ?? '').trim();
      const bucket = grouped.get(group);
      if (bucket) bucket.push(renderer);
      else grouped.set(group, [renderer]);
    }

    const groups = Array.from(grouped.entries()).map(([group, items]) => {
      const sorted = items.slice().sort((a, b) => a.id.localeCompare(b.id));
      return {
        id: group,
        label: formatRendererGroup(t, group),
        items: sorted,
      };
    });

    groups.sort((a, b) => a.label.localeCompare(b.label));
    return groups;
  }, [rendererList, t]);

  const selectedRenderer = useMemo(
    () => rendererList.find((renderer) => renderer.id === selectedRendererId) ?? null,
    [rendererList, selectedRendererId]
  );

  useEffect(() => {
    if (!selectedRendererId || selectedRenderer) return;
    setSelectedRendererId(rendererList[0]?.id ?? '');
  }, [rendererList, selectedRenderer, selectedRendererId]);

  return (
    <div className="editor-theme">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
        </span>
      </div>

      <div className="editor-window-content theme-editor-content">
        <div className="theme-editor-title">
          <div className="theme-editor-title-row">
            <div className="theme-editor-title-text">{t('editor.theme-editor.title')}</div>
            <div className="theme-editor-title-actions">
              <button type="button" className="theme-editor-action-btn" onClick={refreshRenderers}>
                {t('common.action.refresh')}
              </button>
              <button type="button" className="theme-editor-action-btn" onClick={toggleDebug}>
                {debugOpen
                  ? t('editor.theme-editor.debug.toggle.close')
                  : t('editor.theme-editor.debug.toggle.open')}
              </button>
            </div>
          </div>
          <p className="theme-editor-subtitle">{t('editor.theme-editor.subtitle')}</p>
        </div>

        <div className="theme-editor-main">
          <div className="theme-editor-sidebar">
            <div className="theme-editor-sidebar-title">{t('editor.theme-debug.renderers.title')}</div>
            <div className="theme-editor-renderer-groups">
              {rendererList.length === 0 ? (
                <div className="theme-editor-muted">{t('editor.theme-debug.renderers.empty')}</div>
              ) : (
                rendererGroups.map((group) => (
                  <div key={group.id || '__default__'} className="theme-editor-renderer-group">
                    <div className="theme-editor-renderer-group-title">{group.label}</div>
                    <div className="theme-editor-renderer-items">
                      {group.items.map((renderer) => (
                        <button
                          key={renderer.id}
                          type="button"
                          className={`theme-editor-renderer-item ${
                            renderer.id === selectedRendererId ? 'is-selected' : ''
                          }`}
                          onClick={() => setSelectedRendererId(renderer.id)}
                        >
                          <div className="theme-editor-renderer-item-id">{renderer.id}</div>
                          <div className="theme-editor-renderer-item-meta">
                            {formatRendererSource(t, renderer.source)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="theme-editor-panel">
            <div className="theme-editor-panel-inner">
              <div className="theme-editor-section">
                <div className="theme-editor-section-title">
                  {t('editor.theme-editor.pmpt.section.title')}
                </div>

                <div className="theme-editor-section-actions">
                  <label className="theme-editor-file-btn">
                    <input type="file" accept=".pmpt,.json,application/json" onChange={handleThemeFileUpload} />
                    {t('editor.theme-editor.pmpt.importFile')}
                  </label>
                  <button type="button" className="theme-editor-action-btn" onClick={copyThemeJson}>
                    {t('editor.theme-editor.pmpt.copyJson')}
                  </button>
                  <button type="button" className="theme-editor-action-btn" onClick={downloadThemePmpt}>
                    {t('editor.theme-editor.pmpt.exportFile')}
                  </button>
                  <button type="button" className="theme-editor-action-btn" onClick={applyThemeJson}>
                    {t('editor.theme-editor.pmpt.applyJson')}
                  </button>
                </div>

                {themeMessage ? (
                  <div className={`theme-editor-message theme-editor-message--${themeMessage.kind}`}>
                    {themeMessage.text}
                  </div>
                ) : null}

                <textarea
                  className="theme-editor-textarea"
                  value={themeJson}
                  onChange={(event) => setThemeJson(event.target.value)}
                  spellCheck={false}
                />
              </div>

              <div className="theme-editor-section">
                <div className="theme-editor-section-title">
                  {t('editor.theme-editor.pmpk.section.title')}
                </div>

                <div className="theme-editor-section-actions">
                  <label className="theme-editor-file-btn">
                    <input type="file" accept=".pmpk,application/zip" onChange={handleThemePackUpload} />
                    {t('editor.theme-editor.pmpk.importFile')}
                  </label>
                  <button
                    type="button"
                    className="theme-editor-action-btn"
                    onClick={applyThemePackTheme}
                    disabled={!themePack?.entryThemeText}
                  >
                    {t('editor.theme-editor.pmpk.applyThemeOnly')}
                  </button>
                  <button
                    type="button"
                    className="theme-editor-action-btn"
                    onClick={installAllThemePackDependencies}
                    disabled={!themePack}
                  >
                    {t('editor.theme-editor.pmpk.installAll')}
                  </button>
                </div>

                {themePackMessage ? (
                  <div className={`theme-editor-message theme-editor-message--${themePackMessage.kind}`}>
                    {themePackMessage.text}
                  </div>
                ) : null}

                {themePack ? (
                  <div className="theme-pack-summary">
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.idLabel')}</span>
                      <span className="theme-pack-value">{themePack.manifest.metadata.id}</span>
                      <span className="theme-pack-value">
                        {themePack.manifest.metadata.version}
                      </span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.nameLabel')}</span>
                      <span className="theme-pack-value">{themePack.manifest.metadata.name}</span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.entryThemeLabel')}</span>
                      <span className="theme-pack-value">{themePack.entryThemePath}</span>
                      <span
                        className={`theme-pack-status ${themePack.entryThemeBytes ? 'is-ok' : 'is-missing'}`}
                      >
                        {themePack.entryThemeBytes
                          ? t('editor.theme-editor.pmpk.entryTheme.ok')
                          : t('editor.theme-editor.pmpk.entryTheme.missing')}
                      </span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.integrityLabel')}</span>
                      <span
                        className={`theme-pack-status ${themePack.checksums ? 'is-ok' : 'is-missing'}`}
                      >
                        {themePack.checksums
                          ? t('editor.theme-editor.pmpk.integrity.ok')
                          : t('editor.theme-editor.pmpk.integrity.missing')}
                      </span>
                    </div>

                    <div className="theme-pack-deps">
                      <div className="theme-pack-deps-title">
                        {t('editor.theme-editor.pmpk.deps.title')}
                      </div>
                      {themePackDepsView.length === 0 ? (
                        <div className="theme-editor-muted">
                          {t('editor.theme-editor.pmpk.deps.empty')}
                        </div>
                      ) : (
                        themePackDepsView.map((item) => {
                          const blockedReason = item.installBlockedReason
                            ? t(`editor.theme-editor.pmpk.deps.blocked.${item.installBlockedReason}`)
                            : null;

                          const installDisabled = Boolean(item.installBlockedReason) || item.installedSatisfied;

                          return (
                            <div
                              key={`${item.dep.kind}:${item.dep.id}`}
                              className={`theme-pack-dep ${installDisabled ? 'is-disabled' : ''}`}
                            >
                              <div className="theme-pack-dep-header">
                                <div className="theme-pack-dep-header-left">
                                  <span className="theme-pack-dep-kind">{item.dep.kind}</span>
                                  <span className="theme-pack-dep-id">{item.dep.id}</span>
                                </div>
                                <div className="theme-pack-dep-actions">
                                  <button
                                    type="button"
                                    className="theme-pack-dep-install-btn"
                                    disabled={installDisabled}
                                    onClick={() => installThemePackDependency(item)}
                                  >
                                    {t('common.action.install')}
                                  </button>
                                </div>
                              </div>

                              <div className="theme-pack-dep-chips">
                                <span className="theme-pack-chip">
                                  {t('editor.theme-editor.pmpk.deps.field.required')}: {item.requiredRange ?? '*'}
                                </span>
                                <span className={`theme-pack-chip theme-pack-chip--${item.installedSatisfaction}`}>
                                  {t('editor.theme-editor.pmpk.deps.field.installed')}: {item.installedVersion ?? '-'}{' '}
                                  <span className="theme-pack-chip-suffix">
                                    {t(`editor.theme-editor.pmpk.deps.satisfaction.${item.installedSatisfaction}`)}
                                  </span>
                                </span>
                                <span className={`theme-pack-chip theme-pack-chip--${item.bundledSatisfaction}`}>
                                  {t('editor.theme-editor.pmpk.deps.field.bundle')}: {item.bundledVersion ?? '-'}{' '}
                                  <span className="theme-pack-chip-suffix">
                                    {t(`editor.theme-editor.pmpk.deps.satisfaction.${item.bundledSatisfaction}`)}
                                  </span>
                                </span>
                              </div>

                              {item.installedSatisfied ? (
                                <div className="theme-editor-muted">
                                  {t('editor.theme-editor.pmpk.deps.installedSatisfied')}
                                </div>
                              ) : null}

                              {blockedReason ? <div className="theme-editor-muted">{blockedReason}</div> : null}

                              {item.dep.bundleMetaError ? (
                                <div className="theme-editor-muted">{item.dep.bundleMetaError}</div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {themePackRecommendedBindings.length > 0 ? (
                      <div className="theme-pack-recommended">
                        <div className="theme-pack-recommended-header">
                          <div className="theme-pack-deps-title">
                            {t('editor.theme-editor.pmpk.recommended.bindings.title')}
                          </div>
                          <button
                            type="button"
                            className="theme-pack-dep-install-btn"
                            disabled={!themePackRecommendedBindings.some((item) => item.magnet)}
                            onClick={() =>
                              applyThemePackRendererBindings(
                                themePackRecommendedBindings.map((item) => item.binding)
                              )
                            }
                          >
                            {t('editor.theme-editor.pmpk.recommended.bindings.applyAll')}
                          </button>
                        </div>

                        <div className="theme-pack-recommended-list">
                          {themePackRecommendedBindings.map((item) => {
                            const magnetMissing = !item.magnet;
                            const rendererMissing = !item.renderer;

                            return (
                              <div
                                key={`${item.binding.magnetId}:${item.binding.rendererId}`}
                                className={`theme-pack-dep ${magnetMissing ? 'is-disabled' : ''}`}
                              >
                                <div className="theme-pack-dep-header">
                                  <div className="theme-pack-dep-header-left">
                                    <span className="theme-pack-dep-kind">{item.binding.magnetId}</span>
                                    <span className="theme-pack-binding-arrow">→</span>
                                    <span className="theme-pack-dep-id">{item.binding.rendererId}</span>
                                  </div>
                                  <div className="theme-pack-dep-actions">
                                    <button
                                      type="button"
                                      className="theme-pack-dep-install-btn"
                                      disabled={magnetMissing}
                                      onClick={() => applyThemePackRendererBindings([item.binding])}
                                    >
                                      {t('editor.theme-editor.pmpk.recommended.bindings.applyOne')}
                                    </button>
                                  </div>
                                </div>

                                <div className="theme-pack-dep-chips">
                                  <span className="theme-pack-chip">
                                    {item.magnet?.name ?? item.binding.magnetId}
                                  </span>
                                  <span
                                    className={`theme-pack-chip theme-pack-chip--${
                                      rendererMissing ? 'unknown' : 'satisfies'
                                    }`}
                                  >
                                    {rendererMissing
                                      ? t('editor.theme-editor.pmpk.recommended.bindings.rendererMissing')
                                      : formatRendererSource(t, item.renderer?.source)}
                                  </span>
                                </div>

                                {magnetMissing ? (
                                  <div className="theme-editor-muted">
                                    {t('editor.theme-editor.pmpk.recommended.bindings.magnetMissing')}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <pre className="theme-editor-panel-json">
                      {JSON.stringify(
                        {
                          requires: themePack.manifest.requires ?? null,
                          recommended: themePack.manifest.recommended ?? null,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                ) : (
                  <div className="theme-editor-muted">{t('editor.theme-editor.pmpk.empty')}</div>
                )}

                <div className="theme-pack-divider" />

                <div className="theme-pack-export">
                  <div className="theme-pack-export-header">
                    <div className="theme-pack-export-title">
                      {t('editor.theme-editor.pmpk.export.title')}
                    </div>
                    <div className="theme-editor-section-actions">
                      <button type="button" className="theme-editor-action-btn" onClick={resetThemePackExport}>
                        {t('common.action.reset')}
                      </button>
                      <button
                        type="button"
                        className="theme-editor-action-btn"
                        onClick={downloadThemePackPmpk}
                        disabled={!themePackExportManifest.manifest}
                      >
                        {t('editor.theme-editor.pmpk.export.exportFile')}
                      </button>
                    </div>
                  </div>

                  <label className="theme-pack-export-checkbox">
                    <input
                      type="checkbox"
                      checked={themePackExportChecksumsEnabled}
                      onChange={(event) => setThemePackExportChecksumsEnabled(event.target.checked)}
                    />
                    <span>{t('editor.theme-editor.pmpk.export.includeChecksums')}</span>
                  </label>

                  {themePackExportManifest.error ? (
                    <div className="theme-editor-message theme-editor-message--error">
                      {t('editor.theme-editor.pmpk.export.manifestError', {
                        message: themePackExportManifest.error,
                      })}
                    </div>
                  ) : null}

                  <textarea
                    className="theme-editor-textarea theme-editor-textarea--compact"
                    value={themePackExportManifestJson}
                    onChange={(event) => setThemePackExportManifestJson(event.target.value)}
                    spellCheck={false}
                  />

                  {themePackExportBundledDeps.length > 0 ? (
                    <div className="theme-pack-export-bundles">
                      <div className="theme-pack-deps-title">
                        {t('editor.theme-editor.pmpk.export.bundles.title')}
                      </div>
                      {themePackExportBundledDeps.map((dep) => {
                        const attachment = themePackExportBundles[dep.normalizedPath] ?? null;
                        const attachmentLabel = attachment
                          ? t('editor.theme-editor.pmpk.export.bundle.replace')
                          : t('editor.theme-editor.pmpk.export.bundle.attach');

                        return (
                          <div
                            key={`${dep.kind}:${dep.id}:${dep.normalizedPath}`}
                            className={`theme-pack-dep ${attachment?.metaError ? 'is-disabled' : ''}`}
                          >
                            <div className="theme-pack-dep-header">
                              <div className="theme-pack-dep-header-left">
                                <span className="theme-pack-dep-kind">{dep.kind}</span>
                                <span className="theme-pack-dep-id">{dep.id}</span>
                              </div>
                              <div className="theme-pack-dep-actions">
                                <label className="theme-editor-file-btn">
                                  <input
                                    type="file"
                                    accept={dep.kind === 'pmpm' ? '.pmpm,application/zip' : '.pmps,application/zip'}
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) return;
                                      try {
                                        await attachThemePackExportBundle(dep, file);
                                      } finally {
                                        event.target.value = '';
                                      }
                                    }}
                                  />
                                  {attachmentLabel}
                                </label>
                                {attachment ? (
                                  <button
                                    type="button"
                                    className="theme-pack-dep-install-btn"
                                    onClick={() => removeThemePackExportBundle(dep.normalizedPath)}
                                  >
                                    {t('common.action.remove')}
                                  </button>
                                ) : null}
                              </div>
                            </div>

                            <div className="theme-pack-dep-chips">
                              <span className="theme-pack-chip">
                                {t('editor.theme-editor.pmpk.export.bundle.path')}: {dep.normalizedPath}
                              </span>
                              <span className="theme-pack-chip">
                                {t('editor.theme-editor.pmpk.deps.field.required')}: {dep.version ?? '*'}
                              </span>
                              <span
                                className={`theme-pack-chip theme-pack-chip--${
                                  attachment ? (attachment.metaError ? 'violates' : 'satisfies') : 'unknown'
                                }`}
                              >
                                {attachment
                                  ? attachment.metaError
                                    ? t('editor.theme-editor.pmpk.export.bundle.status.invalid')
                                    : t('editor.theme-editor.pmpk.export.bundle.status.attached')
                                  : t('editor.theme-editor.pmpk.export.bundle.status.missing')}
                              </span>
                            </div>

                            {attachment ? (
                              <div className="theme-editor-muted">
                                {t('editor.theme-editor.pmpk.export.bundle.attached', {
                                  name: attachment.fileName,
                                })}
                              </div>
                            ) : null}

                            {attachment?.metaError ? (
                              <div className="theme-editor-muted">{attachment.metaError}</div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="theme-editor-muted">{t('editor.theme-editor.pmpk.export.bundles.empty')}</div>
                  )}
                </div>
              </div>

                <div className="theme-editor-section">
                  <div className="theme-editor-section-title">{t('editor.theme-editor.renderers.section.title')}</div>
                  {!selectedRenderer ? (
                    <div className="theme-editor-muted">{t('editor.theme-debug.renderers.empty')}</div>
                  ) : (
                  <>
                    <div className="theme-editor-panel-title">{selectedRenderer.id}</div>
                    <div className="theme-editor-panel-meta">
                      <span className="theme-editor-panel-chip">
                        {formatRendererSource(t, selectedRenderer.source)}
                      </span>
                      {selectedRenderer.group ? (
                        <span className="theme-editor-panel-chip">{selectedRenderer.group}</span>
                      ) : null}
                    </div>
                    {selectedRenderer.description ? (
                      <div className="theme-editor-panel-desc">{selectedRenderer.description}</div>
                    ) : null}
                    <pre className="theme-editor-panel-json">
                      {JSON.stringify(
                        {
                          id: selectedRenderer.id,
                          source: selectedRenderer.source ?? 'builtin',
                          group: selectedRenderer.group ?? null,
                          tags: selectedRenderer.tags ?? null,
                          metadata: selectedRenderer.metadata ?? null,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </>
                )}
              </div>

              <div className="theme-editor-section">
                <div className="theme-editor-section-title">{t('editor.theme-editor.pmpv.section.title')}</div>
                {!selectedRenderer ? (
                  <div className="theme-editor-muted">{t('editor.theme-debug.renderers.empty')}</div>
                ) : (
                  <>
                    <div className="theme-editor-section-actions">
                      <button
                        type="button"
                        className="theme-editor-action-btn"
                        onClick={downloadVariantPresetPmpv}
                      >
                        {t('editor.theme-editor.pmpv.action.export')}
                      </button>
                      <label className="theme-editor-file-btn">
                        {t('editor.theme-editor.pmpv.action.import')}
                        <input
                          type="file"
                          accept=".pmpv,application/json"
                          onChange={handleVariantPresetUpload}
                        />
                      </label>
                    </div>

                    {variantPresetMessage ? (
                      <div
                        className={`theme-editor-message theme-editor-message--${variantPresetMessage.kind}`}
                      >
                        {variantPresetMessage.text}
                      </div>
                    ) : null}

                    <pre className="theme-editor-panel-json">
                      {JSON.stringify(
                        {
                          rendererId: selectedRenderer.id,
                          componentTheme: theme.componentThemes?.[selectedRenderer.id] ?? null,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
