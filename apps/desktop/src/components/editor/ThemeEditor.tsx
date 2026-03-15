import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { listRegisteredMagnetRenderers, type MagnetRendererDefinition } from '../../magnet-system/registry';
import { listMagnetVariants } from '../../magnet-system/variantRegistry';
import { getInstalledPmpmPlugin, installPmpmPluginFromZipBytes } from '../../magnet-system/plugins/pmpm';
import { getInstalledPmpsShaderPack } from '../../shader-system/pmps';
import { installPmpsShaderPackFromZipBytes } from '../../shader-system/pmps';
import { APP_VERSION, HOST_API_VERSION } from '../../constants/versions';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import { readJson } from '../../modules/storage';
import {
  createDefaultMagnetSpacesState,
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreBootstrapFromLegacy,
  magnetLayoutStoreGetState,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  sanitizeMagnetSpaceLayout,
  sanitizeMagnetSpacesState,
  type MagnetLayoutStorePatch,
  type MagnetLayoutStoreState,
  type MagnetSpacesState,
} from '../../modules/magnets';
import { readDurableText, writeDurableText } from '../../modules/storage/durableTextStore';
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
import {
  createProfilePackZipBytes,
  parseProfilePackFromZipBytes,
  validateProfilePackManifestV1,
  type ParsedProfilePack,
  type ProfilePackManifestV1,
  type ProfilePackProfileV1,
} from '../../themes/packs/profilePack';
import { filterMagnetConfigSnapshotForImport, filterMagnetSpaceLayoutForImport } from '../../themes/packs/profilePackApply';
import { parseVariantPresetFromText, type VariantPresetV1 } from '../../themes/packs/pmpv';
import { satisfiesSemverRange } from '../../themes/packs/semver';
import { assignMagnetComponentTheme, materializeThemeBinding } from '../../themes/importAdapters';
import { resolveLegacyComponentThemeSurfaceId } from '../../themes/legacyComponentThemes';
import type { Theme, ThemeBindingId } from '../../themes/types/theme';
import type { ThemeImportCandidate, ThemeImportSurfaceSpec } from '../../themes/types/themeImport';
import { useThemeBindingEditor } from '../../themes/useThemeBindingEditor';
import type { Magnet } from '../../types/pixel';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS, setupTauriListenerWithPayload } from '../../utils/windowCommunication';
import { ThemeBindingEditorPanel } from '../theme/ThemeBindingEditorPanel';

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

function assertThemeTokenPrimitive(value: unknown, path: string): void {
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    throw new Error(`${path} must be a string, number, or boolean`);
  }
}

function assertThemeTokenAssignments(value: unknown, path: string): void {
  assertObject(value, path);
  for (const [key, tokenValue] of Object.entries(value)) {
    assertThemeTokenPrimitive(tokenValue, `${path}.${key}`);
  }
}

function assertThemeTokens(value: unknown, path: string): void {
  assertObject(value, path);
  for (const [key, tokenValue] of Object.entries(value)) {
    assertThemeTokenAssignments(tokenValue, `${path}.${key}`);
  }
}

function assertDynamicColorCapability(value: unknown, path: string): void {
  assertObject(value, path);
  const dynamicColor = value.dynamicColor;
  if (typeof dynamicColor === 'undefined') {
    return;
  }
  assertObject(dynamicColor, `${path}.dynamicColor`);

  const booleanFields = ['enabled'] as const;
  for (const key of booleanFields) {
    const fieldValue = dynamicColor[key];
    if (typeof fieldValue !== 'undefined' && typeof fieldValue !== 'boolean') {
      throw new Error(`${path}.dynamicColor.${key} must be a boolean`);
    }
  }

  const stringFields = ['source', 'mode', 'apply'] as const;
  for (const key of stringFields) {
    const fieldValue = dynamicColor[key];
    if (typeof fieldValue !== 'undefined' && typeof fieldValue !== 'string') {
      throw new Error(`${path}.dynamicColor.${key} must be a string`);
    }
  }

  const numberFields = ['blendRatio', 'gradientAngle', 'dynamicSpeed'] as const;
  for (const key of numberFields) {
    const fieldValue = dynamicColor[key];
    if (typeof fieldValue !== 'undefined' && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
      throw new Error(`${path}.dynamicColor.${key} must be a finite number`);
    }
  }

  if (typeof dynamicColor.colorAdjust !== 'undefined') {
    assertObject(dynamicColor.colorAdjust, `${path}.dynamicColor.colorAdjust`);
  }
}

function assertLegacyDynamicColorConfig(value: unknown, path: string): void {
  assertObject(value, path);
  const booleanFields = ['extractFromCover'] as const;
  for (const key of booleanFields) {
    const fieldValue = value[key];
    if (typeof fieldValue !== 'undefined' && typeof fieldValue !== 'boolean') {
      throw new Error(`${path}.${key} must be a boolean`);
    }
  }

  const stringFields = ['effect', 'applyMode'] as const;
  for (const key of stringFields) {
    const fieldValue = value[key];
    if (typeof fieldValue !== 'undefined' && typeof fieldValue !== 'string') {
      throw new Error(`${path}.${key} must be a string`);
    }
  }

  const numberFields = ['gradientAngle', 'dynamicSpeed', 'blendRatio'] as const;
  for (const key of numberFields) {
    const fieldValue = value[key];
    if (typeof fieldValue !== 'undefined' && (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue))) {
      throw new Error(`${path}.${key} must be a finite number`);
    }
  }

  if (typeof value.colorAdjust !== 'undefined') {
    assertObject(value.colorAdjust, `${path}.colorAdjust`);
  }
}

function assertThemePartStateSpec(value: unknown, path: string): void {
  assertObject(value, path);
  if (typeof value.classes !== 'undefined') {
    if (!Array.isArray(value.classes) || value.classes.some((entry) => typeof entry !== 'string')) {
      throw new Error(`${path}.classes must be an array of strings`);
    }
  }
  if (typeof value.style !== 'undefined') {
    assertObject(value.style, `${path}.style`);
  }
  if (typeof value.tokens !== 'undefined') {
    assertThemeTokenAssignments(value.tokens, `${path}.tokens`);
  }
}

function assertThemeSurfaceStateSpec(value: unknown, path: string): void {
  assertThemePartStateSpec(value, path);
  const record = value as Record<string, unknown>;
  if (typeof record.parts !== 'undefined') {
    assertObject(record.parts, `${path}.parts`);
    for (const [key, entry] of Object.entries(record.parts)) {
      assertThemePartStateSpec(entry, `${path}.parts.${key}`);
    }
  }
}

function assertThemeSurfacePartSpec(value: unknown, path: string): void {
  assertThemePartStateSpec(value, path);
  const record = value as Record<string, unknown>;
  if (typeof record.states !== 'undefined') {
    assertObject(record.states, `${path}.states`);
    for (const [key, entry] of Object.entries(record.states)) {
      assertThemePartStateSpec(entry, `${path}.states.${key}`);
    }
  }
}

function assertComponentThemeDocument(value: unknown, path: string): void {
  assertObject(value, path);

  if (typeof value.extends !== 'undefined' && typeof value.extends !== 'string') {
    throw new Error(`${path}.extends must be a string`);
  }
  if (typeof value.variant !== 'undefined' && typeof value.variant !== 'string') {
    throw new Error(`${path}.variant must be a string`);
  }
  if (typeof value.variantConfig !== 'undefined') {
    assertObject(value.variantConfig, `${path}.variantConfig`);
  }
  if (typeof value.tokens !== 'undefined') {
    assertThemeTokenAssignments(value.tokens, `${path}.tokens`);
  }
  if (typeof value.parts !== 'undefined') {
    assertObject(value.parts, `${path}.parts`);
    for (const [key, entry] of Object.entries(value.parts)) {
      assertThemeSurfacePartSpec(entry, `${path}.parts.${key}`);
    }
  }
  if (typeof value.states !== 'undefined') {
    assertObject(value.states, `${path}.states`);
    for (const [key, entry] of Object.entries(value.states)) {
      assertThemeSurfaceStateSpec(entry, `${path}.states.${key}`);
    }
  }
  if (typeof value.metadata !== 'undefined') {
    assertObject(value.metadata, `${path}.metadata`);
    if (typeof value.metadata.description !== 'undefined' && typeof value.metadata.description !== 'string') {
      throw new Error(`${path}.metadata.description must be a string`);
    }
  }

  if (typeof value.styleOverride !== 'undefined') {
    assertObject(value.styleOverride, `${path}.styleOverride`);
  }
  if (typeof value.classNameOverride !== 'undefined') {
    assertObject(value.classNameOverride, `${path}.classNameOverride`);
  }
  if (typeof value.dynamicColor !== 'undefined') {
    assertLegacyDynamicColorConfig(value.dynamicColor, `${path}.dynamicColor`);
  }
}

function assertThemeBindingValue(value: unknown, path: string): void {
  assertObject(value, path);
  if (typeof value.surface !== 'undefined' && typeof value.surface !== 'string') {
    throw new Error(`${path}.surface must be a string`);
  }
  if (typeof value.renderer !== 'undefined' && typeof value.renderer !== 'string') {
    throw new Error(`${path}.renderer must be a string`);
  }
  if (typeof value.variant !== 'undefined' && typeof value.variant !== 'string') {
    throw new Error(`${path}.variant must be a string`);
  }
  if (typeof value.props !== 'undefined') {
    assertObject(value.props, `${path}.props`);
  }
  if (typeof value.capabilities !== 'undefined') {
    assertDynamicColorCapability(value.capabilities, `${path}.capabilities`);
  }
}

function validateThemeJson(value: unknown): asserts value is ThemeImportCandidate {
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

  if (typeof value.colors !== 'undefined') {
    assertObject(value.colors, 'theme.colors');
    for (const [key, tokenValue] of Object.entries(value.colors)) {
      if (typeof tokenValue !== 'string') {
        throw new Error(`theme.colors.${key} must be a string`);
      }
    }
  }

  if (typeof value.motion !== 'undefined') {
    assertObject(value.motion, 'theme.motion');
    for (const [key, tokenValue] of Object.entries(value.motion)) {
      if (!['string', 'number', 'boolean'].includes(typeof tokenValue)) {
        throw new Error(`theme.motion.${key} must be a string, number, or boolean`);
      }
    }
  }

  if (typeof value.typography !== 'undefined') {
    assertObject(value.typography, 'theme.typography');
    for (const [key, tokenValue] of Object.entries(value.typography)) {
      if (!['string', 'number'].includes(typeof tokenValue)) {
        throw new Error(`theme.typography.${key} must be a string or number`);
      }
    }
  }

  if (typeof value.tokens !== 'undefined') {
    assertThemeTokens(value.tokens, 'theme.tokens');
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

  if (typeof value.componentThemes !== 'undefined') {
    assertObject(value.componentThemes, 'theme.componentThemes');
    for (const [key, entry] of Object.entries(value.componentThemes)) {
      assertComponentThemeDocument(entry, `theme.componentThemes.${key}`);
    }
  }
  if (typeof value.surfaces !== 'undefined') {
    assertObject(value.surfaces, 'theme.surfaces');
    for (const [key, entry] of Object.entries(value.surfaces)) {
      assertComponentThemeDocument(entry, `theme.surfaces.${key}`);
    }
  }
  if (typeof value.bindings !== 'undefined') {
    assertObject(value.bindings, 'theme.bindings');
    for (const [key, entry] of Object.entries(value.bindings)) {
      assertThemeBindingValue(entry, `theme.bindings.${key}`);
    }
  }
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

function normalizeBundlePath(path: string): string {
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function buildRequiresSummaryLine(label: string, current: string, required?: string): string {
  const range = required && required.trim().length > 0 ? required.trim() : '-';
  return `${label}: ${range} (current: ${current})`;
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

function buildDefaultProfilePackManifest(theme: Theme): ProfilePackManifestV1 {
  const id = isValidId(theme.id) ? theme.id : 'profile-pack';
  return {
    formatVersion: '1.0',
    type: 'profile-pack',
    metadata: {
      id,
      name: theme.name || id,
      version: theme.version || '0.0.0',
    },
    entry: {
      profile: 'profile.json',
    },
  };
}

const STATIC_BINDING_GROUPS: Array<{
  id: string;
  label: string;
  bindingIds: ThemeBindingId[];
}> = [
  {
    id: 'page',
    label: 'Page',
    bindingIds: ['page.music-library', 'page.settings', 'page.settings.main-tab', 'page.settings.sub-tab'],
  },
  {
    id: 'overlay',
    label: 'Overlay',
    bindingIds: ['overlay.confirm-dialog', 'overlay.context-menu', 'overlay.modal', 'overlay.drawer'],
  },
  {
    id: 'primitive',
    label: 'Primitive',
    bindingIds: [
      'primitive.button',
      'primitive.button.default',
      'primitive.button.primary',
      'primitive.button.danger',
      'primitive.button.ghost',
      'primitive.card',
      'primitive.card.default',
      'primitive.card.settings',
      'primitive.dialog',
      'primitive.dialog.default',
      'primitive.choice',
      'primitive.segmented',
      'primitive.switch',
      'primitive.checkbox',
    ],
  },
];

const DEFAULT_SELECTED_SURFACE_BINDING_ID = STATIC_BINDING_GROUPS[0]?.bindingIds[0] ?? ('page.settings' as ThemeBindingId);

function extractThemeRendererIds(themeValue: unknown): string[] {
  if (!isPlainObject(themeValue)) {
    return [];
  }

  const rendererIds = new Set<string>();

  const componentThemes = themeValue.componentThemes;
  if (isPlainObject(componentThemes)) {
    for (const componentId of Object.keys(componentThemes)) {
      const surfaceId = resolveLegacyComponentThemeSurfaceId(componentId);
      if (surfaceId.startsWith('magnet.')) {
        rendererIds.add(surfaceId.slice('magnet.'.length));
      }
    }
  }

  const bindings = themeValue.bindings;
  if (isPlainObject(bindings)) {
    for (const [bindingId, bindingValue] of Object.entries(bindings)) {
      if (bindingId.startsWith('magnet.')) {
        const fallbackRendererId = bindingId.slice('magnet.'.length).trim();
        if (fallbackRendererId) {
          rendererIds.add(fallbackRendererId);
        }
      }

      if (!isPlainObject(bindingValue)) {
        continue;
      }

      const rendererId = bindingValue.renderer;
      if (typeof rendererId === 'string' && rendererId.trim().length > 0) {
        rendererIds.add(rendererId.trim());
      }
    }
  }

  return [...rendererIds];
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

type ProfilePackApplyMode = 'replace-all' | 'map-one';

type ProfilePackApplyOptions = {
  applyTheme: boolean;
  applyMagnets: boolean;
  magnetsMode: ProfilePackApplyMode;
  sourceSpaceId: string;
  targetSpaceId: string;
  acknowledgeOverwrite: boolean;
};

export type ThemeEditorProps = {
  magnetLibrary: Magnet[];
  applyRendererBindings: (
    bindings: Array<{ magnetId: string; rendererId: string }>
  ) => Promise<{ updated: number }>;
};

export function ThemeEditor({ magnetLibrary, applyRendererBindings }: ThemeEditorProps) {
  const t = useT();
  const { theme, applyTheme } = useTheme();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [debugOpen, setDebugOpen] = useState(false);
  const [rendererList, setRendererList] = useState<MagnetRendererDefinition[]>(() =>
    listRegisteredMagnetRenderers()
  );
  const [selectedRendererId, setSelectedRendererId] = useState<string>(() => rendererList[0]?.id ?? '');
  const [themeJson, setThemeJson] = useState(() => JSON.stringify(theme, null, 2));
  const [themeMessage, setThemeMessage] = useState<PanelMessage | null>(null);
  const [themePack, setThemePack] = useState<ParsedThemePack | null>(null);
  const [themePackMessage, setThemePackMessage] = useState<PanelMessage | null>(null);
  const [profilePack, setProfilePack] = useState<ParsedProfilePack | null>(null);
  const [profilePackMessage, setProfilePackMessage] = useState<PanelMessage | null>(null);
  const [variantPresetMessage, setVariantPresetMessage] = useState<PanelMessage | null>(null);
  const [dependencyRevision, setDependencyRevision] = useState(0);
  const [themePackExportManifestJson, setThemePackExportManifestJson] = useState(() =>
    JSON.stringify(buildDefaultThemePackManifest(theme), null, 2)
  );
  const [themePackExportBundles, setThemePackExportBundles] = useState<Record<string, ThemePackExportBundle>>(
    {}
  );
  const [themePackExportChecksumsEnabled, setThemePackExportChecksumsEnabled] = useState(true);
  const [profilePackExportManifestJson, setProfilePackExportManifestJson] = useState(() =>
    JSON.stringify(buildDefaultProfilePackManifest(theme), null, 2)
  );
  const [profilePackExportChecksumsEnabled, setProfilePackExportChecksumsEnabled] = useState(true);
  const [profilePackApplyOpen, setProfilePackApplyOpen] = useState(false);
  const [profilePackApplyBusy, setProfilePackApplyBusy] = useState(false);
  const [selectedSurfaceBindingId, setSelectedSurfaceBindingId] =
    useState<ThemeBindingId>(DEFAULT_SELECTED_SURFACE_BINDING_ID);
  const [profilePackApplyOptions, setProfilePackApplyOptions] = useState<ProfilePackApplyOptions>(() => ({
    applyTheme: true,
    applyMagnets: false,
    magnetsMode: 'replace-all',
    sourceSpaceId: 'space1',
    targetSpaceId: 'space1',
    acknowledgeOverwrite: false,
  }));

  const [localMagnetSpacesState, setLocalMagnetSpacesState] = useState<MagnetSpacesState>(() =>
    sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()))
  );

  const magnetBindingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const magnet of magnetLibrary) {
      const id = magnet.id.trim();
      if (id) {
        ids.add(`magnet.${id}`);
      }
    }
    for (const renderer of rendererList) {
      const id = renderer.id.trim();
      if (id) {
        ids.add(`magnet.${id}`);
      }
    }
    for (const bindingId of Object.keys(theme.bindings ?? {})) {
      if (bindingId.startsWith('magnet.')) {
        ids.add(bindingId);
      }
    }
    for (const surfaceId of Object.keys(theme.surfaces ?? {})) {
      if (surfaceId.startsWith('magnet.')) {
        ids.add(surfaceId);
      }
    }

    return [...ids].sort() as ThemeBindingId[];
  }, [magnetLibrary, rendererList, theme.bindings, theme.surfaces]);

  const editableBindingGroups = useMemo(() => {
    const groups = [...STATIC_BINDING_GROUPS];
    if (magnetBindingIds.length > 0) {
      groups.unshift({
        id: 'magnet',
        label: 'Magnet',
        bindingIds: magnetBindingIds,
      });
    }
    return groups;
  }, [magnetBindingIds]);

  const editableSurfaceBindingIds = useMemo(
    () => editableBindingGroups.flatMap((group) => group.bindingIds),
    [editableBindingGroups]
  );

  const loadMagnetLayoutStoreState = useCallback(async (): Promise<MagnetLayoutStoreState | null> => {
    if (!isTauri) return null;
    const bootstrapped = await magnetLayoutStoreBootstrapFromLegacy();
    return bootstrapped?.state ?? (await magnetLayoutStoreGetState());
  }, [isTauri]);

  const refreshLocalMagnetSpacesState = useCallback(async (): Promise<MagnetSpacesState> => {
    const legacy = sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));
    const store = await loadMagnetLayoutStoreState();
    const next = store?.spaces ?? legacy;
    setLocalMagnetSpacesState(next);
    return next;
  }, [loadMagnetLayoutStoreState]);

  const applyMagnetLayoutStorePatches = useCallback(
    async (patches: MagnetLayoutStorePatch[], reason: string): Promise<MagnetLayoutStoreState | null> => {
      if (!isTauri) return null;
      const store = await loadMagnetLayoutStoreState();
      if (!store) return null;

      const response = await magnetLayoutStoreApplyPatch({ expectedRevision: store.revision, patches, reason });
      if (!response) return store;

      setLocalMagnetSpacesState(response.state.spaces);
      if (response.ok) return response.state;
      if (response.error?.code !== 'revisionConflict') return response.state;

      const retry = await magnetLayoutStoreApplyPatch({
        expectedRevision: response.state.revision,
        patches,
        reason: `${reason}:retry`,
      });
      if (!retry) return response.state;

      setLocalMagnetSpacesState(retry.state.spaces);
      return retry.state;
    },
    [isTauri, loadMagnetLayoutStoreState]
  );

  useEffect(() => {
    void refreshLocalMagnetSpacesState();
    if (!isTauri) return;

    const setup = async () => {
      const unlisten = await setupTauriListenerWithPayload<{ revision: number; reason: string }>(
        TAURI_EVENTS.MAGNET_LAYOUT_STORE_UPDATED,
        (_payload) => {
          void refreshLocalMagnetSpacesState();
        }
      );

      return () => {
        unlisten();
      };
    };

    const cleanupPromise = setup();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri, refreshLocalMagnetSpacesState]);

  useEffect(() => {
    const ids = new Set(localMagnetSpacesState.spaces.map((space) => space.id));
    if (ids.has(profilePackApplyOptions.targetSpaceId)) return;
    const fallback = localMagnetSpacesState.spaces[0]?.id ?? 'space1';
    if (fallback === profilePackApplyOptions.targetSpaceId) return;
    setProfilePackApplyOptions((prev) => ({ ...prev, targetSpaceId: fallback }));
  }, [localMagnetSpacesState.spaces, profilePackApplyOptions.targetSpaceId]);

  const themePackRequires = useMemo(() => themePack?.manifest.requires ?? null, [themePack?.manifest.requires]);
  const themePackAppVersionSatisfaction = useMemo(
    () => satisfiesSemverRange(APP_VERSION, themePackRequires?.appVersion ?? null),
    [themePackRequires?.appVersion]
  );
  const themePackHostApiVersionSatisfaction = useMemo(
    () => satisfiesSemverRange(HOST_API_VERSION, themePackRequires?.hostApiVersion ?? null),
    [themePackRequires?.hostApiVersion]
  );
  const themePackRequiresViolated =
    themePackAppVersionSatisfaction === 'violates' || themePackHostApiVersionSatisfaction === 'violates';

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

      const resolvedComponentTheme = materializeThemeBinding(theme, `magnet.${rendererId}` as ThemeBindingId);
      const componentTheme = isPlainObject(resolvedComponentTheme)
        ? (resolvedComponentTheme as unknown as Record<string, unknown>)
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
  }, [selectedRendererId, t, theme]);

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

        const componentTheme = parsed.componentTheme as unknown as ThemeImportSurfaceSpec;
        await applyTheme(assignMagnetComponentTheme(theme, rendererId, componentTheme));

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
    [applyTheme, confirm, rendererList, t, theme]
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

  const handleProfilePackUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = await parseProfilePackFromZipBytes(bytes);
        setProfilePack(parsed);

        const packSpacesRaw = parsed.profile?.magnets?.spaces?.value;
        const packSpaces =
          isPlainObject(packSpacesRaw) && packSpacesRaw.version === 1
            ? sanitizeMagnetSpacesState(packSpacesRaw)
            : null;
        const localSpaces = await refreshLocalMagnetSpacesState();

        setProfilePackApplyOptions({
          applyTheme: Boolean(parsed.themeEntry?.text),
          applyMagnets: false,
          magnetsMode: 'replace-all',
          sourceSpaceId: packSpaces?.spaces[0]?.id ?? 'space1',
          targetSpaceId: localSpaces.spaces[0]?.id ?? 'space1',
          acknowledgeOverwrite: false,
        });
        setProfilePackApplyOpen(true);
        setProfilePackMessage({
          kind: 'success',
          text: t('editor.theme-editor.profilePack.message.fileLoaded', { name: file.name }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setProfilePack(null);
        setProfilePackMessage({
          kind: 'error',
          text: t('editor.theme-editor.profilePack.message.fileLoadFailed', { message }),
        });
      } finally {
        event.target.value = '';
      }
    },
    [refreshLocalMagnetSpacesState, t]
  );

  const openProfilePackApplyDialog = useCallback(() => {
    if (!profilePack) return;

    const packSpacesRaw = profilePack.profile?.magnets?.spaces?.value;
    const packSpaces =
      isPlainObject(packSpacesRaw) && packSpacesRaw.version === 1
        ? sanitizeMagnetSpacesState(packSpacesRaw)
        : null;
    if (!isTauri) {
      const localSpaces = sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));
      setProfilePackApplyOptions({
        applyTheme: Boolean(profilePack.themeEntry?.text),
        applyMagnets: false,
        magnetsMode: 'replace-all',
        sourceSpaceId: packSpaces?.spaces[0]?.id ?? 'space1',
        targetSpaceId: localSpaces.spaces[0]?.id ?? 'space1',
        acknowledgeOverwrite: false,
      });
      setProfilePackApplyOpen(true);
      return;
    }
    void refreshLocalMagnetSpacesState().then((localSpaces) => {
      setProfilePackApplyOptions((prev) => ({
        ...prev,
        applyTheme: Boolean(profilePack.themeEntry?.text),
        applyMagnets: false,
        magnetsMode: 'replace-all',
        sourceSpaceId: packSpaces?.spaces[0]?.id ?? 'space1',
        targetSpaceId: localSpaces.spaces[0]?.id ?? 'space1',
        acknowledgeOverwrite: false,
      }));
      setProfilePackApplyOpen(true);
    });
  }, [isTauri, profilePack, refreshLocalMagnetSpacesState]);

  const backupCurrentProfileSnapshot = useCallback(async () => {
    const store = await loadMagnetLayoutStoreState();
    const spaces =
      store?.spaces ??
      sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));

    const layoutsBySpaceId: Record<string, unknown> = {};
    const configsBySpaceId: Record<string, unknown> = {};

    for (const space of spaces.spaces) {
      const storeLayout = store?.layoutsBySpaceId?.[space.id];
      if (storeLayout) {
        layoutsBySpaceId[space.id] = storeLayout;
      } else {
        const layoutKey = resolveMagnetLayoutStorageKey(space.id);
        const layoutRaw = readJson<unknown | null>(layoutKey, null);
        if (layoutRaw !== null) {
          layoutsBySpaceId[space.id] = sanitizeMagnetSpaceLayout(layoutRaw);
        }
      }

      const configKey = resolveMagnetConfigStorageKey(space.id);
      const configRaw = readJson<unknown | null>(configKey, null);
      if (isPlainObject(configRaw)) {
        configsBySpaceId[space.id] = configRaw;
      }
    }

    const snapshot = {
      formatVersion: '1.0',
      createdAt: Date.now(),
      theme,
      magnets: {
        spaces,
        layoutsBySpaceId,
        configsBySpaceId,
      },
    };

    return await writeDurableText('profile-pack-backup', 'last', JSON.stringify(snapshot));
  }, [loadMagnetLayoutStoreState, theme]);

  const applyProfilePackFromDialog = useCallback(async () => {
    if (!profilePack) return;

    const options = profilePackApplyOptions;
    if (!options.applyTheme && !options.applyMagnets) {
      setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.message.nothingSelected') });
      return;
    }

    if (options.applyMagnets && !options.acknowledgeOverwrite) {
      setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.message.ackRequired') });
      return;
    }

    setProfilePackApplyBusy(true);
    setProfilePackApplyOpen(false);

    try {
      if (options.applyMagnets) {
        const backedUp = await backupCurrentProfileSnapshot();
        if (!backedUp) {
          const continueWithoutBackup = await confirm({
            title: t('editor.theme-editor.profilePack.backupFailed.title'),
            message: t('editor.theme-editor.profilePack.backupFailed.message'),
            confirmText: t('editor.theme-editor.profilePack.backupFailed.confirm'),
            danger: true,
          });
          if (!continueWithoutBackup) return;
        }
      }

      if (options.applyTheme) {
        if (!profilePack.themeEntry?.text) {
          setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.message.themeMissing') });
          return;
        }

        const parsed = JSON.parse(profilePack.themeEntry.text) as unknown;
        validateThemeJson(parsed);
        await applyTheme(parsed);
      }

      if (options.applyMagnets) {
        if (!profilePack.profile) {
          setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.message.profileMissing') });
          return;
        }

        const allowedMagnetIds = new Set<string>(BUILTIN_MAGNET_IDS);
        for (const magnet of magnetLibrary) {
          const id = magnet.id.trim();
          if (!id) continue;
          allowedMagnetIds.add(id);
        }

        const rawSpaces = profilePack.profile.magnets?.spaces?.value;
        if (!isPlainObject(rawSpaces) || rawSpaces.version !== 1) {
          setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.message.invalidSpaces') });
          return;
        }

        const rawLayouts = profilePack.profile.magnets?.spaceLayout?.value;
        const rawConfigs = profilePack.profile.magnets?.spaceConfig?.value;

        const nextSpaces = sanitizeMagnetSpacesState(rawSpaces);
        const spaceIds = new Set(nextSpaces.spaces.map((s) => s.id));
        const nextLayoutsBySpaceId: Record<string, unknown> = isPlainObject(rawLayouts) ? rawLayouts : {};
        const nextConfigsBySpaceId: Record<string, unknown> = isPlainObject(rawConfigs) ? rawConfigs : {};

        if (options.magnetsMode === 'replace-all') {
          if (isTauri) {
            const patches: MagnetLayoutStorePatch[] = [{ kind: 'setSpacesState', spaces: nextSpaces }];
            for (const [spaceId, layoutValue] of Object.entries(nextLayoutsBySpaceId)) {
              if (!spaceIds.has(spaceId)) continue;
              if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
              const layout = filterMagnetSpaceLayoutForImport(sanitizeMagnetSpaceLayout(layoutValue), allowedMagnetIds);
              patches.push({ kind: 'setSpaceLayout', spaceId, layout });
            }
            await applyMagnetLayoutStorePatches(patches, 'profilePack.replaceAll');
          } else {
            for (const [spaceId, layoutValue] of Object.entries(nextLayoutsBySpaceId)) {
              if (!spaceIds.has(spaceId)) continue;
              if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
              const layout = filterMagnetSpaceLayoutForImport(sanitizeMagnetSpaceLayout(layoutValue), allowedMagnetIds);
              await broadcastDataUpdate(resolveMagnetLayoutStorageKey(spaceId), layout);
            }
          }

          for (const [spaceId, configValue] of Object.entries(nextConfigsBySpaceId)) {
            if (!spaceIds.has(spaceId)) continue;
            if (!isPlainObject(configValue)) continue;
            await broadcastDataUpdate(
              resolveMagnetConfigStorageKey(spaceId),
              filterMagnetConfigSnapshotForImport(configValue, allowedMagnetIds)
            );
          }

          if (!isTauri) {
            await broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, nextSpaces, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
          }
        } else {
          if (!spaceIds.has(options.sourceSpaceId)) {
            setProfilePackMessage({
              kind: 'error',
              text: t('editor.theme-editor.profilePack.message.sourceSpaceMissing', { id: options.sourceSpaceId }),
            });
            return;
          }

          const localSpaces = isTauri
            ? await refreshLocalMagnetSpacesState()
            : sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));
          const localSpaceIds = new Set(localSpaces.spaces.map((s) => s.id));
          if (!localSpaceIds.has(options.targetSpaceId)) {
            setProfilePackMessage({
              kind: 'error',
              text: t('editor.theme-editor.profilePack.message.targetSpaceMissing', { id: options.targetSpaceId }),
            });
            return;
          }

          const layoutValue = nextLayoutsBySpaceId[options.sourceSpaceId];
          if (isPlainObject(layoutValue) && layoutValue.version === 1) {
            const layout = filterMagnetSpaceLayoutForImport(sanitizeMagnetSpaceLayout(layoutValue), allowedMagnetIds);
            if (isTauri) {
              await applyMagnetLayoutStorePatches(
                [{ kind: 'setSpaceLayout', spaceId: options.targetSpaceId, layout }],
                'profilePack.mapOne'
              );
            } else {
              await broadcastDataUpdate(resolveMagnetLayoutStorageKey(options.targetSpaceId), layout);
            }
          }

          const configValue = nextConfigsBySpaceId[options.sourceSpaceId];
          if (isPlainObject(configValue)) {
            await broadcastDataUpdate(
              resolveMagnetConfigStorageKey(options.targetSpaceId),
              filterMagnetConfigSnapshotForImport(configValue, allowedMagnetIds)
            );
          }

          if (!isTauri) {
            await broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, localSpaces, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
          }
        }
      }

      if (options.applyTheme && options.applyMagnets) {
        setProfilePackMessage({ kind: 'success', text: t('editor.theme-editor.profilePack.message.appliedAll') });
      } else if (options.applyTheme) {
        setProfilePackMessage({ kind: 'success', text: t('editor.theme-editor.profilePack.message.themeApplied') });
      } else {
        setProfilePackMessage({ kind: 'success', text: t('editor.theme-editor.profilePack.message.magnetsApplied') });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfilePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.profilePack.message.applyFailed', { message }),
      });
    } finally {
      setProfilePackApplyBusy(false);
    }
  }, [
    applyTheme,
    backupCurrentProfileSnapshot,
    confirm,
    magnetLibrary,
    profilePack,
    profilePackApplyOptions,
    refreshLocalMagnetSpacesState,
    applyMagnetLayoutStorePatches,
    isTauri,
    t,
  ]);

  const rollbackProfilePackBackup = useCallback(async () => {
    const ok = await confirm({
      title: t('editor.theme-editor.profilePack.rollback.confirm.title'),
      message: t('editor.theme-editor.profilePack.rollback.confirm.message'),
      confirmText: t('editor.theme-editor.profilePack.rollback.confirm.confirm'),
      danger: true,
    });
    if (!ok) return;

    try {
      const raw = await readDurableText('profile-pack-backup', 'last');
      if (!raw) {
        setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.rollback.missing') });
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      assertObject(parsed, 'backup');
      const backupTheme = parsed.theme as unknown;
      validateThemeJson(backupTheme);
      await applyTheme(backupTheme);

      const magnets = (parsed.magnets ?? null) as unknown;
      assertObject(magnets, 'backup.magnets');

      const spaces = sanitizeMagnetSpacesState((magnets as { spaces?: unknown }).spaces);
      const spaceIds = new Set(spaces.spaces.map((s) => s.id));

      const layoutsBySpaceId = (magnets as { layoutsBySpaceId?: unknown }).layoutsBySpaceId;
      if (isPlainObject(layoutsBySpaceId)) {
        if (isTauri) {
          const patches: MagnetLayoutStorePatch[] = [{ kind: 'setSpacesState', spaces }];
          for (const [spaceId, layoutValue] of Object.entries(layoutsBySpaceId)) {
            if (!spaceIds.has(spaceId)) continue;
            if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
            const layout = sanitizeMagnetSpaceLayout(layoutValue);
            patches.push({ kind: 'setSpaceLayout', spaceId, layout });
          }
          await applyMagnetLayoutStorePatches(patches, 'profilePack.rollback');
        } else {
          for (const [spaceId, layoutValue] of Object.entries(layoutsBySpaceId)) {
            if (!spaceIds.has(spaceId)) continue;
            if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
            const layout = sanitizeMagnetSpaceLayout(layoutValue);
            await broadcastDataUpdate(resolveMagnetLayoutStorageKey(spaceId), layout);
          }
        }
      } else if (isTauri) {
        await applyMagnetLayoutStorePatches([{ kind: 'setSpacesState', spaces }], 'profilePack.rollback');
      }

      const configsBySpaceId = (magnets as { configsBySpaceId?: unknown }).configsBySpaceId;
      if (isPlainObject(configsBySpaceId)) {
        for (const [spaceId, configValue] of Object.entries(configsBySpaceId)) {
          if (!spaceIds.has(spaceId)) continue;
          if (!isPlainObject(configValue)) continue;
          await broadcastDataUpdate(resolveMagnetConfigStorageKey(spaceId), configValue);
        }
      }

      if (!isTauri) {
        await broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, spaces, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
      }

      setProfilePackMessage({ kind: 'success', text: t('editor.theme-editor.profilePack.rollback.success') });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.rollback.failed', { message }) });
    }
  }, [applyMagnetLayoutStorePatches, applyTheme, confirm, isTauri, t]);

  const applyThemePackTheme = useCallback(async () => {
    if (!themePack?.entryThemeText) {
      setThemePackMessage({ kind: 'error', text: t('editor.theme-editor.pmpk.message.themeMissing') });
      return;
    }
    try {
      if (themePackRequiresViolated) {
        const ok = await confirm({
          title: t('editor.theme-editor.pmpk.requires.confirm.title'),
          message: [
            t('editor.theme-editor.pmpk.requires.confirm.message'),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.appVersion'),
              APP_VERSION,
              themePackRequires?.appVersion
            ),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.hostApiVersion'),
              HOST_API_VERSION,
              themePackRequires?.hostApiVersion
            ),
          ].join('\n'),
          confirmText: t('editor.theme-editor.pmpk.requires.confirm.confirm'),
          danger: true,
        });
        if (!ok) return;
      }

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
  }, [
    applyTheme,
    confirm,
    t,
    themePack,
    themePackRequires?.appVersion,
    themePackRequires?.hostApiVersion,
    themePackRequiresViolated,
  ]);

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

  const profilePackExportManifest = useMemo(() => {
    try {
      const parsed = JSON.parse(profilePackExportManifestJson) as unknown;
      validateProfilePackManifestV1(parsed);
      return { manifest: parsed as ProfilePackManifestV1, error: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { manifest: null as ProfilePackManifestV1 | null, error: message };
    }
  }, [profilePackExportManifestJson]);

  const downloadProfilePackPmpk = useCallback(async () => {
    const { manifest, error } = profilePackExportManifest;
    if (!manifest) {
      setProfilePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.profilePack.export.manifestInvalid', { message: error ?? 'invalid' }),
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
      setProfilePackMessage({
        kind: 'error',
        text: t('editor.theme-editor.profilePack.export.themeInvalid', { message }),
      });
      return;
    }

    const store = await loadMagnetLayoutStoreState();
    const spaces =
      store?.spaces ??
      sanitizeMagnetSpacesState(readJson(STORAGE_KEYS.MAGNET_SPACES, createDefaultMagnetSpacesState()));

    const layoutsBySpaceId: Record<string, unknown> = {};
    const configsBySpaceId: Record<string, unknown> = {};

    for (const space of spaces.spaces) {
      const storeLayout = store?.layoutsBySpaceId?.[space.id];
      if (storeLayout) {
        layoutsBySpaceId[space.id] = storeLayout;
      } else {
        const layoutKey = resolveMagnetLayoutStorageKey(space.id);
        const layoutRaw = readJson<unknown | null>(layoutKey, null);
        if (layoutRaw !== null) {
          layoutsBySpaceId[space.id] = layoutRaw;
        }
      }

      const configKey = resolveMagnetConfigStorageKey(space.id);
      const configRaw = readJson<unknown | null>(configKey, null);
      if (configRaw !== null) {
        configsBySpaceId[space.id] = configRaw;
      }
    }

    const profile: ProfilePackProfileV1 = {
      formatVersion: '1.0',
      app: { configVersion: 1 },
      theme: { source: { kind: 'pmpt', path: 'theme.pmpt' } },
      magnets: {
        spaces: { storageKey: STORAGE_KEYS.MAGNET_SPACES, value: spaces },
        spaceLayout: { storageKey: STORAGE_KEYS.MAGNET_SPACE_LAYOUT, value: layoutsBySpaceId },
        spaceConfig: { storageKey: STORAGE_KEYS.CONFIG, value: configsBySpaceId },
      },
    };

    try {
      const bytes = await createProfilePackZipBytes({
        manifest,
        profile,
        themeText,
        checksums: { enabled: profilePackExportChecksumsEnabled },
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

      setProfilePackMessage({ kind: 'success', text: t('editor.theme-editor.profilePack.export.success', { name: filename }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProfilePackMessage({ kind: 'error', text: t('editor.theme-editor.profilePack.export.failed', { message }) });
    }
  }, [loadMagnetLayoutStoreState, profilePackExportChecksumsEnabled, profilePackExportManifest, t, themeJson]);

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

  const resetProfilePackExport = useCallback(() => {
    setProfilePackExportManifestJson(JSON.stringify(buildDefaultProfilePackManifest(theme), null, 2));
    setProfilePackMessage(null);
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

      if (themePackRequiresViolated) {
        const ok = await confirm({
          title: t('editor.theme-editor.pmpk.requires.confirm.title'),
          message: [
            t('editor.theme-editor.pmpk.requires.confirm.message'),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.appVersion'),
              APP_VERSION,
              themePackRequires?.appVersion
            ),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.hostApiVersion'),
              HOST_API_VERSION,
              themePackRequires?.hostApiVersion
            ),
          ].join('\n'),
          confirmText: t('editor.theme-editor.pmpk.requires.confirm.confirm'),
          danger: true,
        });
        if (!ok) return;
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
    [
      confirm,
      t,
      themePackRequires?.appVersion,
      themePackRequires?.hostApiVersion,
      themePackRequiresViolated,
    ]
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
      message: [
        ...(themePackRequiresViolated
          ? [
              t('editor.theme-editor.pmpk.requires.confirm.message'),
              buildRequiresSummaryLine(
                t('editor.theme-editor.pmpk.requires.appVersion'),
                APP_VERSION,
                themePackRequires?.appVersion
              ),
              buildRequiresSummaryLine(
                t('editor.theme-editor.pmpk.requires.hostApiVersion'),
                HOST_API_VERSION,
                themePackRequires?.hostApiVersion
              ),
              '',
            ]
          : []),
        ...lines,
        ...(skipped.length > 0 ? ['', t('editor.theme-editor.pmpk.installAll.skipped.title'), ...skipped] : []),
      ].join('\n'),
      confirmText: t('common.action.install'),
      danger: themePackRequiresViolated,
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
  }, [
    confirm,
    t,
    themePack,
    themePackDepsView,
    themePackRequires?.appVersion,
    themePackRequires?.hostApiVersion,
    themePackRequiresViolated,
  ]);

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

      if (themePackRequiresViolated) {
        const ok = await confirm({
          title: t('editor.theme-editor.pmpk.requires.confirm.title'),
          message: [
            t('editor.theme-editor.pmpk.requires.confirm.message'),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.appVersion'),
              APP_VERSION,
              themePackRequires?.appVersion
            ),
            buildRequiresSummaryLine(
              t('editor.theme-editor.pmpk.requires.hostApiVersion'),
              HOST_API_VERSION,
              themePackRequires?.hostApiVersion
            ),
          ].join('\n'),
          confirmText: t('editor.theme-editor.pmpk.requires.confirm.confirm'),
          danger: true,
        });
        if (!ok) return;
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
    [
      applyRendererBindings,
      confirm,
      magnetLibrary,
      t,
      themePackRequires?.appVersion,
      themePackRequires?.hostApiVersion,
      themePackRequiresViolated,
    ]
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

  const selectedBindingEditor = useThemeBindingEditor({
    bindingId: selectedSurfaceBindingId,
    rendererSuggestions: rendererList.map((renderer) => renderer.id),
  });

  const selectedBindingVariantSuggestions = useMemo(() => {
    if (!selectedSurfaceBindingId.startsWith('magnet.')) {
      return [] as string[];
    }

    return listMagnetVariants(selectedSurfaceBindingId.slice('magnet.'.length)).map((variant) => variant.id);
  }, [selectedSurfaceBindingId]);

  const profilePackApplyWarnings = useMemo(() => {
    if (!profilePack) {
      return {
        missingMagnetIds: [] as string[],
        embeddedCustomMagnetIds: [] as string[],
        missingRendererIds: [] as string[],
      };
    }

    const missingMagnetIds = new Set<string>();
    const embeddedCustomMagnetIds = new Set<string>();
    const missingRendererIds = new Set<string>();
    const registeredRendererIds = new Set(rendererList.map((renderer) => renderer.id));
    const allowedMagnetIds = new Set<string>(BUILTIN_MAGNET_IDS);
    for (const magnet of magnetLibrary) {
      const id = magnet.id.trim();
      if (!id) continue;
      allowedMagnetIds.add(id);
    }

    if (profilePack.themeEntry?.text) {
      try {
        const parsedTheme = JSON.parse(profilePack.themeEntry.text) as unknown;
        for (const rendererId of extractThemeRendererIds(parsedTheme)) {
          if (!registeredRendererIds.has(rendererId)) {
            missingRendererIds.add(rendererId);
          }
        }
      } catch {
        // ignore theme parsing errors here; apply flow validates separately
      }
    }

    const rawLayouts = profilePack.profile?.magnets?.spaceLayout?.value;
    if (isPlainObject(rawLayouts)) {
      for (const layoutValue of Object.values(rawLayouts)) {
        if (!isPlainObject(layoutValue) || layoutValue.version !== 1) continue;
        const active = (layoutValue as { activeMagnetIds?: unknown }).activeMagnetIds;
        if (Array.isArray(active)) {
          for (const entry of active) {
            if (typeof entry !== 'string') continue;
            const id = entry.trim();
            if (!id) continue;
            if (allowedMagnetIds.has(id)) continue;
            missingMagnetIds.add(id);
          }
        }

        const anchors = (layoutValue as { anchorsByMagnetId?: unknown }).anchorsByMagnetId;
        if (isPlainObject(anchors)) {
          for (const id of Object.keys(anchors)) {
            if (!id) continue;
            if (allowedMagnetIds.has(id)) continue;
            missingMagnetIds.add(id);
          }
        }
      }
    }

    const rawConfigs = profilePack.profile?.magnets?.spaceConfig?.value;
    if (isPlainObject(rawConfigs)) {
      for (const configValue of Object.values(rawConfigs)) {
        if (!isPlainObject(configValue)) continue;

        const magnets = (configValue as { magnets?: unknown }).magnets;
        if (isPlainObject(magnets)) {
          for (const [magnetId, state] of Object.entries(magnets)) {
            const normalizedMagnetId = magnetId.trim();
            if (!normalizedMagnetId) continue;
            if (!allowedMagnetIds.has(normalizedMagnetId)) {
              missingMagnetIds.add(normalizedMagnetId);
              continue;
            }

            if (!isPlainObject(state)) continue;
            const rendererId = (state as { renderer?: unknown }).renderer;
            if (typeof rendererId === 'string' && rendererId.trim().length > 0) {
              const normalizedRendererId = rendererId.trim();
              if (!registeredRendererIds.has(normalizedRendererId)) {
                missingRendererIds.add(normalizedRendererId);
              }
            }
          }
        }

        const customMagnets = (configValue as { customMagnets?: unknown }).customMagnets;
        if (Array.isArray(customMagnets)) {
          for (const entry of customMagnets) {
            if (!isPlainObject(entry)) continue;
            const id = typeof entry.id === 'string' ? entry.id.trim() : '';
            if (!id) continue;
            if (BUILTIN_MAGNET_IDS.has(id)) continue;
            embeddedCustomMagnetIds.add(id);
          }
        }
      }
    }

    return {
      missingMagnetIds: [...missingMagnetIds].sort(),
      embeddedCustomMagnetIds: [...embeddedCustomMagnetIds].sort(),
      missingRendererIds: [...missingRendererIds].sort(),
    };
  }, [magnetLibrary, profilePack, rendererList]);

  useEffect(() => {
    if (!selectedRendererId || selectedRenderer) return;
    setSelectedRendererId(rendererList[0]?.id ?? '');
  }, [rendererList, selectedRenderer, selectedRendererId]);

  useEffect(() => {
    if (editableSurfaceBindingIds.includes(selectedSurfaceBindingId)) return;
    setSelectedSurfaceBindingId(editableSurfaceBindingIds[0] ?? DEFAULT_SELECTED_SURFACE_BINDING_ID);
  }, [editableSurfaceBindingIds, selectedSurfaceBindingId]);

  useEffect(() => {
    if (!profilePackApplyOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (profilePackApplyBusy) return;
      setProfilePackApplyOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [profilePackApplyBusy, profilePackApplyOpen]);

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
                <div className="theme-editor-section-title">Bindings / Surfaces</div>

                <div className="theme-binding-groups">
                  {editableBindingGroups.map((group) => (
                    <div key={group.id} className="theme-binding-group">
                      <div className="theme-binding-group-title">{group.label}</div>
                      <div className="theme-binding-group-items">
                        {group.bindingIds.map((bindingId) => {
                          const explicitBinding = theme.bindings?.[bindingId] ?? null;
                          const hasSelfSurface = Boolean(theme.surfaces?.[bindingId]);
                          const isSelected = bindingId === selectedSurfaceBindingId;
                          return (
                            <button
                              key={bindingId}
                              type="button"
                              className={`theme-binding-item ${isSelected ? 'is-selected' : ''}`}
                              onClick={() => setSelectedSurfaceBindingId(bindingId)}
                            >
                              <span className="theme-binding-item-id">{bindingId}</span>
                              <span className="theme-binding-item-meta">
                                {explicitBinding?.surface ?? (hasSelfSurface ? '(self surface)' : '(unbound)')}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="theme-binding-detail">
                  <ThemeBindingEditorPanel
                    bindingId={selectedSurfaceBindingId}
                    bindingEditor={selectedBindingEditor}
                    variantInput={{
                      kind: 'input',
                      suggestions: selectedBindingVariantSuggestions,
                      placeholder: 'Optional explicit variant id',
                    }}
                    renderActionButton={(button) => (
                      <button
                        type="button"
                        className="theme-editor-action-btn"
                        onClick={button.onClick}
                      >
                        {button.label}
                      </button>
                    )}
                  />
                </div>
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

                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.requires.title')}</span>
                      <div className="theme-pack-dep-chips">
                        <span className={`theme-pack-chip theme-pack-chip--${themePackAppVersionSatisfaction}`}>
                          {t('editor.theme-editor.pmpk.requires.appVersion')}: {themePackRequires?.appVersion ?? '-'}
                          <span className="theme-pack-chip-suffix">
                            {APP_VERSION} ·{' '}
                            {t(`editor.theme-editor.pmpk.deps.satisfaction.${themePackAppVersionSatisfaction}`)}
                          </span>
                        </span>
                        <span className={`theme-pack-chip theme-pack-chip--${themePackHostApiVersionSatisfaction}`}>
                          {t('editor.theme-editor.pmpk.requires.hostApiVersion')}: {themePackRequires?.hostApiVersion ?? '-'}
                          <span className="theme-pack-chip-suffix">
                            {HOST_API_VERSION} ·{' '}
                            {t(`editor.theme-editor.pmpk.deps.satisfaction.${themePackHostApiVersionSatisfaction}`)}
                          </span>
                        </span>
                      </div>
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
                <div className="theme-editor-section-title">{t('editor.theme-editor.profilePack.section.title')}</div>

                <div className="theme-editor-section-actions">
                  <label className="theme-editor-file-btn">
                    <input type="file" accept=".pmpk,application/zip" onChange={handleProfilePackUpload} />
                    {t('editor.theme-editor.profilePack.importFile')}
                  </label>
                  <button
                    type="button"
                    className="theme-editor-action-btn"
                    onClick={openProfilePackApplyDialog}
                    disabled={!profilePack || profilePackApplyBusy}
                  >
                    {t('editor.theme-editor.profilePack.apply')}
                  </button>
                  <button
                    type="button"
                    className="theme-editor-action-btn"
                    onClick={rollbackProfilePackBackup}
                    disabled={profilePackApplyBusy}
                  >
                    {t('editor.theme-editor.profilePack.rollback')}
                  </button>
                </div>

                {profilePackMessage ? (
                  <div className={`theme-editor-message theme-editor-message--${profilePackMessage.kind}`}>
                    {profilePackMessage.text}
                  </div>
                ) : null}

                {profilePack ? (
                  <div className="theme-pack-summary">
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.idLabel')}</span>
                      <span className="theme-pack-value">{profilePack.manifest.metadata.id}</span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.nameLabel')}</span>
                      <span className="theme-pack-value">{profilePack.manifest.metadata.name}</span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">
                        {t('editor.theme-editor.profilePack.summary.entryProfileLabel')}
                      </span>
                      <span className="theme-pack-value">{profilePack.entryProfilePath}</span>
                      <span className={`theme-pack-status ${profilePack.profile ? 'is-ok' : 'is-missing'}`}>
                        {profilePack.profile
                          ? t('editor.theme-editor.pmpk.entryTheme.ok')
                          : t('editor.theme-editor.pmpk.entryTheme.missing')}
                      </span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.entryThemeLabel')}</span>
                      <span className="theme-pack-value">{profilePack.themeEntry?.path ?? '-'}</span>
                      <span className={`theme-pack-status ${profilePack.themeEntry?.text ? 'is-ok' : 'is-missing'}`}>
                        {profilePack.themeEntry?.text
                          ? t('editor.theme-editor.pmpk.entryTheme.ok')
                          : t('editor.theme-editor.pmpk.entryTheme.missing')}
                      </span>
                    </div>
                    <div className="theme-pack-row">
                      <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.integrityLabel')}</span>
                      <span className={`theme-pack-status ${profilePack.checksums ? 'is-ok' : ''}`}>
                        {profilePack.checksums
                          ? t('editor.theme-editor.pmpk.integrity.ok')
                          : t('editor.theme-editor.pmpk.integrity.missing')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="theme-editor-muted">{t('editor.theme-editor.profilePack.empty')}</div>
                )}

                <div className="theme-pack-divider" />

                <div className="theme-pack-export">
                  <div className="theme-pack-export-header">
                    <div className="theme-pack-export-title">{t('editor.theme-editor.profilePack.export.title')}</div>
                    <div className="theme-editor-section-actions">
                      <button type="button" className="theme-editor-action-btn" onClick={resetProfilePackExport}>
                        {t('common.action.reset')}
                      </button>
                      <button
                        type="button"
                        className="theme-editor-action-btn"
                        onClick={downloadProfilePackPmpk}
                        disabled={!profilePackExportManifest.manifest}
                      >
                        {t('editor.theme-editor.profilePack.export.exportFile')}
                      </button>
                    </div>
                  </div>

                  <label className="theme-pack-export-checkbox">
                    <input
                      type="checkbox"
                      checked={profilePackExportChecksumsEnabled}
                      onChange={(event) => setProfilePackExportChecksumsEnabled(event.target.checked)}
                    />
                    <span>{t('editor.theme-editor.profilePack.export.includeChecksums')}</span>
                  </label>

                  {profilePackExportManifest.error ? (
                    <div className="theme-editor-message theme-editor-message--error">
                      {t('editor.theme-editor.profilePack.export.manifestError', {
                        message: profilePackExportManifest.error,
                      })}
                    </div>
                  ) : null}

                  <textarea
                    className="theme-editor-textarea theme-editor-textarea--compact"
                    value={profilePackExportManifestJson}
                    onChange={(event) => setProfilePackExportManifestJson(event.target.value)}
                    spellCheck={false}
                  />
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
                          explicitBinding: theme.bindings?.[`magnet.${selectedRenderer.id}`] ?? null,
                          materializedComponentTheme: materializeThemeBinding(
                            theme,
                            `magnet.${selectedRenderer.id}` as ThemeBindingId
                          ),
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
      {profilePackApplyOpen && profilePack ? (
        <div
          className="pmp-confirm-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (profilePackApplyBusy) return;
            setProfilePackApplyOpen(false);
          }}
        >
          <div className="pmp-confirm-modal profile-pack-apply-modal" onClick={(event) => event.stopPropagation()}>
            <div className="pmp-confirm-header">
              <div className="pmp-confirm-title">{t('editor.theme-editor.profilePack.applyDialog.title')}</div>
            </div>
            <div className="pmp-confirm-body">
              <div className="profile-pack-apply-summary theme-pack-summary">
                <div className="theme-pack-row">
                  <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.idLabel')}</span>
                  <span className="theme-pack-value">{profilePack.manifest.metadata.id}</span>
                </div>
                <div className="theme-pack-row">
                  <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.nameLabel')}</span>
                  <span className="theme-pack-value">{profilePack.manifest.metadata.name}</span>
                </div>
                <div className="theme-pack-row">
                  <span className="theme-pack-key">{t('editor.theme-editor.pmpk.summary.versionLabel')}</span>
                  <span className="theme-pack-value">{profilePack.manifest.metadata.version}</span>
                </div>
              </div>

              <div className="profile-pack-apply-options">
                <label className="theme-pack-export-checkbox">
                  <input
                    type="checkbox"
                    checked={profilePackApplyOptions.applyTheme}
                    disabled={!profilePack.themeEntry?.text || profilePackApplyBusy}
                    onChange={(event) =>
                      setProfilePackApplyOptions((prev) => ({
                        ...prev,
                        applyTheme: event.target.checked,
                      }))
                    }
                  />
                  <span>{t('editor.theme-editor.profilePack.applyDialog.applyTheme')}</span>
                </label>

                <label className="theme-pack-export-checkbox">
                  <input
                    type="checkbox"
                    checked={profilePackApplyOptions.applyMagnets}
                    disabled={!profilePack.profile || profilePackApplyBusy}
                    onChange={(event) =>
                      setProfilePackApplyOptions((prev) => ({
                        ...prev,
                        applyMagnets: event.target.checked,
                        acknowledgeOverwrite: event.target.checked ? prev.acknowledgeOverwrite : false,
                      }))
                    }
                  />
                  <span>{t('editor.theme-editor.profilePack.applyDialog.applyMagnets')}</span>
                </label>

                {profilePackApplyOptions.applyMagnets ? (
                  <div className="profile-pack-apply-magnets">
                    <div className="profile-pack-apply-row">
                      <label className="profile-pack-apply-radio">
                        <input
                          type="radio"
                          name="profile-pack-apply-mode"
                          checked={profilePackApplyOptions.magnetsMode === 'replace-all'}
                          disabled={profilePackApplyBusy}
                          onChange={() =>
                            setProfilePackApplyOptions((prev) => ({
                              ...prev,
                              magnetsMode: 'replace-all',
                            }))
                          }
                        />
                        <span>{t('editor.theme-editor.profilePack.applyDialog.mode.replaceAll')}</span>
                      </label>
                      <label className="profile-pack-apply-radio">
                        <input
                          type="radio"
                          name="profile-pack-apply-mode"
                          checked={profilePackApplyOptions.magnetsMode === 'map-one'}
                          disabled={profilePackApplyBusy}
                          onChange={() =>
                            setProfilePackApplyOptions((prev) => ({
                              ...prev,
                              magnetsMode: 'map-one',
                            }))
                          }
                        />
                        <span>{t('editor.theme-editor.profilePack.applyDialog.mode.mapOne')}</span>
                      </label>
                    </div>

                    {profilePackApplyOptions.magnetsMode === 'map-one' ? (
                      <div className="profile-pack-apply-row profile-pack-apply-row--mapping">
                        <label className="profile-pack-apply-field">
                          <span className="profile-pack-apply-label">
                            {t('editor.theme-editor.profilePack.applyDialog.sourceSpace')}
                          </span>
                          <select
                            className="profile-pack-apply-select"
                            value={profilePackApplyOptions.sourceSpaceId}
                            disabled={profilePackApplyBusy}
                            onChange={(event) =>
                              setProfilePackApplyOptions((prev) => ({
                                ...prev,
                                sourceSpaceId: event.target.value,
                              }))
                            }
                          >
                            {(() => {
                              const rawSpaces = profilePack.profile?.magnets?.spaces?.value;
                              if (!isPlainObject(rawSpaces) || rawSpaces.version !== 1) return null;
                              const spaces = sanitizeMagnetSpacesState(rawSpaces);
                              return spaces.spaces.map((space) => (
                                <option key={space.id} value={space.id}>
                                  {space.name} ({space.id})
                                </option>
                              ));
                            })()}
                          </select>
                        </label>

                        <label className="profile-pack-apply-field">
                          <span className="profile-pack-apply-label">
                            {t('editor.theme-editor.profilePack.applyDialog.targetSpace')}
                          </span>
                          <select
                            className="profile-pack-apply-select"
                            value={profilePackApplyOptions.targetSpaceId}
                            disabled={profilePackApplyBusy}
                            onChange={(event) =>
                              setProfilePackApplyOptions((prev) => ({
                                ...prev,
                                targetSpaceId: event.target.value,
                              }))
                            }
                          >
                            {localMagnetSpacesState.spaces.map((space) => (
                              <option key={space.id} value={space.id}>
                                {space.name} ({space.id})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}

                    <label className="theme-pack-export-checkbox profile-pack-apply-ack">
                      <input
                        type="checkbox"
                        checked={profilePackApplyOptions.acknowledgeOverwrite}
                        disabled={profilePackApplyBusy}
                        onChange={(event) =>
                          setProfilePackApplyOptions((prev) => ({
                            ...prev,
                            acknowledgeOverwrite: event.target.checked,
                          }))
                        }
                      />
                      <span>{t('editor.theme-editor.profilePack.applyDialog.acknowledgeOverwrite')}</span>
                    </label>
                  </div>
                ) : null}
              </div>

              {profilePackApplyWarnings.missingMagnetIds.length > 0 ||
              profilePackApplyWarnings.embeddedCustomMagnetIds.length > 0 ||
              profilePackApplyWarnings.missingRendererIds.length > 0 ? (
                <div className="profile-pack-apply-warnings">
                  <div className="profile-pack-apply-warnings-title">
                    {t('editor.theme-editor.profilePack.applyDialog.warnings.title')}
                  </div>

                  {profilePackApplyWarnings.missingMagnetIds.length > 0 ? (
                    <>
                      <div className="theme-editor-muted">
                        {t('editor.theme-editor.profilePack.applyDialog.warnings.missingMagnets', {
                          count: profilePackApplyWarnings.missingMagnetIds.length,
                        })}
                      </div>
                      <pre className="theme-editor-panel-json">
                        {profilePackApplyWarnings.missingMagnetIds.join('\n')}
                      </pre>
                    </>
                  ) : null}

                  {profilePackApplyWarnings.embeddedCustomMagnetIds.length > 0 ? (
                    <>
                      <div className="theme-editor-muted">
                        {t('editor.theme-editor.profilePack.applyDialog.warnings.customMagnetsIgnored', {
                          count: profilePackApplyWarnings.embeddedCustomMagnetIds.length,
                        })}
                      </div>
                      <pre className="theme-editor-panel-json">
                        {profilePackApplyWarnings.embeddedCustomMagnetIds.join('\n')}
                      </pre>
                    </>
                  ) : null}

                  {profilePackApplyWarnings.missingRendererIds.length > 0 ? (
                    <>
                      <div className="theme-editor-muted">
                        {t('editor.theme-editor.profilePack.applyDialog.warnings.missingRenderers', {
                          count: profilePackApplyWarnings.missingRendererIds.length,
                        })}
                      </div>
                      <pre className="theme-editor-panel-json">
                        {profilePackApplyWarnings.missingRendererIds.join('\n')}
                      </pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="pmp-confirm-footer">
              <button
                type="button"
                className="pmp-confirm-btn"
                onClick={() => setProfilePackApplyOpen(false)}
                disabled={profilePackApplyBusy}
              >
                {t('common.action.cancel')}
              </button>
              <button
                type="button"
                className="pmp-confirm-btn pmp-confirm-btn--primary"
                onClick={() => void applyProfilePackFromDialog()}
                disabled={
                  profilePackApplyBusy ||
                  (!profilePackApplyOptions.applyTheme && !profilePackApplyOptions.applyMagnets) ||
                  (profilePackApplyOptions.applyTheme && !profilePack.themeEntry?.text) ||
                  (profilePackApplyOptions.applyMagnets && !profilePack.profile) ||
                  (profilePackApplyOptions.applyMagnets && !profilePackApplyOptions.acknowledgeOverwrite)
                }
              >
                {t('common.action.apply')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
