import React from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Magnet } from '../../types/pixel';
import type { MagnetRendererDefinition } from '../registry';
import { PluginMagnetHost } from './PluginMagnetHost';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import { readJson } from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';

export type PmpmManifest = {
  formatVersion: '1.0';
  type: 'magnet-plugin';
  metadata: {
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    tags?: string[];
  };
  entryPoint: string;
  magnet?: {
    defaultAnchor?: {
      type?: 'single' | 'range';
      coordinates?: Array<{ x: number; y: number }>;
    };
    defaultStyle?: Record<string, unknown>;
  };
  permissions?: string[];
};

export type InstalledPmpmPlugin = {
  manifest: PmpmManifest;
  entryCode: string;
  installedAt: number;
  packageSha256?: string;
  manifestSha256?: string;
  entrySha256?: string;
  enabled?: boolean;
  disabledReason?: 'manual' | 'crash';
  lastError?: string;
  lastErrorAt?: number;
};

export type PmpmPluginCrashSurface = 'magnet' | 'settings' | 'page' | 'visualizer' | 'window';

type PluginStoreListener = () => void;

let pluginStoreRevision = 0;
const pluginStoreListeners = new Set<PluginStoreListener>();
let pluginStoreSyncDisposer: null | (() => void) = null;

function notifyPluginStoreChanged(): void {
  pluginStoreRevision += 1;
  for (const listener of Array.from(pluginStoreListeners)) {
    try {
      listener();
    } catch (error) {
      console.warn('[pmpm] plugin store listener failed', error);
    }
  }
}

function ensurePluginStoreCrossWindowSync(): void {
  if (typeof window === 'undefined') return;
  if (pluginStoreSyncDisposer) return;

  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
    notifyPluginStoreChanged();
  };

  window.addEventListener('storage', onStorage);

  let disposed = false;
  let unlistenTauri: null | (() => void) = null;

  void import('../../utils/windowCommunication')
    .then(({ setupTauriListenerWithPayload }) =>
      setupTauriListenerWithPayload<{ key?: string }>(TAURI_EVENTS.PMPM_PLUGINS_UPDATED, (payload) => {
        if (payload?.key && payload.key !== STORAGE_KEYS.PMPM_PLUGINS) return;
        notifyPluginStoreChanged();
      })
    )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTauri = unlisten;
    })
    .catch(() => {
      // ignore (web runtime or tauri listener not available)
    });

  pluginStoreSyncDisposer = () => {
    disposed = true;
    window.removeEventListener('storage', onStorage);
    try {
      unlistenTauri?.();
    } catch {
      // ignore
    }
    pluginStoreSyncDisposer = null;
  };
}

export function getPmpmPluginsRevision(): number {
  return pluginStoreRevision;
}

export function subscribePmpmPlugins(listener: PluginStoreListener): () => void {
  pluginStoreListeners.add(listener);
  ensurePluginStoreCrossWindowSync();

  return () => {
    pluginStoreListeners.delete(listener);
    if (pluginStoreListeners.size === 0) {
      pluginStoreSyncDisposer?.();
    }
  };
}

export function getPmpmPluginEffectivePermissions(pluginId: string): Set<string> {
  const plugin = getInstalledPmpmPlugin(pluginId);
  if (!plugin || plugin.enabled === false) return new Set();
  return new Set(plugin.manifest.permissions ?? []);
}

export function recordPmpmPermissionDenied(options: {
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
}): void {
  console.warn(
    `[pmpm][permission] denied plugin=${options.pluginId} host=${options.hostLabel} capability=${options.capability} action=${options.action}`
  );
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validateManifest(manifest: unknown): asserts manifest is PmpmManifest {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json must be an object');
  }
  const m = manifest as Record<string, unknown>;
  if (m.formatVersion !== '1.0') throw new Error('manifest.formatVersion must be "1.0"');
  if (m.type !== 'magnet-plugin') throw new Error('manifest.type must be "magnet-plugin"');
  const metadata = m.metadata as Record<string, unknown> | undefined;
  if (!metadata) throw new Error('manifest.metadata is required');
  const id = metadata.id;
  if (typeof id !== 'string' || id.length < 3) throw new Error('metadata.id is required');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('metadata.id must match /^[a-z0-9-]+$/');
  const name = metadata.name;
  if (typeof name !== 'string' || name.length < 1) throw new Error('metadata.name is required');
  const version = metadata.version;
  if (typeof version !== 'string' || version.length < 1) throw new Error('metadata.version is required');
  const entryPoint = m.entryPoint;
  if (typeof entryPoint !== 'string' || entryPoint.length < 1) throw new Error('manifest.entryPoint is required');
  if (BUILTIN_MAGNET_IDS.has(id)) throw new Error(`metadata.id "${id}" conflicts with builtin magnets`);

  const permissions = m.permissions;
  if (typeof permissions !== 'undefined') {
    if (!Array.isArray(permissions)) throw new Error('manifest.permissions must be an array of strings');
    for (const perm of permissions) {
      if (typeof perm !== 'string' || perm.length < 1) {
        throw new Error('manifest.permissions must be an array of strings');
      }
    }
  }
}

export function loadInstalledPmpmPlugins(): InstalledPmpmPlugin[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = readJson<unknown>(STORAGE_KEYS.PMPM_PLUGINS, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as InstalledPmpmPlugin[];
  } catch {
    return [];
  }
}

function saveInstalledPmpmPlugins(plugins: InstalledPmpmPlugin[]): void {
  if (typeof window === 'undefined') return;
  notifyPluginStoreChanged();
  // Keep localStorage as the source of truth, but also fan out a Tauri event so
  // other windows can refresh plugin renderer registrations.
  void broadcastDataUpdate(STORAGE_KEYS.PMPM_PLUGINS, plugins, TAURI_EVENTS.PMPM_PLUGINS_UPDATED);
}

export function getInstalledPmpmPlugin(id: string): InstalledPmpmPlugin | null {
  const plugins = loadInstalledPmpmPlugins();
  return plugins.find((plugin) => plugin.manifest.metadata.id === id) ?? null;
}

export function upsertInstalledPmpmPlugin(plugin: InstalledPmpmPlugin): void {
  const plugins = loadInstalledPmpmPlugins();
  const existingIndex = plugins.findIndex((p) => p.manifest.metadata.id === plugin.manifest.metadata.id);
  if (existingIndex >= 0) {
    plugins.splice(existingIndex, 1, plugin);
  } else {
    plugins.push(plugin);
  }
  saveInstalledPmpmPlugins(plugins);
}

export async function parsePmpmPluginFromFilePath(filePath: string): Promise<InstalledPmpmPlugin> {
  const { readBinaryFile } = await import('@tauri-apps/api/fs');
  const bytes = await readBinaryFile(filePath);
  const packageBytes = new Uint8Array(bytes);
  const files = unzipSync(packageBytes);

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Invalid .pmpm: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validateManifest(manifestUnknown);

  const entryKey = manifestUnknown.entryPoint.replace(/^\.?\//, '');
  const entryBytes = files[entryKey] ?? files[manifestUnknown.entryPoint];
  if (!entryBytes) {
    throw new Error(`Invalid .pmpm: missing entryPoint "${manifestUnknown.entryPoint}"`);
  }

  const [packageSha256, manifestSha256, entrySha256] = await Promise.all([
    sha256Hex(packageBytes),
    sha256Hex(manifestBytes),
    sha256Hex(entryBytes),
  ]);

  return {
    manifest: manifestUnknown,
    entryCode: strFromU8(entryBytes),
    installedAt: Date.now(),
    packageSha256,
    manifestSha256,
    entrySha256,
  };
}

export async function installPmpmPluginFromFilePath(filePath: string): Promise<InstalledPmpmPlugin> {
  const plugin = await parsePmpmPluginFromFilePath(filePath);
  upsertInstalledPmpmPlugin(plugin);
  return plugin;
}

export function uninstallPmpmPlugin(id: string): void {
  const plugins = loadInstalledPmpmPlugins();
  saveInstalledPmpmPlugins(plugins.filter((plugin) => plugin.manifest.metadata.id !== id));
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function recordPmpmPluginCrash(
  pluginId: string,
  error: unknown,
  surface: PmpmPluginCrashSurface
): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const now = Date.now();
  const message = formatErrorMessage(error).slice(0, 2000);
  const lastError = `[${surface}] ${message}`;

  plugins[index] = {
    ...plugins[index],
    enabled: false,
    disabledReason: 'crash',
    lastError,
    lastErrorAt: now,
  };

  saveInstalledPmpmPlugins(plugins);
}

function buildAnchorsFromManifest(plugin: InstalledPmpmPlugin): Pick<Magnet, 'anchorType' | 'anchors'> {
  const anchor = plugin.manifest.magnet?.defaultAnchor;
  const coords = anchor?.coordinates?.filter(Boolean) ?? [];

  if (coords.length >= 2) {
    const [a, b] = coords;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    if (minY === maxY) {
      return {
        anchorType: 'horizontal',
        anchors: [
          { id: 'left', gridX: minX, gridY: minY, role: 'anchor' },
          { id: 'right', gridX: maxX, gridY: maxY, role: 'boundary' },
        ],
      };
    }

    if (minX === maxX) {
      return {
        anchorType: 'vertical',
        anchors: [
          { id: 'top', gridX: minX, gridY: minY, role: 'anchor' },
          { id: 'bottom', gridX: maxX, gridY: maxY, role: 'boundary' },
        ],
      };
    }

    return {
      anchorType: 'rectangular',
      anchors: [
        { id: 'top-left', gridX: minX, gridY: minY, role: 'anchor' },
        { id: 'top-right', gridX: maxX, gridY: minY, role: 'boundary' },
        { id: 'bottom-left', gridX: minX, gridY: maxY, role: 'boundary' },
        { id: 'bottom-right', gridX: maxX, gridY: maxY, role: 'boundary' },
      ],
    };
  }

  const single = coords[0] ?? { x: 0, y: 0 };
  return {
    anchorType: 'single',
    anchors: [{ id: 'anchor', gridX: single.x, gridY: single.y, role: 'anchor' }],
  };
}

export function createMagnetTemplateFromPlugin(plugin: InstalledPmpmPlugin): Magnet {
  const { id, name, description, tags } = plugin.manifest.metadata;
  const { anchorType, anchors } = buildAnchorsFromManifest(plugin);

  const style = {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '10px',
    padding: '8px',
    ...(plugin.manifest.magnet?.defaultStyle ?? {}),
  };

  return {
    id,
    type: 'custom',
    name,
    renderer: id,
    previewText: name,
    description,
    tags,
    anchorType,
    anchors,
    content: '',
    style,
    state: 'idle',
    interactions: {
      draggable: true,
      clickable: true,
    },
  };
}

export function getPluginRendererDefinition(id: string): MagnetRendererDefinition | null {
  const plugin = getInstalledPmpmPlugin(id);
  if (!plugin) return null;

  const enabled = plugin.enabled ?? true;

  return {
    id,
    source: 'plugin',
    description: plugin.manifest.metadata.description,
    group: 'plugin',
    tags: plugin.manifest.metadata.tags,
    metadata: {
      pluginVersion: plugin.manifest.metadata.version,
      permissions: plugin.manifest.permissions ?? [],
      enabled,
    },
    render: () =>
      enabled
        ? React.createElement(PluginMagnetHost, { pluginId: id })
        : React.createElement(DisabledPluginMagnet, { pluginId: id }),
    preview: plugin.manifest.metadata.name,
  };
}

function DisabledPluginMagnet({ pluginId }: { pluginId: string }) {
  const plugin = getInstalledPmpmPlugin(pluginId);
  const name = plugin?.manifest.metadata.name ?? pluginId;
  const reason = plugin?.disabledReason;
  const lastError = plugin?.lastError;

  return React.createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        boxSizing: 'border-box',
        color: 'rgba(255,255,255,0.78)',
      },
    },
    React.createElement('div', { style: { fontWeight: 700 } }, name || pluginId),
    React.createElement(
      'div',
      { style: { fontSize: 12, opacity: 0.75 } },
      reason === 'crash' ? 'Plugin disabled (crashed)' : 'Plugin disabled'
    ),
    lastError
      ? React.createElement('div', { style: { fontSize: 11, opacity: 0.7, whiteSpace: 'pre-wrap' } }, lastError)
      : null
  );
}
