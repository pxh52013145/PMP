import type {
  PmpHostMagnetContributionDescriptor,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import { readJson } from '../../modules/storage';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  setupDualListener,
} from '../../utils/windowCommunication';
import type { InstalledHostExtensionRecord } from './extensions';
import { validateInstalledExtensionManifest } from './extensions';
import { readInstalledExtensionPmpHostContributions } from './installedExtensionHostPmp';

export type PluginMagnetCreatorAnchorMode =
  | 'single'
  | 'horizontal'
  | 'vertical'
  | 'rectangular';

export type PluginMagnetCreatorIssueSeverity = 'error' | 'warning';

export interface PluginMagnetCreatorIssue {
  severity: PluginMagnetCreatorIssueSeverity;
  field: string;
  code: string;
  message: string;
  detail?: string;
}

export interface PluginMagnetCreatorVariantDraft {
  id: string;
  label: string;
  description: string;
}

export interface PluginMagnetCreatorDraft {
  pluginId: string;
  publisher: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  runtimeId: string;
  runtimeEntry: string;
  anchorMode: PluginMagnetCreatorAnchorMode;
  originX: number;
  originY: number;
  width: number;
  height: number;
  defaultVariant: string;
  variants: PluginMagnetCreatorVariantDraft[];
  defaultStyleText: string;
}

export interface PluginMagnetCreatorValidationResult {
  ok: boolean;
  issues: PluginMagnetCreatorIssue[];
}

export interface PluginMagnetCreatorArtifacts {
  draft: PluginMagnetCreatorDraft;
  manifestPatch: unknown;
  minimalManifest: PxpManifestV2;
  runtimeTemplate: string;
  validation: PluginMagnetCreatorValidationResult;
}

type PluginMagnetCreatorListener = () => void;

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const CONTRIBUTION_ID_PATTERN = /^[a-z0-9-]{1,48}$/;
const DEFAULT_STYLE = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(8, 20, 38, 0.74)',
  borderRadius: '8px',
  padding: '10px',
};
const DEFAULT_VARIANT: PluginMagnetCreatorVariantDraft = {
  id: 'default',
  label: 'Default',
  description: 'Default magnet surface.',
};

const listeners = new Set<PluginMagnetCreatorListener>();
let revision = 0;
let syncDisposer: (() => void) | null = null;

function emitRevision(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

async function ensureSync(): Promise<void> {
  if (syncDisposer || typeof window === 'undefined') return;
  syncDisposer = await setupDualListener(
    [STORAGE_KEYS.PLUGIN_MAGNET_CREATOR_DRAFT_V1],
    [TAURI_EVENTS.PLUGIN_MAGNET_CREATOR_DRAFT_UPDATED],
    emitRevision
  );
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeMultilineString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(30, Math.floor(value)));
}

function normalizeGridInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(29, Math.floor(value)));
}

function normalizeAnchorMode(value: unknown): PluginMagnetCreatorAnchorMode {
  return value === 'horizontal' ||
    value === 'vertical' ||
    value === 'rectangular' ||
    value === 'single'
    ? value
    : 'horizontal';
}

function createDefaultStyleText(): string {
  return JSON.stringify(DEFAULT_STYLE, null, 2);
}

function createSlug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeVariantDrafts(value: unknown): PluginMagnetCreatorVariantDraft[] {
  const variants = Array.isArray(value) ? value : [];
  const normalized = variants
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const id = createSlug(normalizeString(record.id), '');
      if (!id) return null;
      return {
        id,
        label: normalizeString(record.label) || id,
        description: normalizeMultilineString(record.description),
      };
    })
    .filter((item): item is PluginMagnetCreatorVariantDraft => item !== null);

  return normalized.length > 0 ? normalized : [{ ...DEFAULT_VARIANT }];
}

export function createDefaultPluginMagnetCreatorDraft(): PluginMagnetCreatorDraft {
  return {
    pluginId: 'my-plugin-magnet',
    publisher: 'pixel-matrix.dev',
    name: 'my-plugin-magnet',
    displayName: 'My Plugin Magnet',
    version: '0.1.0',
    description: 'A manifest-v2 plugin magnet surface.',
    runtimeId: 'webview.main',
    runtimeEntry: 'index.js',
    anchorMode: 'horizontal',
    originX: 0,
    originY: 0,
    width: 2,
    height: 1,
    defaultVariant: DEFAULT_VARIANT.id,
    variants: [{ ...DEFAULT_VARIANT }],
    defaultStyleText: createDefaultStyleText(),
  };
}

export function normalizePluginMagnetCreatorDraft(
  value: Partial<PluginMagnetCreatorDraft> | unknown
): PluginMagnetCreatorDraft {
  const fallback = createDefaultPluginMagnetCreatorDraft();
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const pluginId = createSlug(normalizeString(record.pluginId), fallback.pluginId);
  const variants = normalizeVariantDrafts(record.variants);
  const defaultVariantCandidate = createSlug(
    normalizeString(record.defaultVariant),
    variants[0]?.id ?? DEFAULT_VARIANT.id
  );
  const defaultVariant = variants.some((variant) => variant.id === defaultVariantCandidate)
    ? defaultVariantCandidate
    : variants[0]?.id ?? DEFAULT_VARIANT.id;

  return {
    pluginId,
    publisher: normalizeString(record.publisher) || fallback.publisher,
    name: createSlug(normalizeString(record.name), pluginId),
    displayName: normalizeString(record.displayName) || pluginId,
    version: normalizeString(record.version) || fallback.version,
    description: normalizeMultilineString(record.description) || fallback.description,
    runtimeId: normalizeString(record.runtimeId) || fallback.runtimeId,
    runtimeEntry: normalizeString(record.runtimeEntry) || fallback.runtimeEntry,
    anchorMode: normalizeAnchorMode(record.anchorMode),
    originX: normalizeGridInteger(record.originX, fallback.originX),
    originY: normalizeGridInteger(record.originY, fallback.originY),
    width: normalizePositiveInteger(record.width, fallback.width),
    height: normalizePositiveInteger(record.height, fallback.height),
    defaultVariant,
    variants,
    defaultStyleText:
      normalizeMultilineString(record.defaultStyleText) || createDefaultStyleText(),
  };
}

function parseDefaultStyle(defaultStyleText: string): Record<string, unknown> {
  const parsed = JSON.parse(defaultStyleText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('defaultStyle must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function validateRelativeRuntimeEntry(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) return 'runtimeEntry.required';
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    return 'runtimeEntry.relative';
  }
  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return 'runtimeEntry.segments';
  }
  return null;
}

function buildDefaultAnchor(
  draft: PluginMagnetCreatorDraft
): NonNullable<PmpHostMagnetContributionDescriptor['defaultAnchor']> {
  const x = draft.originX;
  const y = draft.originY;
  if (draft.anchorMode === 'single') {
    return {
      type: 'single',
      coordinates: [{ x, y }],
    };
  }

  const endX =
    draft.anchorMode === 'vertical' ? x : Math.min(29, x + Math.max(1, draft.width) - 1);
  const endY =
    draft.anchorMode === 'horizontal' ? y : Math.min(29, y + Math.max(1, draft.height) - 1);

  return {
    type: 'range',
    coordinates: [
      { x, y },
      { x: endX, y: endY },
    ],
  };
}

export function buildPluginMagnetContribution(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): PmpHostMagnetContributionDescriptor {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  return {
    defaultAnchor: buildDefaultAnchor(draft),
    defaultStyle: parseDefaultStyle(draft.defaultStyleText),
    defaultVariant: draft.defaultVariant,
    variants: draft.variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      ...(variant.description.trim() ? { description: variant.description.trim() } : {}),
    })),
  };
}

export function buildPluginMagnetManifestPatch(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): unknown {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  return {
    runtimes: [
      {
        runtimeId: draft.runtimeId,
        kind: 'webview',
        entry: draft.runtimeEntry,
        priority: 30,
        bridge: 'pxp.runtime.bridge.v1',
        dataPlane: {
          kinds: ['inline-json'],
        },
      },
    ],
    activationEvents: [`onView:${draft.pluginId}`],
    contributes: {
      host: {
        pmp: {
          magnets: buildPluginMagnetContribution(draft),
        },
      },
    },
  };
}

export function buildPluginMagnetMinimalManifest(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): PxpManifestV2 {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  return {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: draft.pluginId,
      publisher: draft.publisher,
      version: draft.version,
      name: draft.name,
      displayName: draft.displayName,
      description: draft.description,
    },
    hostTargets: [
      {
        hostId: 'pmp',
        required: true,
      },
    ],
    ...(buildPluginMagnetManifestPatch(draft) as Pick<
      PxpManifestV2,
      'runtimes' | 'activationEvents' | 'contributes'
    >),
  };
}

export function buildPluginMagnetRuntimeTemplate(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): string {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  const title = JSON.stringify(draft.displayName || draft.pluginId);
  const pluginId = JSON.stringify(draft.pluginId);

  return `function readVariant(mountContext) {
  return mountContext &&
    typeof mountContext === 'object' &&
    mountContext.theme &&
    typeof mountContext.theme === 'object' &&
    typeof mountContext.theme.variant === 'string'
    ? mountContext.theme.variant
    : 'default';
}

export function mount(container, api, mountContext) {
  const variant = readVariant(mountContext);
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.justifyContent = 'center';
  root.style.gap = '8px';
  root.style.padding = '12px';
  root.style.borderRadius = '10px';
  root.style.background = 'linear-gradient(135deg, rgba(8,20,38,0.92), rgba(20,80,90,0.72))';
  root.style.border = '1px solid rgba(255,255,255,0.14)';
  root.style.color = 'rgba(248,250,252,0.96)';
  root.style.fontFamily = '"Segoe UI", sans-serif';

  const heading = document.createElement('div');
  heading.textContent = ${title};
  heading.style.fontSize = '14px';
  heading.style.fontWeight = '800';
  root.appendChild(heading);

  const meta = document.createElement('div');
  meta.textContent = ${pluginId} + ' / ' + variant;
  meta.style.fontSize = '11px';
  meta.style.opacity = '0.74';
  root.appendChild(meta);

  container.innerHTML = '';
  container.appendChild(root);

  return () => {
    container.innerHTML = '';
  };
}
`;
}

export function validatePluginMagnetCreatorDraft(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): PluginMagnetCreatorValidationResult {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  const issues: PluginMagnetCreatorIssue[] = [];

  if (!PLUGIN_ID_PATTERN.test(draft.pluginId)) {
    issues.push({
      severity: 'error',
      field: 'pluginId',
      code: 'pluginId.pattern',
      message: 'plugin id must match /^[a-z0-9][a-z0-9._-]{1,63}$/',
    });
  }
  if (!draft.publisher) {
    issues.push({
      severity: 'error',
      field: 'publisher',
      code: 'publisher.required',
      message: 'publisher is required',
    });
  }
  if (!draft.version) {
    issues.push({
      severity: 'error',
      field: 'version',
      code: 'version.required',
      message: 'version is required',
    });
  }
  if (!draft.runtimeId) {
    issues.push({
      severity: 'error',
      field: 'runtimeId',
      code: 'runtimeId.required',
      message: 'runtime id is required',
    });
  }
  const runtimeEntryError = validateRelativeRuntimeEntry(draft.runtimeEntry);
  if (runtimeEntryError) {
    issues.push({
      severity: 'error',
      field: 'runtimeEntry',
      code: runtimeEntryError,
      message:
        runtimeEntryError === 'runtimeEntry.required'
          ? 'runtime entry is required'
          : runtimeEntryError === 'runtimeEntry.relative'
            ? 'runtime entry must be relative'
            : 'runtime entry contains invalid path segments',
    });
  }

  const variantIds = new Set<string>();
  for (const variant of draft.variants) {
    if (!CONTRIBUTION_ID_PATTERN.test(variant.id)) {
      issues.push({
        severity: 'error',
        field: 'variants',
        code: 'variant.pattern',
        message: `variant "${variant.id}" must match /^[a-z0-9-]{1,48}$/`,
        detail: variant.id,
      });
    }
    if (variantIds.has(variant.id)) {
      issues.push({
        severity: 'error',
        field: 'variants',
        code: 'variant.duplicate',
        message: `variant "${variant.id}" is duplicated`,
        detail: variant.id,
      });
    }
    variantIds.add(variant.id);
    if (!variant.label.trim()) {
      issues.push({
        severity: 'error',
        field: 'variants',
        code: 'variant.labelRequired',
        message: `variant "${variant.id}" label is required`,
        detail: variant.id,
      });
    }
  }
  if (!variantIds.has(draft.defaultVariant)) {
    issues.push({
      severity: 'error',
      field: 'defaultVariant',
      code: 'defaultVariant.missing',
      message: 'default variant must exist in variants',
    });
  }

  try {
    parseDefaultStyle(draft.defaultStyleText);
  } catch (error) {
    issues.push({
      severity: 'error',
      field: 'defaultStyle',
      code: 'defaultStyle.json',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (draft.anchorMode === 'single' && (draft.width !== 1 || draft.height !== 1)) {
    issues.push({
      severity: 'warning',
      field: 'anchor',
      code: 'anchor.singleSize',
      message: 'single anchor ignores width and height',
    });
  }

  if (!issues.some((issue) => issue.severity === 'error')) {
    try {
      validateInstalledExtensionManifest(buildPluginMagnetMinimalManifest(draft));
    } catch (error) {
      issues.push({
        severity: 'error',
        field: 'manifest',
        code: 'manifest.validator',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function readAnchorModeFromContribution(
  magnet: PmpHostMagnetContributionDescriptor | null | undefined
): Pick<PluginMagnetCreatorDraft, 'anchorMode' | 'originX' | 'originY' | 'width' | 'height'> {
  const coordinates = magnet?.defaultAnchor?.coordinates ?? [];
  const first = coordinates[0];
  const second = coordinates[1] ?? first;
  if (!first || typeof first.x !== 'number' || typeof first.y !== 'number') {
    return {
      anchorMode: 'horizontal',
      originX: 0,
      originY: 0,
      width: 2,
      height: 1,
    };
  }

  const minX = Math.min(first.x, second?.x ?? first.x);
  const minY = Math.min(first.y, second?.y ?? first.y);
  const width = Math.max(1, Math.abs((second?.x ?? first.x) - first.x) + 1);
  const height = Math.max(1, Math.abs((second?.y ?? first.y) - first.y) + 1);
  if (!second || (width === 1 && height === 1)) {
    return {
      anchorMode: 'single',
      originX: minX,
      originY: minY,
      width: 1,
      height: 1,
    };
  }
  if (height === 1) {
    return {
      anchorMode: 'horizontal',
      originX: minX,
      originY: minY,
      width,
      height: 1,
    };
  }
  if (width === 1) {
    return {
      anchorMode: 'vertical',
      originX: minX,
      originY: minY,
      width: 1,
      height,
    };
  }
  return {
    anchorMode: 'rectangular',
    originX: minX,
    originY: minY,
    width,
    height,
  };
}

export function createPluginMagnetCreatorDraftFromInstalledExtension(
  record: InstalledHostExtensionRecord
): PluginMagnetCreatorDraft {
  const identity = record.manifest.identity;
  const runtime =
    record.manifest.runtimes.find((item) => item.kind === 'webview') ?? record.manifest.runtimes[0];
  const contributions = readInstalledExtensionPmpHostContributions(record);
  const magnet = contributions?.magnets ?? null;
  const variants =
    magnet?.variants?.map((variant) => ({
      id: variant.id,
      label: variant.label,
      description: variant.description ?? '',
    })) ?? [{ ...DEFAULT_VARIANT }];

  return normalizePluginMagnetCreatorDraft({
    pluginId: identity.id,
    publisher: identity.publisher,
    name: identity.name,
    displayName: identity.displayName ?? identity.name,
    version: identity.version,
    description: identity.description ?? '',
    runtimeId: runtime?.runtimeId ?? 'webview.main',
    runtimeEntry: runtime?.entry ?? 'index.js',
    ...readAnchorModeFromContribution(magnet),
    defaultVariant: magnet?.defaultVariant ?? variants[0]?.id ?? DEFAULT_VARIANT.id,
    variants,
    defaultStyleText: JSON.stringify(magnet?.defaultStyle ?? DEFAULT_STYLE, null, 2),
  });
}

export function buildPluginMagnetCreatorArtifacts(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): PluginMagnetCreatorArtifacts {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  const validation = validatePluginMagnetCreatorDraft(draft);
  const outputDraft = validation.issues.some((issue) => issue.code === 'defaultStyle.json')
    ? { ...draft, defaultStyleText: createDefaultStyleText() }
    : draft;
  return {
    draft,
    manifestPatch: buildPluginMagnetManifestPatch(outputDraft),
    minimalManifest: buildPluginMagnetMinimalManifest(outputDraft),
    runtimeTemplate: buildPluginMagnetRuntimeTemplate(draft),
    validation,
  };
}

export function getPluginMagnetCreatorDraftRevision(): number {
  return revision;
}

export function subscribePluginMagnetCreatorDraft(
  listener: PluginMagnetCreatorListener
): () => void {
  listeners.add(listener);
  void ensureSync();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      syncDisposer?.();
      syncDisposer = null;
    }
  };
}

export function readPluginMagnetCreatorDraft(): PluginMagnetCreatorDraft {
  if (typeof window === 'undefined') {
    return createDefaultPluginMagnetCreatorDraft();
  }
  const raw = readJson<unknown>(STORAGE_KEYS.PLUGIN_MAGNET_CREATOR_DRAFT_V1, null);
  return normalizePluginMagnetCreatorDraft(raw ?? createDefaultPluginMagnetCreatorDraft());
}

export function savePluginMagnetCreatorDraft(
  draftInput: Partial<PluginMagnetCreatorDraft> | unknown
): PluginMagnetCreatorDraft {
  const draft = normalizePluginMagnetCreatorDraft(draftInput);
  void broadcastDataUpdate(
    STORAGE_KEYS.PLUGIN_MAGNET_CREATOR_DRAFT_V1,
    draft,
    TAURI_EVENTS.PLUGIN_MAGNET_CREATOR_DRAFT_UPDATED
  );
  emitRevision();
  return draft;
}

export function resetPluginMagnetCreatorDraft(): PluginMagnetCreatorDraft {
  return savePluginMagnetCreatorDraft(createDefaultPluginMagnetCreatorDraft());
}
