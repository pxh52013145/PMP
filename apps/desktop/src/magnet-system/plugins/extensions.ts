import type {
  CapabilityRequirement,
  InstalledExtensionRecord,
  PluginInstallSourceDiagnostic,
  PluginReadInstallSourcePayload,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import { tryWriteJson, readJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastSignal,
} from '../../utils/windowCommunication';
import { PLUGIN_PERMISSIONS } from './host-api';
import { recordInstalledExtensionAuditEvent } from './extensionsGovernance';

const telemetry = getTelemetryLogger('extensions', 'extensions');

export type InstalledHostExtensionRecord = InstalledExtensionRecord<PxpManifestV2>;
export type InstalledExtensionCapabilityBinding = {
  capabilityId: string;
  granted: boolean;
  required: boolean;
};

type PluginStoreListener = () => void;

type ParsedExtensionInstallSource = {
  record: InstalledHostExtensionRecord;
  files: Array<{
    relativePath: string;
    bytes: Uint8Array;
    sha256?: string;
  }>;
  rootDir: string;
  manifestPath: string;
};

export type ParsedInstalledExtensionSource = Pick<
  ParsedExtensionInstallSource,
  'record' | 'rootDir' | 'manifestPath'
>;

type NativeInstalledExtensionInstallSource = PluginReadInstallSourcePayload<PxpManifestV2>;

function readCapabilityPermissionMap(): Record<string, string[]> {
  return {
    'core.capability-registry': [
      PLUGIN_PERMISSIONS.host,
      PLUGIN_PERMISSIONS.hostCapabilityInvoke,
    ],
    'host.pmp.audio-engine.playback': [
      PLUGIN_PERMISSIONS.audioState,
      PLUGIN_PERMISSIONS.audioControl,
      PLUGIN_PERMISSIONS.audioCover,
    ],
    'host.pmp.audio-engine.analysis': [PLUGIN_PERMISSIONS.audioVisual],
    'host.pmp.navigation': [PLUGIN_PERMISSIONS.navigation],
    'host.pmp.shell.window': [PLUGIN_PERMISSIONS.window],
    'host.pmp.storage.config': [PLUGIN_PERMISSIONS.configLocal],
    'host.pmp.storage.durable-text': [PLUGIN_PERMISSIONS.durableText],
    'host.pmp.connector-auth': [PLUGIN_PERMISSIONS.connectorAuth],
    'host.pmp.magnets.catalog': [PLUGIN_PERMISSIONS.magnetsCatalog],
    'host.pmp.magnets.layout': [PLUGIN_PERMISSIONS.magnetsLayout],
    'host.pmp.music-platform.catalog': [PLUGIN_PERMISSIONS.musicPlatformCatalog],
    'host.pmp.music-platform.search': [PLUGIN_PERMISSIONS.musicPlatformSearch],
    'host.pmp.music-platform.prepare': [PLUGIN_PERMISSIONS.musicPlatformPrepare],
  };
}

let extensionStoreRevision = 0;
const extensionStoreListeners = new Set<PluginStoreListener>();
let extensionStoreSyncDisposer: null | (() => void) = null;

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notifyExtensionStoreChanged(): void {
  extensionStoreRevision += 1;
  for (const listener of Array.from(extensionStoreListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('extension_store.listener.failed', {
        message: readErrorMessage(error),
      });
    }
  }
}

function ensureExtensionStoreCrossWindowSync(): void {
  if (typeof window === 'undefined') return;
  if (extensionStoreSyncDisposer) return;

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEYS.EXTENSIONS_V2) return;
    notifyExtensionStoreChanged();
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(
        TAURI_EVENTS.EXTENSIONS_V2_UPDATED,
        (payload) => {
          if (payload?.key && payload.key !== STORAGE_KEYS.EXTENSIONS_V2) return;
          notifyExtensionStoreChanged();
        }
      )
    )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // ignore
    });

  extensionStoreSyncDisposer = () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
    extensionStoreSyncDisposer = null;
  };
}

function normalizeNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function expectStringArray(value: unknown, label: string): string[] {
  if (typeof value === 'undefined') return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => normalizeNonEmptyString(entry, `${label}[${index}]`));
}

function normalizeManifestRelativePath(value: string, label: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new Error(`${label} is required`);
  }

  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) {
    throw new Error(`${label} must be relative`);
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains invalid segments`);
  }

  return normalized;
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizeInstalledExtensionInstallPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error('Extension manifest path is required');
  }

  if (trimmed.startsWith('file://')) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'file:') {
        const decoded = decodeURIComponent(url.pathname);
        const windowsDrivePath =
          /^\/[a-zA-Z]:/.test(decoded) || /^\/\//.test(decoded) ? decoded.slice(1) : decoded;
        return normalizeFsPath(windowsDrivePath);
      }
    } catch {
      // Fall back to the raw path when URL parsing fails.
    }
  }

  if (trimmed.startsWith('\\\\?\\')) {
    return normalizeFsPath(trimmed.slice(4));
  }

  return normalizeFsPath(trimmed);
}

function trimPathSegments(value: string, count: number): string | null {
  let next = normalizeFsPath(value);
  for (let i = 0; i < count; i += 1) {
    const lastSlash = next.lastIndexOf('/');
    if (lastSlash < 0) return null;
    next = next.slice(0, lastSlash);
  }
  return next.length > 0 ? next : null;
}

function validateCapabilityRequirements(
  value: unknown,
  label: string
): CapabilityRequirement[] | undefined {
  if (typeof value === 'undefined') return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  return value.map((entry, index) => {
    const object = expectObject(entry, `${label}[${index}]`);
    return {
      capabilityId: normalizeNonEmptyString(
        object.capabilityId,
        `${label}[${index}].capabilityId`
      ),
      versionRange:
        typeof object.versionRange === 'string' && object.versionRange.trim().length > 0
          ? object.versionRange.trim()
          : undefined,
      reasons: Array.isArray(object.reasons)
        ? object.reasons
            .filter((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0)
            .map((reason) => reason.trim())
        : undefined,
    };
  });
}

function validateInstalledContributionArray(
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
    const id = normalizeNonEmptyString(record.id, `${label}[].id`);
    if (!/^[a-z0-9-]{1,48}$/.test(id)) {
      throw new Error(`${label}[].id must match /^[a-z0-9-]{1,48}$/`);
    }
    if (ids.has(id)) {
      throw new Error(`${label}[].id duplicated: "${id}"`);
    }
    ids.add(id);

    normalizeNonEmptyString(record.title, `${label}["${id}"].title`);
    if (typeof record.description !== 'undefined') {
      normalizeNonEmptyString(record.description, `${label}["${id}"].description`);
    }
    if (typeof record.group !== 'undefined') {
      normalizeNonEmptyString(record.group, `${label}["${id}"].group`);
    }
    if (
      typeof record.order !== 'undefined' &&
      (typeof record.order !== 'number' || !Number.isFinite(record.order))
    ) {
      throw new Error(`${label}["${id}"].order must be a number`);
    }
    if (typeof record.tags !== 'undefined') {
      expectStringArray(record.tags, `${label}["${id}"].tags`);
    }
    if (typeof record.metadata !== 'undefined') {
      expectObject(record.metadata, `${label}["${id}"].metadata`);
    }

    if (options.validateDimensions) {
      if (
        typeof record.width !== 'undefined' &&
        (typeof record.width !== 'number' || !Number.isFinite(record.width) || record.width <= 0)
      ) {
        throw new Error(`${label}["${id}"].width must be a positive number`);
      }
      if (
        typeof record.height !== 'undefined' &&
        (typeof record.height !== 'number' || !Number.isFinite(record.height) || record.height <= 0)
      ) {
        throw new Error(`${label}["${id}"].height must be a positive number`);
      }
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
      expectStringArray(record.inputs, `${label}["${id}"].inputs`);
    }
  }
}

function validateInstalledExtensionPmpHostMagnetDescriptor(
  value: unknown,
  label: string
): void {
  if (typeof value === 'undefined') return;

  const magnet = expectObject(value, label);
  if (typeof magnet.defaultAnchor !== 'undefined') {
    const anchor = expectObject(magnet.defaultAnchor, `${label}.defaultAnchor`);
    if (
      typeof anchor.type !== 'undefined' &&
      anchor.type !== 'single' &&
      anchor.type !== 'range'
    ) {
      throw new Error(`${label}.defaultAnchor.type must be "single" or "range"`);
    }

    if (typeof anchor.coordinates !== 'undefined') {
      if (!Array.isArray(anchor.coordinates)) {
        throw new Error(`${label}.defaultAnchor.coordinates must be an array`);
      }

      for (const item of anchor.coordinates) {
        const coordinate = expectObject(item, `${label}.defaultAnchor.coordinates`);
        if (
          typeof coordinate.x !== 'number' ||
          !Number.isFinite(coordinate.x) ||
          typeof coordinate.y !== 'number' ||
          !Number.isFinite(coordinate.y)
        ) {
          throw new Error(
            `${label}.defaultAnchor.coordinates must be an array of {x:number,y:number}`
          );
        }
      }
    }
  }

  if (typeof magnet.defaultStyle !== 'undefined') {
    expectObject(magnet.defaultStyle, `${label}.defaultStyle`);
  }

  const variantIds = new Set<string>();
  if (typeof magnet.defaultVariant !== 'undefined') {
    const defaultVariant = normalizeNonEmptyString(
      magnet.defaultVariant,
      `${label}.defaultVariant`
    );
    if (!/^[a-z0-9-]{1,48}$/.test(defaultVariant)) {
      throw new Error(`${label}.defaultVariant must match /^[a-z0-9-]{1,48}$/`);
    }
  }

  if (typeof magnet.variants !== 'undefined') {
    if (!Array.isArray(magnet.variants)) {
      throw new Error(`${label}.variants must be an array`);
    }

    for (const item of magnet.variants) {
      const variant = expectObject(item, `${label}.variants`);
      const variantId = normalizeNonEmptyString(variant.id, `${label}.variants[].id`);
      if (!/^[a-z0-9-]{1,48}$/.test(variantId)) {
        throw new Error(`${label}.variants[].id must match /^[a-z0-9-]{1,48}$/`);
      }
      if (variantIds.has(variantId)) {
        throw new Error(`${label}.variants[].id duplicated: "${variantId}"`);
      }
      variantIds.add(variantId);

      normalizeNonEmptyString(variant.label, `${label}.variants["${variantId}"].label`);
      if (typeof variant.description !== 'undefined') {
        normalizeNonEmptyString(
          variant.description,
          `${label}.variants["${variantId}"].description`
        );
      }
      if (typeof variant.metadata !== 'undefined') {
        expectObject(variant.metadata, `${label}.variants["${variantId}"].metadata`);
      }
    }

    if (
      typeof magnet.defaultVariant === 'string' &&
      magnet.defaultVariant.trim().length > 0 &&
      !variantIds.has(magnet.defaultVariant.trim())
    ) {
      throw new Error(`${label}.defaultVariant must exist in ${label}.variants`);
    }
  }
}

function validateInstalledExtensionHostContributions(value: unknown, label: string): void {
  if (typeof value === 'undefined') return;

  const host = expectObject(value, label);
  if (typeof host.pmp === 'undefined') return;

  const pmp = expectObject(host.pmp, `${label}.pmp`);
  if (typeof pmp.pages !== 'undefined') {
    validateInstalledContributionArray(pmp.pages, `${label}.pmp.pages`);
  }
  if (typeof pmp.windows !== 'undefined') {
    validateInstalledContributionArray(pmp.windows, `${label}.pmp.windows`, {
      validateDimensions: true,
    });
  }
  if (typeof pmp.shellSurfaces !== 'undefined') {
    validateInstalledContributionArray(pmp.shellSurfaces, `${label}.pmp.shellSurfaces`, {
      validateDimensions: true,
      validateShellSurface: true,
    });
  }
  if (typeof pmp.settingsPanels !== 'undefined') {
    validateInstalledContributionArray(pmp.settingsPanels, `${label}.pmp.settingsPanels`);
  }
  if (typeof pmp.visualizers !== 'undefined') {
    validateInstalledContributionArray(pmp.visualizers, `${label}.pmp.visualizers`, {
      validateInputs: true,
    });
  }
  validateInstalledExtensionPmpHostMagnetDescriptor(pmp.magnets, `${label}.pmp.magnets`);
}

export function validateInstalledExtensionManifest(manifest: unknown): asserts manifest is PxpManifestV2 {
  const object = expectObject(manifest, 'manifest');
  if (object.schemaVersion !== '2.0') {
    throw new Error('manifest.schemaVersion must be "2.0"');
  }
  if (object.kind !== 'extension') {
    throw new Error('manifest.kind must be "extension"');
  }

  const identity = expectObject(object.identity, 'manifest.identity');
  normalizeNonEmptyString(identity.id, 'manifest.identity.id');
  normalizeNonEmptyString(identity.publisher, 'manifest.identity.publisher');
  normalizeNonEmptyString(identity.version, 'manifest.identity.version');
  normalizeNonEmptyString(identity.name, 'manifest.identity.name');

  if (!Array.isArray(object.hostTargets) || object.hostTargets.length === 0) {
    throw new Error('manifest.hostTargets must be a non-empty array');
  }
  object.hostTargets.forEach((entry, index) => {
    const target = expectObject(entry, `manifest.hostTargets[${index}]`);
    normalizeNonEmptyString(target.hostId, `manifest.hostTargets[${index}].hostId`);
  });

  if (!Array.isArray(object.runtimes) || object.runtimes.length === 0) {
    throw new Error('manifest.runtimes must be a non-empty array');
  }
  object.runtimes.forEach((entry, index) => {
    const runtime = expectObject(entry, `manifest.runtimes[${index}]`);
    normalizeNonEmptyString(runtime.runtimeId, `manifest.runtimes[${index}].runtimeId`);
    const kind = normalizeNonEmptyString(runtime.kind, `manifest.runtimes[${index}].kind`);
    if (!['extension-host', 'webview', 'sidecar'].includes(kind)) {
      throw new Error(
        `manifest.runtimes[${index}].kind must be one of extension-host, webview, sidecar`
      );
    }
    normalizeManifestRelativePath(
      normalizeNonEmptyString(runtime.entry, `manifest.runtimes[${index}].entry`),
      `manifest.runtimes[${index}].entry`
    );
    expectStringArray(runtime.platform, `manifest.runtimes[${index}].platform`);
    expectStringArray(runtime.arch, `manifest.runtimes[${index}].arch`);
  });

  validateCapabilityRequirements(object.requiresCapabilities, 'manifest.requiresCapabilities');
  validateCapabilityRequirements(object.optionalCapabilities, 'manifest.optionalCapabilities');
  if (typeof object.contributes !== 'undefined') {
    const contributes = expectObject(object.contributes, 'manifest.contributes');
    validateInstalledExtensionHostContributions(contributes.host, 'manifest.contributes.host');
  }
}

function listDeclaredCapabilityIds(record: InstalledHostExtensionRecord): string[] {
  return listInstalledExtensionCapabilityBindings(record)
    .filter((binding) => binding.granted)
    .map((binding) => binding.capabilityId);
}

export function listInstalledExtensionCapabilityBindings(
  record: InstalledHostExtensionRecord
): InstalledExtensionCapabilityBinding[] {
  const denied = new Set(record.deniedCapabilities ?? []);
  const bindings = new Map<string, InstalledExtensionCapabilityBinding>();

  const collect = (requirements: CapabilityRequirement[] | undefined, required: boolean) => {
    for (const requirement of requirements ?? []) {
      const existing = bindings.get(requirement.capabilityId);
      if (existing) {
        if (required && !existing.required) {
          existing.required = true;
        }
        continue;
      }

      bindings.set(requirement.capabilityId, {
        capabilityId: requirement.capabilityId,
        granted: !denied.has(requirement.capabilityId),
        required,
      });
    }
  };

  collect(record.manifest.requiresCapabilities, true);
  collect(record.manifest.optionalCapabilities, false);
  return Array.from(bindings.values());
}

export function listInstalledExtensionDeniedRequiredCapabilities(
  record: InstalledHostExtensionRecord
): string[] {
  return listInstalledExtensionCapabilityBindings(record)
    .filter((binding) => binding.required && !binding.granted)
    .map((binding) => binding.capabilityId);
}

export function listInstalledExtensionEffectiveCapabilityIds(
  record: InstalledHostExtensionRecord
): string[] {
  return listDeclaredCapabilityIds(record);
}

export function listInstalledExtensionDerivedPermissions(
  record: InstalledHostExtensionRecord
): string[] {
  const permissions = new Set<string>();
  const capabilityPermissionMap = readCapabilityPermissionMap();
  for (const capabilityId of listDeclaredCapabilityIds(record)) {
    for (const permission of capabilityPermissionMap[capabilityId] ?? []) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions.values()).sort((left, right) => left.localeCompare(right));
}

function collectResolvedArtifactCleanupTargets(
  record: Pick<InstalledHostExtensionRecord, 'manifest' | 'resolvedArtifacts'>
): Array<{ kind: 'dir'; path: string }> {
  const seen = new Set<string>();
  const targets: Array<{ kind: 'dir'; path: string }> = [];

  for (const artifact of record.resolvedArtifacts ?? []) {
    if (typeof artifact?.path !== 'string' || artifact.path.length === 0) continue;
    const runtime = record.manifest.runtimes.find((entry) => entry.runtimeId === artifact.runtimeId);
    if (!runtime) continue;
    const entrySegments = normalizeManifestRelativePath(
      runtime.entry,
      `manifest.runtimes(${runtime.runtimeId}).entry`
    )
      .split('/')
      .filter((segment) => segment.length > 0);
    const root = trimPathSegments(artifact.path, entrySegments.length);
    if (!root) continue;
    if (seen.has(root)) continue;
    seen.add(root);
    targets.push({ kind: 'dir', path: root });
  }

  return targets;
}

function saveInstalledExtensions(records: InstalledHostExtensionRecord[]): boolean {
  if (typeof window === 'undefined') return false;
  const ok = tryWriteJson(STORAGE_KEYS.EXTENSIONS_V2, records);
  if (!ok) return false;
  notifyExtensionStoreChanged();
  void broadcastSignal(TAURI_EVENTS.EXTENSIONS_V2_UPDATED);
  return true;
}

async function sha256Hex(data: Uint8Array): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    return undefined;
  }

  const arrayBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(arrayBuffer).set(data);
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeSha256Hex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function readNativeValidationError(
  diagnostics: PluginInstallSourceDiagnostic[] | undefined
): string | null {
  if (!Array.isArray(diagnostics)) return null;
  const diagnostic =
    diagnostics.find((entry) => entry?.severity === 'error') ??
    diagnostics.find((entry) => typeof entry?.message === 'string');
  return typeof diagnostic?.message === 'string' && diagnostic.message.trim().length > 0
    ? diagnostic.message.trim()
    : null;
}

async function computeTreeDigest(
  files: Array<{ relativePath: string; bytes: Uint8Array }>
): Promise<string | undefined> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (const file of [...files].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    const header = new TextEncoder().encode(`${file.relativePath}\u0000`);
    const footer = new Uint8Array([0]);
    chunks.push(header, file.bytes, footer);
    totalLength += header.byteLength + file.bytes.byteLength + footer.byteLength;
  }

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return await sha256Hex(merged);
}

function normalizeNativeInstallSourceFiles(
  files: NativeInstalledExtensionInstallSource['files']
): Array<{ relativePath: string; bytes: Uint8Array; sha256?: string }> {
  return files.map((file, index) => {
    const relativePath = normalizeManifestRelativePath(
      typeof file?.relativePath === 'string' ? file.relativePath : '',
      `extension files[${index}].relativePath`
    );

    if (!Array.isArray(file?.bytes)) {
      throw new Error(`extension files[${index}].bytes must be an array`);
    }

    return {
      relativePath,
      bytes: Uint8Array.from(file.bytes),
      sha256: normalizeSha256Hex(file.sha256),
    };
  });
}

async function readInstalledExtensionInstallSourceFromNative(
  filePath: string
): Promise<NativeInstalledExtensionInstallSource> {
  return await invokeWithTelemetry<NativeInstalledExtensionInstallSource>(
    'plugin_read_install_source',
    {
      filePath,
    },
    {
      moduleId: 'extensions',
      component: 'installSource',
      event: 'plugin.install_source.read',
    }
  );
}

async function parseInstalledExtensionInstallSourceFromFilePath(
  filePath: string
): Promise<ParsedExtensionInstallSource> {
  if (!isTauriRuntime()) {
    throw new Error('Installing manifest-v2 extensions requires the Tauri desktop runtime');
  }

  const normalizedPath = normalizeInstalledExtensionInstallPath(filePath);
  const installSource = await readInstalledExtensionInstallSourceFromNative(normalizedPath);
  const manifestPath = normalizeFsPath(installSource.manifestPath);
  const rootDir = normalizeFsPath(installSource.rootDir);
  const nativeValidationError = readNativeValidationError(installSource.validationDiagnostics);
  let manifestUnknown: PxpManifestV2;
  if (installSource.validatedManifest) {
    manifestUnknown = installSource.validatedManifest;
  } else {
    if (nativeValidationError) {
      throw new Error(nativeValidationError);
    }
    const manifestRaw = installSource.manifestRaw;
    const parsedManifest = JSON.parse(manifestRaw) as unknown;
    validateInstalledExtensionManifest(parsedManifest);
    manifestUnknown = parsedManifest;
  }

  const files = normalizeNativeInstallSourceFiles(installSource.files);
  const fileMap = new Map(files.map((file) => [file.relativePath, file.bytes] as const));

  for (const runtime of manifestUnknown.runtimes) {
    const entry = normalizeManifestRelativePath(
      runtime.entry,
      `manifest.runtimes(${runtime.runtimeId}).entry`
    );
    if (!fileMap.has(entry)) {
      throw new Error(`Runtime entry is missing from extension root: ${entry}`);
    }
  }

  const packageDigest =
    normalizeSha256Hex(installSource.packageDigest) ?? (await computeTreeDigest(files));
  return {
    record: {
      manifest: manifestUnknown,
      installedAt: Date.now(),
      packageDigest,
      enabled: true,
    },
    files,
    rootDir,
    manifestPath,
  };
}

async function persistInstalledExtensionArtifacts(
  record: InstalledHostExtensionRecord,
  files: Array<{ relativePath: string; bytes: Uint8Array; sha256?: string }>
): Promise<InstalledHostExtensionRecord['resolvedArtifacts']> {
  if (!isTauriRuntime()) {
    throw new Error('Installing manifest-v2 extensions requires the Tauri desktop runtime');
  }

  const [fs, pathApi] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);

  const rootRelative = `pmp-durable/extensions-v2/${record.manifest.identity.id}/${record.packageDigest ?? 'current'}`;

  await fs.createDir(rootRelative, {
    dir: fs.BaseDirectory.AppData,
    recursive: true,
  });

  for (const file of files) {
    const relativeFilePath = `${rootRelative}/${file.relativePath}`;
    const dirPath = relativeFilePath.slice(0, Math.max(0, relativeFilePath.lastIndexOf('/')));
    if (dirPath.length > 0) {
      await fs.createDir(dirPath, {
        dir: fs.BaseDirectory.AppData,
        recursive: true,
      });
    }
    await fs.writeBinaryFile(
      {
        path: relativeFilePath,
        contents: file.bytes,
      },
      { dir: fs.BaseDirectory.AppData }
    );
  }

  const fileMap = new Map(files.map((file) => [file.relativePath, file.bytes] as const));
  const fileDigestMap = new Map(
    files
      .map((file) => [file.relativePath, normalizeSha256Hex(file.sha256)] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
  );
  const resolvedArtifacts: NonNullable<InstalledHostExtensionRecord['resolvedArtifacts']> = [];

  for (const runtime of record.manifest.runtimes) {
    const entry = normalizeManifestRelativePath(runtime.entry, `manifest.runtimes(${runtime.runtimeId}).entry`);
    const absolutePath = await pathApi.join(
      await pathApi.appDataDir(),
      ...`${rootRelative}/${entry}`.split('/').filter((segment) => segment.length > 0)
    );
    resolvedArtifacts.push({
      runtimeId: runtime.runtimeId,
      path: absolutePath,
      sha256:
        fileDigestMap.get(entry) ?? (await sha256Hex(fileMap.get(entry) ?? new Uint8Array())),
    });
  }

  return resolvedArtifacts;
}

async function removeInstalledExtensionArtifacts(
  record: Pick<InstalledHostExtensionRecord, 'manifest' | 'resolvedArtifacts'> | null | undefined,
  keepTargets: ReadonlySet<string> = new Set()
): Promise<void> {
  if (!record?.resolvedArtifacts || record.resolvedArtifacts.length === 0 || !isTauriRuntime()) {
    return;
  }

  try {
    const fs = await import('@tauri-apps/api/fs');
    for (const target of collectResolvedArtifactCleanupTargets(record)) {
      const normalized = normalizeFsPath(target.path);
      if (keepTargets.has(normalized)) continue;
      try {
        await fs.removeDir(target.path, { recursive: true });
      } catch {
        // best effort
      }
    }
  } catch {
    // ignore cleanup errors
  }
}

export function getInstalledExtensionsRevision(): number {
  return extensionStoreRevision;
}

export function subscribeInstalledExtensions(listener: PluginStoreListener): () => void {
  extensionStoreListeners.add(listener);
  ensureExtensionStoreCrossWindowSync();

  return () => {
    extensionStoreListeners.delete(listener);
    if (extensionStoreListeners.size === 0) {
      extensionStoreSyncDisposer?.();
    }
  };
}

export function loadInstalledExtensions(): InstalledHostExtensionRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.EXTENSIONS_V2, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as InstalledHostExtensionRecord[];
  } catch {
    return [];
  }
}

export function getInstalledExtensionRecord(id: string): InstalledHostExtensionRecord | null {
  return loadInstalledExtensions().find((record) => record.manifest.identity.id === id) ?? null;
}

export function upsertInstalledExtensionRecord(record: InstalledHostExtensionRecord): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((entry) => entry.manifest.identity.id === record.manifest.identity.id);
  if (index >= 0) {
    records.splice(index, 1, record);
  } else {
    records.push(record);
  }
  saveInstalledExtensions(records);
}

export async function parseInstalledExtensionFromFilePath(
  filePath: string
): Promise<InstalledHostExtensionRecord> {
  const parsed = await parseInstalledExtensionInstallSourceFromFilePath(filePath);
  return parsed.record;
}

export async function parseInstalledExtensionSourceFromFilePath(
  filePath: string
): Promise<ParsedInstalledExtensionSource> {
  const parsed = await parseInstalledExtensionInstallSourceFromFilePath(filePath);
  return {
    record: parsed.record,
    rootDir: parsed.rootDir,
    manifestPath: parsed.manifestPath,
  };
}

export async function installInstalledExtensionFromFilePath(
  filePath: string,
  options: { defaultEnabled?: boolean } = {}
): Promise<InstalledHostExtensionRecord> {
  const parsed = await parseInstalledExtensionInstallSourceFromFilePath(filePath);
  const existing = getInstalledExtensionRecord(parsed.record.manifest.identity.id);

  const merged: InstalledHostExtensionRecord = existing
    ? {
        ...parsed.record,
        enabled: existing.enabled,
        disabledReason: existing.disabledReason,
        deniedCapabilities: existing.deniedCapabilities,
      }
    : options.defaultEnabled === false
      ? { ...parsed.record, enabled: false, disabledReason: 'manual' }
      : parsed.record;

  const resolvedArtifacts = await persistInstalledExtensionArtifacts(merged, parsed.files);
  const persisted: InstalledHostExtensionRecord = {
    ...merged,
    resolvedArtifacts,
  };

  upsertInstalledExtensionRecord(persisted);
  if (existing) {
    const { requestInstalledExtensionRuntimeRestart } = await import(
      './hostExtensionRuntimeSupervisor'
    );
    requestInstalledExtensionRuntimeRestart(persisted.manifest.identity.id, {
      reason: 'install-update',
    });
  }
  try {
    recordInstalledExtensionAuditEvent({
      type: 'installed',
      pluginId: persisted.manifest.identity.id,
      version: persisted.manifest.identity.version,
      publisher: persisted.manifest.identity.publisher,
      updated: Boolean(existing),
    });
  } catch {
    // ignore
  }
  await removeInstalledExtensionArtifacts(
    existing,
    new Set(
      collectResolvedArtifactCleanupTargets(persisted).map((target) => normalizeFsPath(target.path))
    )
  );
  return persisted;
}

export function uninstallInstalledExtension(id: string): void {
  const records = loadInstalledExtensions();
  const existing = records.find((record) => record.manifest.identity.id === id) ?? null;
  saveInstalledExtensions(records.filter((record) => record.manifest.identity.id !== id));
  if (existing) {
    try {
      recordInstalledExtensionAuditEvent({
        type: 'uninstalled',
        pluginId: id,
      });
    } catch {
      // ignore
    }
  }
  void removeInstalledExtensionArtifacts(existing);
}

export function setInstalledExtensionEnabled(id: string, enabled: boolean): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const previous = records[index];
  const nextEnabled = Boolean(enabled);
  const previousEnabled = previous.enabled ?? true;
  if (nextEnabled && previous.disabledReason === 'quarantine') return;
  if (nextEnabled === previousEnabled) return;

  records[index] = nextEnabled
    ? { ...previous, enabled: true, disabledReason: undefined }
    : { ...previous, enabled: false, disabledReason: 'manual' };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: nextEnabled ? 'enabled' : 'disabled',
      pluginId: id,
      reason: nextEnabled ? undefined : 'manual',
    });
  } catch {
    // ignore
  }
}

export function disableInstalledExtensionByPolicy(id: string, message: string): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const now = Date.now();
  const details = String(message).slice(0, 2000);
  records[index] = {
    ...records[index],
    enabled: false,
    disabledReason: 'policy',
    lastError: `[policy] ${details}`,
    lastErrorAt: now,
  };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: 'disabled',
      pluginId: id,
      reason: details,
    });
  } catch {
    // ignore
  }
}

export function quarantineInstalledExtension(
  id: string,
  options: {
    message: string;
    surface?: string;
    timeoutMs?: number;
  }
): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const existing = records[index];
  if (existing.enabled === false && existing.disabledReason === 'policy') {
    return;
  }

  const now = Date.now();
  const message = readErrorMessage(options.message).slice(0, 2000);

  records[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'quarantine',
    lastError: `[quarantine] ${message}`,
    lastErrorAt: now,
  };

  saveInstalledExtensions(records);
  try {
    if (typeof options.timeoutMs === 'number') {
      recordInstalledExtensionAuditEvent({
        type: 'runtime-unresponsive',
        pluginId: id,
        surface: options.surface ?? 'command',
        timeoutMs: options.timeoutMs,
      });
    }
    recordInstalledExtensionAuditEvent({
      type: 'quarantined',
      pluginId: id,
      surface: options.surface ?? 'command',
      message,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    // ignore
  }
}

export function clearInstalledExtensionQuarantine(id: string, reason = 'manual'): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const existing = records[index];
  if (existing.disabledReason !== 'quarantine') return;

  records[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'manual',
  };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: 'quarantine-cleared',
      pluginId: id,
      reason,
    });
  } catch {
    // ignore
  }
}

function normalizeCapabilityList(
  record: InstalledHostExtensionRecord,
  denied: string[]
): string[] {
  const declaredCapabilities = new Set(
    listInstalledExtensionCapabilityBindings(record).map((binding) => binding.capabilityId)
  );
  return Array.from(
    new Set(
      denied
        .filter((capabilityId): capabilityId is string => typeof capabilityId === 'string')
        .map((capabilityId) => capabilityId.trim())
        .filter((capabilityId) => capabilityId.length > 0 && declaredCapabilities.has(capabilityId))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function isSameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function setInstalledExtensionDeniedCapabilities(id: string, denied: string[]): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const previous = records[index];
  const nextDenied = normalizeCapabilityList(previous, denied);
  const previousDenied = normalizeCapabilityList(previous, previous.deniedCapabilities ?? []);

  if (isSameStringList(previousDenied, nextDenied)) return;

  records[index] = {
    ...previous,
    deniedCapabilities: nextDenied.length > 0 ? nextDenied : undefined,
  };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: 'capabilities-updated',
      pluginId: id,
      deniedCapabilities: nextDenied,
    });
  } catch {
    // ignore
  }
}

export function clearInstalledExtensionLastError(id: string): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const existing = records[index];
  if (!existing.lastError && typeof existing.lastErrorAt === 'undefined') return;

  records[index] = {
    ...existing,
    lastError: undefined,
    lastErrorAt: undefined,
  };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: 'errors-cleared',
      pluginId: id,
    });
  } catch {
    // ignore
  }
}

export function recordInstalledExtensionCrash(
  id: string,
  error: unknown,
  surface = 'command'
): void {
  const records = loadInstalledExtensions();
  const index = records.findIndex((record) => record.manifest.identity.id === id);
  if (index < 0) return;

  const existing = records[index];
  if (
    existing.enabled === false &&
    (existing.disabledReason === 'policy' || existing.disabledReason === 'quarantine')
  ) {
    return;
  }

  const message = readErrorMessage(error).slice(0, 2000);
  records[index] = {
    ...existing,
    enabled: false,
    disabledReason: 'crash',
    lastError: message,
    lastErrorAt: Date.now(),
  };

  saveInstalledExtensions(records);
  try {
    recordInstalledExtensionAuditEvent({
      type: 'crash',
      pluginId: id,
      surface,
      message,
    });
  } catch {
    // ignore
  }
}
