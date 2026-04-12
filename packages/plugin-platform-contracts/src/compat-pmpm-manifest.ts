import type {
  CommandContributionDescriptor,
  PageContributionDescriptor,
  ShellSurfaceContributionDescriptor,
  SettingsPanelContributionDescriptor,
  VisualizerContributionDescriptor,
  WindowContributionDescriptor,
} from './contributions';
import type {
  InstalledExtensionRecord,
  PxpManifestV2,
  RuntimeEntryDescriptor,
} from './core';
import type {
  ExtensionDefaultAnchorDescriptor,
  ExtensionManifestCore,
  ExtensionVariantDescriptor,
} from './manifest';
import type { NativeAdapterDescriptor } from './nativeAdapter';
import { createNativeSidecarAdapterDescriptor } from './nativeAdapter';
import type { PmpHostManifestContributionDescriptor } from './host';
import {
  PMPM_COMPAT_LAYER_ID,
  PMPM_DEFAULT_BRIDGE_ID,
  PMPM_DEFAULT_RUNTIME_ID,
  PMPM_DEFAULT_SIDECAR_BRIDGE_ID,
  PMPM_MANIFEST_FORMAT_VERSION,
  PMPM_MANIFEST_TYPE,
  mapPmpmPermissionToCapabilityId,
  mapPmpmPermissionToCapabilityRequirement,
} from './compat-pmpm';
import type { CapabilityRequirement, DataPlaneKind } from './capabilities';

export type PmpmManifestContributionBuckets = {
  pages?: PageContributionDescriptor[];
  windows?: WindowContributionDescriptor[];
  shellSurfaces?: ShellSurfaceContributionDescriptor[];
  commands?: CommandContributionDescriptor[];
  settingsPanels?: SettingsPanelContributionDescriptor[];
  visualizers?: VisualizerContributionDescriptor[];
};

export interface PmpmRuntimeDescriptor {
  runtimeId?: string;
  kind?: 'extension-host' | 'webview' | 'sidecar';
  bridge?: string;
  adapter?: NativeAdapterDescriptor;
  sandbox?: 'strict' | 'host-supervised' | 'native';
  priority?: number;
  platform?: string[];
  arch?: string[];
  dataPlane?: {
    kinds: DataPlaneKind[];
  };
}

export interface PmpmManifest
  extends ExtensionManifestCore<'magnet-plugin', PmpmManifestContributionBuckets> {
  magnet?: {
    defaultAnchor?: ExtensionDefaultAnchorDescriptor;
    defaultStyle?: Record<string, unknown>;
    defaultVariant?: string;
    variants?: ExtensionVariantDescriptor[];
  };
  runtime?: PmpmRuntimeDescriptor;
}

export interface InstalledPmpmPluginRecord<TSignature = unknown> {
  manifest: PmpmManifest;
  entryCode?: string;
  installedAt: number;
  packageSha256?: string;
  manifestSha256?: string;
  entrySha256?: string;
  signature?: TSignature;
  enabled?: boolean;
  disabledReason?: 'manual' | 'crash' | 'policy' | 'quarantine';
  deniedPermissions?: string[];
  lastError?: string;
  lastErrorAt?: number;
  resolvedArtifacts?: InstalledExtensionRecord['resolvedArtifacts'];
}

export type PmpmPluginCrashSurface =
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'overlay'
  | 'desktop-widget'
  | 'command';

export interface ValidatePmpmManifestOptions {
  reservedIds?: Iterable<string>;
}

export interface ConvertPmpmManifestOptions {
  hostId?: 'pmp';
  publisher?: string;
  runtimeId?: string;
  runtimeKind?: 'extension-host' | 'webview' | 'sidecar';
  bridge?: string;
  activationEvents?: PxpManifestV2['activationEvents'];
  integrity?: PxpManifestV2['integrity'];
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectOptionalString(value: unknown, label: string): void {
  if (typeof value !== 'undefined' && typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function expectNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function expectOptionalFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'undefined' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must be a number`);
  }
}

function expectOptionalPositiveNumber(value: unknown, label: string): void {
  if (typeof value !== 'undefined') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be a positive number`);
    }
  }
}

function validateStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 1) {
      throw new Error(`${label} must be an array of strings`);
    }
  }
}

function normalizeRelativePackagePath(value: string, label: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be a relative package path`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} must not contain empty, "." or ".." path segments`);
  }

  return normalized;
}

function validateContributionArray(
  value: unknown,
  label: string,
  options: {
    validateDimensions?: boolean;
    validateInputs?: boolean;
    validateShellSurface?: boolean;
  } = {}
): void {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const ids = new Set<string>();
  for (const item of value) {
    const record = expectObject(item, `${label} entries`);
    const id = expectNonEmptyString(record.id, `${label}[].id`);
    if (!/^[a-z0-9-]{1,48}$/.test(id)) {
      throw new Error(`${label}[].id must match /^[a-z0-9-]{1,48}$/`);
    }
    if (ids.has(id)) {
      throw new Error(`${label}[].id duplicated: "${id}"`);
    }
    ids.add(id);

    expectNonEmptyString(record.title, `${label}["${id}"].title`);
    expectOptionalString(record.description, `${label}["${id}"].description`);
    expectOptionalString(record.group, `${label}["${id}"].group`);
    expectOptionalFiniteNumber(record.order, `${label}["${id}"].order`);

    if (typeof record.tags !== 'undefined') {
      validateStringArray(record.tags, `${label}["${id}"].tags`);
    }

    if (typeof record.metadata !== 'undefined') {
      expectObject(record.metadata, `${label}["${id}"].metadata`);
    }

    if (options.validateDimensions) {
      expectOptionalPositiveNumber(record.width, `${label}["${id}"].width`);
      expectOptionalPositiveNumber(record.height, `${label}["${id}"].height`);
    }

    if (options.validateShellSurface) {
      if (record.surfaceType !== 'overlay' && record.surfaceType !== 'desktop-widget') {
        throw new Error(
          `${label}["${id}"].surfaceType must be "overlay" or "desktop-widget"`
        );
      }
      if (
        typeof record.pointerPolicy !== 'undefined' &&
        record.pointerPolicy !== 'capture-input' &&
        record.pointerPolicy !== 'passthrough'
      ) {
        throw new Error(
          `${label}["${id}"].pointerPolicy must be "capture-input" or "passthrough"`
        );
      }
      if (
        typeof record.alwaysOnTop !== 'undefined' &&
        typeof record.alwaysOnTop !== 'boolean'
      ) {
        throw new Error(`${label}["${id}"].alwaysOnTop must be a boolean`);
      }
      if (
        typeof record.focusable !== 'undefined' &&
        typeof record.focusable !== 'boolean'
      ) {
        throw new Error(`${label}["${id}"].focusable must be a boolean`);
      }
      if (
        typeof record.dismissOnEscape !== 'undefined' &&
        typeof record.dismissOnEscape !== 'boolean'
      ) {
        throw new Error(`${label}["${id}"].dismissOnEscape must be a boolean`);
      }
    }

    if (options.validateInputs && typeof record.inputs !== 'undefined') {
      validateStringArray(record.inputs, `${label}["${id}"].inputs`);
    }
  }
}

function normalizePmpHostContributions(
  manifest: PmpmManifest
): PmpHostManifestContributionDescriptor {
  return {
    pages: manifest.contributions?.pages ? [...manifest.contributions.pages] : undefined,
    windows: manifest.contributions?.windows ? [...manifest.contributions.windows] : undefined,
    shellSurfaces: manifest.contributions?.shellSurfaces
      ? [...manifest.contributions.shellSurfaces]
      : undefined,
    settingsPanels: manifest.contributions?.settingsPanels
      ? [...manifest.contributions.settingsPanels]
      : undefined,
    visualizers: manifest.contributions?.visualizers
      ? [...manifest.contributions.visualizers]
      : undefined,
    magnets: manifest.magnet
      ? {
          defaultAnchor: manifest.magnet.defaultAnchor,
          defaultStyle: manifest.magnet.defaultStyle,
          defaultVariant: manifest.magnet.defaultVariant,
          variants: manifest.magnet.variants ? [...manifest.magnet.variants] : undefined,
        }
      : undefined,
  };
}

function normalizePmpmRuntimeDataPlaneKinds(
  value: unknown,
  label: string
): DataPlaneKind[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const normalized = value.map((item) => {
    if (
      item !== 'inline-json' &&
      item !== 'shared-memory' &&
      item !== 'pipe' &&
      item !== 'local-socket'
    ) {
      throw new Error(`${label} contains unsupported data plane kind`);
    }
    return item;
  });

  return normalized.length > 0 ? normalized : undefined;
}

function expectOptionalBoolean(value: unknown, label: string): void {
  if (typeof value !== 'undefined' && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function normalizeNativeAdapterLifecyclePhases(
  value: unknown,
  label: string
): string[] | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const normalized = value.map((item) => {
    if (
      item !== 'hello' &&
      item !== 'init' &&
      item !== 'activate' &&
      item !== 'health' &&
      item !== 'invoke' &&
      item !== 'revoke' &&
      item !== 'dispose'
    ) {
      throw new Error(`${label} contains unsupported lifecycle phase`);
    }
    return item;
  });

  return normalized.length > 0 ? normalized : undefined;
}

function normalizePmpmRuntimeAdapter(
  value: unknown,
  label: string
): NativeAdapterDescriptor | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const adapter = expectObject(value, label);
  if (adapter.kind !== 'native-sidecar.process') {
    throw new Error(`${label}.kind must be "native-sidecar.process"`);
  }
  if (adapter.protocol !== 'pxp.runtime.bridge.v1') {
    throw new Error(`${label}.protocol must be "pxp.runtime.bridge.v1"`);
  }

  if (typeof adapter.implementation !== 'undefined') {
    const implementation = expectObject(adapter.implementation, `${label}.implementation`);
    const language = expectNonEmptyString(
      implementation.language,
      `${label}.implementation.language`
    );
    if (
      language !== 'cpp' &&
      language !== 'qml' &&
      language !== 'rust' &&
      language !== 'csharp' &&
      language !== 'python' &&
      language !== 'go' &&
      language !== 'zig' &&
      language !== 'other'
    ) {
      throw new Error(`${label}.implementation.language is not supported`);
    }
    expectOptionalString(implementation.runtime, `${label}.implementation.runtime`);
    expectOptionalString(implementation.entry, `${label}.implementation.entry`);
    if (typeof implementation.metadata !== 'undefined') {
      expectObject(implementation.metadata, `${label}.implementation.metadata`);
    }
  }

  if (typeof adapter.trust !== 'undefined') {
    const trust = expectObject(adapter.trust, `${label}.trust`);
    if (
      typeof trust.minimumLevel !== 'undefined' &&
      trust.minimumLevel !== 'unsigned-allowed' &&
      trust.minimumLevel !== 'trusted' &&
      trust.minimumLevel !== 'verified'
    ) {
      throw new Error(
        `${label}.trust.minimumLevel must be "unsigned-allowed", "trusted" or "verified"`
      );
    }
    expectOptionalBoolean(trust.requiresDigest, `${label}.trust.requiresDigest`);
    expectOptionalBoolean(trust.requiresSignature, `${label}.trust.requiresSignature`);
  }

  if (typeof adapter.lifecycle !== 'undefined') {
    const lifecycle = expectObject(adapter.lifecycle, `${label}.lifecycle`);
    normalizeNativeAdapterLifecyclePhases(lifecycle.phases, `${label}.lifecycle.phases`);
    expectOptionalBoolean(
      lifecycle.quarantineOnTimeout,
      `${label}.lifecycle.quarantineOnTimeout`
    );
    expectOptionalBoolean(
      lifecycle.supportsGracefulShutdown,
      `${label}.lifecycle.supportsGracefulShutdown`
    );
  }

  if (typeof adapter.metadata !== 'undefined') {
    expectObject(adapter.metadata, `${label}.metadata`);
  }

  return adapter as unknown as NativeAdapterDescriptor;
}

function resolvePmpmRuntime(
  manifest: PmpmManifest,
  options: ConvertPmpmManifestOptions = {}
): RuntimeEntryDescriptor {
  const runtimeKind = options.runtimeKind ?? manifest.runtime?.kind ?? 'extension-host';
  const entry = normalizePmpmEntryPoint(manifest.entryPoint);
  const dataPlaneKinds: DataPlaneKind[] =
    manifest.runtime?.dataPlane?.kinds && manifest.runtime.dataPlane.kinds.length > 0
      ? [...manifest.runtime.dataPlane.kinds]
      : runtimeKind === 'sidecar'
        ? ['inline-json', 'pipe']
        : ['inline-json'];

  return {
    runtimeId: options.runtimeId ?? manifest.runtime?.runtimeId ?? PMPM_DEFAULT_RUNTIME_ID,
    kind: runtimeKind,
    entry,
    platform: manifest.runtime?.platform ? [...manifest.runtime.platform] : undefined,
    arch: manifest.runtime?.arch ? [...manifest.runtime.arch] : undefined,
    priority: manifest.runtime?.priority,
    sandbox:
      manifest.runtime?.sandbox ??
      (runtimeKind === 'webview'
        ? 'strict'
        : runtimeKind === 'sidecar'
          ? 'native'
          : 'host-supervised'),
    bridge:
      options.bridge ??
      manifest.runtime?.bridge ??
      (runtimeKind === 'sidecar' ? PMPM_DEFAULT_SIDECAR_BRIDGE_ID : PMPM_DEFAULT_BRIDGE_ID),
    adapter:
      manifest.runtime?.adapter ??
      (runtimeKind === 'sidecar' ? createNativeSidecarAdapterDescriptor() : undefined),
    provides: [PMPM_COMPAT_LAYER_ID],
    dataPlane: {
      kinds: dataPlaneKinds,
    },
  };
}

export function normalizePmpmEntryPoint(entryPoint: string): string {
  return normalizeRelativePackagePath(entryPoint, 'manifest.entryPoint');
}

function toInstallSignatureSummary(
  signature: unknown
): InstalledExtensionRecord['signature'] | undefined {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) {
    return undefined;
  }

  const record = signature as Record<string, unknown>;
  const verified =
    typeof record.verified === 'boolean'
      ? record.verified
      : typeof record.keyId === 'string'
        ? true
        : false;
  const keyId =
    typeof record.keyId === 'string' && record.keyId.length > 0 ? record.keyId : undefined;
  const summary =
    typeof record.summary === 'string' && record.summary.length > 0
      ? record.summary
      : undefined;

  if (!verified && !keyId && !summary) {
    return undefined;
  }

  return {
    verified,
    keyId,
    summary,
  };
}

export function validatePmpmManifest(
  manifest: unknown,
  options: ValidatePmpmManifestOptions = {}
): asserts manifest is PmpmManifest {
  const m = expectObject(manifest, 'manifest.json');

  if (m.formatVersion !== PMPM_MANIFEST_FORMAT_VERSION) {
    throw new Error(`manifest.formatVersion must be "${PMPM_MANIFEST_FORMAT_VERSION}"`);
  }
  if (m.type !== PMPM_MANIFEST_TYPE) {
    throw new Error(`manifest.type must be "${PMPM_MANIFEST_TYPE}"`);
  }

  expectOptionalString(m.apiVersion, 'manifest.apiVersion');

  const metadata = expectObject(m.metadata, 'manifest.metadata');
  const id = expectNonEmptyString(metadata.id, 'metadata.id');
  if (!/^[a-z0-9-]+$/.test(id)) {
    throw new Error('metadata.id must match /^[a-z0-9-]+$/');
  }
  const reservedIds = new Set(options.reservedIds ?? []);
  if (reservedIds.has(id)) {
    throw new Error(`metadata.id "${id}" conflicts with reserved ids`);
  }

  expectNonEmptyString(metadata.name, 'metadata.name');
  expectNonEmptyString(metadata.version, 'metadata.version');
  expectOptionalString(metadata.author, 'metadata.author');
  expectOptionalString(metadata.description, 'metadata.description');
  if (typeof metadata.tags !== 'undefined') {
    validateStringArray(metadata.tags, 'metadata.tags');
  }

  normalizePmpmEntryPoint(expectNonEmptyString(m.entryPoint, 'manifest.entryPoint'));

  if (typeof m.magnet !== 'undefined') {
    const magnet = expectObject(m.magnet, 'manifest.magnet');

    if (typeof magnet.defaultAnchor !== 'undefined') {
      const anchor = expectObject(magnet.defaultAnchor, 'manifest.magnet.defaultAnchor');
      const type = anchor.type;
      if (typeof type !== 'undefined' && type !== 'single' && type !== 'range') {
        throw new Error('manifest.magnet.defaultAnchor.type must be "single" or "range"');
      }
      if (typeof anchor.coordinates !== 'undefined') {
        if (!Array.isArray(anchor.coordinates)) {
          throw new Error('manifest.magnet.defaultAnchor.coordinates must be an array');
        }
        for (const item of anchor.coordinates) {
          const coordinate = expectObject(item, 'manifest.magnet.defaultAnchor.coordinates');
          if (
            typeof coordinate.x !== 'number' ||
            !Number.isFinite(coordinate.x) ||
            typeof coordinate.y !== 'number' ||
            !Number.isFinite(coordinate.y)
          ) {
            throw new Error(
              'manifest.magnet.defaultAnchor.coordinates must be an array of {x:number,y:number}'
            );
          }
        }
      }
    }

    if (typeof magnet.defaultStyle !== 'undefined') {
      expectObject(magnet.defaultStyle, 'manifest.magnet.defaultStyle');
    }

    if (typeof magnet.defaultVariant !== 'undefined') {
      const defaultVariant = expectNonEmptyString(
        magnet.defaultVariant,
        'manifest.magnet.defaultVariant'
      );
      if (!/^[a-z0-9-]{1,48}$/.test(defaultVariant)) {
        throw new Error('manifest.magnet.defaultVariant must match /^[a-z0-9-]{1,48}$/');
      }
    }

    if (typeof magnet.variants !== 'undefined') {
      if (!Array.isArray(magnet.variants)) {
        throw new Error('manifest.magnet.variants must be an array');
      }

      const ids = new Set<string>();
      for (const item of magnet.variants) {
        const variant = expectObject(item, 'manifest.magnet.variants');
        const variantId = expectNonEmptyString(variant.id, 'manifest.magnet.variants[].id');
        if (!/^[a-z0-9-]{1,48}$/.test(variantId)) {
          throw new Error('manifest.magnet.variants[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(variantId)) {
          throw new Error(`manifest.magnet.variants[].id duplicated: "${variantId}"`);
        }
        ids.add(variantId);
        expectNonEmptyString(variant.label, `manifest.magnet.variants["${variantId}"].label`);
        expectOptionalString(
          variant.description,
          `manifest.magnet.variants["${variantId}"].description`
        );
        if (typeof variant.metadata !== 'undefined') {
          expectObject(variant.metadata, `manifest.magnet.variants["${variantId}"].metadata`);
        }
      }

      if (
        typeof magnet.defaultVariant === 'string' &&
        magnet.defaultVariant.length > 0 &&
        !ids.has(magnet.defaultVariant)
      ) {
        throw new Error('manifest.magnet.defaultVariant must exist in manifest.magnet.variants');
      }
    }
  }

  if (typeof m.permissions !== 'undefined') {
    validateStringArray(m.permissions, 'manifest.permissions');
  }

  if (typeof m.runtime !== 'undefined') {
    const runtime = expectObject(m.runtime, 'manifest.runtime');

    if (
      typeof runtime.kind !== 'undefined' &&
      runtime.kind !== 'extension-host' &&
      runtime.kind !== 'webview' &&
      runtime.kind !== 'sidecar'
    ) {
      throw new Error('manifest.runtime.kind must be "extension-host", "webview" or "sidecar"');
    }

    if (typeof runtime.runtimeId !== 'undefined') {
      expectNonEmptyString(runtime.runtimeId, 'manifest.runtime.runtimeId');
    }

    expectOptionalString(runtime.bridge, 'manifest.runtime.bridge');
    expectOptionalFiniteNumber(runtime.priority, 'manifest.runtime.priority');

    if (
      typeof runtime.sandbox !== 'undefined' &&
      runtime.sandbox !== 'strict' &&
      runtime.sandbox !== 'host-supervised' &&
      runtime.sandbox !== 'native'
    ) {
      throw new Error(
        'manifest.runtime.sandbox must be "strict", "host-supervised" or "native"'
      );
    }

    if (typeof runtime.platform !== 'undefined') {
      validateStringArray(runtime.platform, 'manifest.runtime.platform');
    }

    if (typeof runtime.arch !== 'undefined') {
      validateStringArray(runtime.arch, 'manifest.runtime.arch');
    }

    if (typeof runtime.dataPlane !== 'undefined') {
      const dataPlane = expectObject(runtime.dataPlane, 'manifest.runtime.dataPlane');
      normalizePmpmRuntimeDataPlaneKinds(dataPlane.kinds, 'manifest.runtime.dataPlane.kinds');
    }

    if (typeof runtime.adapter !== 'undefined') {
      if ((runtime.kind ?? 'extension-host') !== 'sidecar') {
        throw new Error('manifest.runtime.adapter is only supported for sidecar runtimes');
      }
      normalizePmpmRuntimeAdapter(runtime.adapter, 'manifest.runtime.adapter');
    }
  }

  if (typeof m.contributions !== 'undefined') {
    const contributions = expectObject(m.contributions, 'manifest.contributions');

    if (typeof contributions.workbenches !== 'undefined') {
      throw new Error('manifest.contributions.workbenches is no longer supported');
    }

    if (typeof contributions.pages !== 'undefined') {
      validateContributionArray(contributions.pages, 'manifest.contributions.pages');
    }
    if (typeof contributions.windows !== 'undefined') {
      validateContributionArray(contributions.windows, 'manifest.contributions.windows', {
        validateDimensions: true,
      });
    }
    if (typeof contributions.shellSurfaces !== 'undefined') {
      validateContributionArray(
        contributions.shellSurfaces,
        'manifest.contributions.shellSurfaces',
        {
          validateDimensions: true,
          validateShellSurface: true,
        }
      );
    }
    if (typeof contributions.commands !== 'undefined') {
      validateContributionArray(contributions.commands, 'manifest.contributions.commands');
    }
    if (typeof contributions.settingsPanels !== 'undefined') {
      validateContributionArray(
        contributions.settingsPanels,
        'manifest.contributions.settingsPanels'
      );
    }
    if (typeof contributions.visualizers !== 'undefined') {
      validateContributionArray(contributions.visualizers, 'manifest.contributions.visualizers', {
        validateInputs: true,
      });
    }
  }
}

export function convertPmpmManifestToPxpManifestV2(
  manifest: PmpmManifest,
  options: ConvertPmpmManifestOptions = {}
): PxpManifestV2 {
  const requiresCapabilities = new Map<string, CapabilityRequirement>();
  for (const permission of manifest.permissions ?? []) {
    const requirement = mapPmpmPermissionToCapabilityRequirement(permission);
    if (!requiresCapabilities.has(requirement.capabilityId)) {
      requiresCapabilities.set(requirement.capabilityId, requirement);
    }
  }

  const coreCommands = manifest.contributions?.commands?.map((command) => ({
    kind: 'command' as const,
    id: command.id,
    title: command.title,
    description: command.description,
    metadata: command.metadata,
  }));

  return {
    schemaVersion: '2.0',
    kind: 'extension',
    identity: {
      id: manifest.metadata.id,
      publisher: options.publisher ?? PMPM_COMPAT_LAYER_ID,
      version: manifest.metadata.version,
      name: manifest.metadata.id,
      displayName: manifest.metadata.name,
      description: manifest.metadata.description,
      keywords: manifest.metadata.tags,
    },
    hostTargets: [
      {
        hostId: options.hostId ?? 'pmp',
        required: true,
      },
    ],
    runtimes: [resolvePmpmRuntime(manifest, options)],
    activationEvents: options.activationEvents ?? ['onStartup'],
    requiresCapabilities:
      requiresCapabilities.size > 0 ? Array.from(requiresCapabilities.values()) : undefined,
    contributes: {
      core: coreCommands && coreCommands.length > 0 ? { commands: coreCommands } : undefined,
      host: {
        pmp: normalizePmpHostContributions(manifest),
      },
    },
    integrity: options.integrity,
    compat: [
      {
        compatLayerId: PMPM_COMPAT_LAYER_ID,
        metadata: {
          formatVersion: manifest.formatVersion,
          legacyType: manifest.type,
          apiVersion: manifest.apiVersion,
        },
      },
    ],
  };
}

export function convertInstalledPmpmPluginToInstalledExtensionRecord<TSignature = unknown>(
  plugin: InstalledPmpmPluginRecord<TSignature>
): InstalledExtensionRecord<PxpManifestV2> {
  const manifest = convertPmpmManifestToPxpManifestV2(plugin.manifest, {
    integrity:
      plugin.manifestSha256 || plugin.entrySha256 || plugin.signature
        ? {
            manifestDigest: plugin.manifestSha256,
            artifactDigests: plugin.entrySha256
              ? [
                  {
                    path: normalizePmpmEntryPoint(plugin.manifest.entryPoint),
                    sha256: plugin.entrySha256,
                  },
                ]
              : undefined,
            signature: plugin.signature
              ? {
                  format: 'compat.pmpm.signature.v1',
                  path: 'signature.json',
                }
              : undefined,
          }
        : undefined,
  });

  const deniedCapabilities = Array.isArray(plugin.deniedPermissions)
    ? plugin.deniedPermissions.map((permission) => mapPmpmPermissionToCapabilityId(permission))
    : undefined;

  return {
    manifest,
    installedAt: plugin.installedAt,
    packageDigest: plugin.packageSha256,
    resolvedArtifacts:
      plugin.resolvedArtifacts && plugin.resolvedArtifacts.length > 0
        ? plugin.resolvedArtifacts.map((artifact) => ({
            runtimeId: artifact.runtimeId,
            path: artifact.path,
            sha256: artifact.sha256,
          }))
        : [
            {
              runtimeId: manifest.runtimes[0]?.runtimeId ?? PMPM_DEFAULT_RUNTIME_ID,
              path: normalizePmpmEntryPoint(plugin.manifest.entryPoint),
              sha256: plugin.entrySha256,
            },
          ],
    signature: toInstallSignatureSummary(plugin.signature),
    enabled: plugin.enabled ?? true,
    disabledReason: plugin.disabledReason,
    deniedCapabilities,
    lastError: plugin.lastError,
    lastErrorAt: plugin.lastErrorAt,
  };
}
