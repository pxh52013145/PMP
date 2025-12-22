import React from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Magnet } from '../../types/pixel';
import type { MagnetRendererDefinition } from '../registry';
import { PluginMagnetHost } from './PluginMagnetHost';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import { readDurableText, readJson, removeDurableText, writeDurableText } from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';

export type PmpmManifest = {
  formatVersion: '1.0';
  apiVersion?: string;
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
  contributions?: {
    commands?: Array<{
      id: string;
      title: string;
      description?: string;
      group?: string;
      order?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }>;
    settingsPanels?: Array<{
      id: string;
      title: string;
      description?: string;
      group?: string;
      order?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }>;
    visualizers?: Array<{
      id: string;
      title: string;
      description?: string;
      group?: string;
      order?: number;
      tags?: string[];
      inputs?: string[];
      metadata?: Record<string, unknown>;
    }>;
  };
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
  entryCode?: string;
  installedAt: number;
  packageSha256?: string;
  manifestSha256?: string;
  entrySha256?: string;
  enabled?: boolean;
  disabledReason?: 'manual' | 'crash';
  lastError?: string;
  lastErrorAt?: number;
};

export type PmpmPluginCrashSurface = 'magnet' | 'settings' | 'page' | 'visualizer' | 'window' | 'command';

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
  const apiVersion = m.apiVersion;
  if (typeof apiVersion !== 'undefined' && typeof apiVersion !== 'string') {
    throw new Error('manifest.apiVersion must be a string');
  }
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

  const contributions = m.contributions;
  if (typeof contributions !== 'undefined') {
    if (!contributions || typeof contributions !== 'object' || Array.isArray(contributions)) {
      throw new Error('manifest.contributions must be an object');
    }

    const c = contributions as Record<string, unknown>;
    const commands = c.commands;
    if (typeof commands !== 'undefined') {
      if (!Array.isArray(commands)) throw new Error('manifest.contributions.commands must be an array');

      const ids = new Set<string>();
      for (const item of commands) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.commands entries must be objects');
        }
        const cmd = item as Record<string, unknown>;
        const cmdId = cmd.id;
        if (typeof cmdId !== 'string' || cmdId.length < 1) {
          throw new Error('manifest.contributions.commands[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(cmdId)) {
          throw new Error('manifest.contributions.commands[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(cmdId)) {
          throw new Error(`manifest.contributions.commands[].id duplicated: "${cmdId}"`);
        }
        ids.add(cmdId);

        const title = cmd.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.commands["${cmdId}"].title is required`);
        }

        const description = cmd.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(`manifest.contributions.commands["${cmdId}"].description must be a string`);
        }

        const group = cmd.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.commands["${cmdId}"].group must be a string`);
        }

        const order = cmd.order;
        if (
          typeof order !== 'undefined' &&
          (typeof order !== 'number' || !Number.isFinite(order))
        ) {
          throw new Error(`manifest.contributions.commands["${cmdId}"].order must be a number`);
        }

        const tags = cmd.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.commands["${cmdId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.commands["${cmdId}"].tags must be an array of strings`
              );
            }
          }
        }

        const metadata = cmd.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.commands["${cmdId}"].metadata must be an object`);
          }
        }
      }
    }

    const settingsPanels = c.settingsPanels;
    if (typeof settingsPanels !== 'undefined') {
      if (!Array.isArray(settingsPanels)) {
        throw new Error('manifest.contributions.settingsPanels must be an array');
      }

      const ids = new Set<string>();
      for (const item of settingsPanels) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.settingsPanels entries must be objects');
        }
        const panel = item as Record<string, unknown>;
        const panelId = panel.id;
        if (typeof panelId !== 'string' || panelId.length < 1) {
          throw new Error('manifest.contributions.settingsPanels[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(panelId)) {
          throw new Error('manifest.contributions.settingsPanels[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(panelId)) {
          throw new Error(`manifest.contributions.settingsPanels[].id duplicated: "${panelId}"`);
        }
        ids.add(panelId);

        const title = panel.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.settingsPanels["${panelId}"].title is required`);
        }

        const description = panel.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(`manifest.contributions.settingsPanels["${panelId}"].description must be a string`);
        }

        const group = panel.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.settingsPanels["${panelId}"].group must be a string`);
        }

        const order = panel.order;
        if (
          typeof order !== 'undefined' &&
          (typeof order !== 'number' || !Number.isFinite(order))
        ) {
          throw new Error(`manifest.contributions.settingsPanels["${panelId}"].order must be a number`);
        }

        const tags = panel.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.settingsPanels["${panelId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.settingsPanels["${panelId}"].tags must be an array of strings`
              );
            }
          }
        }

        const metadata = panel.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.settingsPanels["${panelId}"].metadata must be an object`);
          }
        }
      }
    }

    const visualizers = c.visualizers;
    if (typeof visualizers !== 'undefined') {
      if (!Array.isArray(visualizers)) {
        throw new Error('manifest.contributions.visualizers must be an array');
      }

      const ids = new Set<string>();
      for (const item of visualizers) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.visualizers entries must be objects');
        }
        const visualizer = item as Record<string, unknown>;
        const visualizerId = visualizer.id;
        if (typeof visualizerId !== 'string' || visualizerId.length < 1) {
          throw new Error('manifest.contributions.visualizers[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(visualizerId)) {
          throw new Error('manifest.contributions.visualizers[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(visualizerId)) {
          throw new Error(`manifest.contributions.visualizers[].id duplicated: "${visualizerId}"`);
        }
        ids.add(visualizerId);

        const title = visualizer.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.visualizers["${visualizerId}"].title is required`);
        }

        const description = visualizer.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(`manifest.contributions.visualizers["${visualizerId}"].description must be a string`);
        }

        const group = visualizer.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.visualizers["${visualizerId}"].group must be a string`);
        }

        const order = visualizer.order;
        if (
          typeof order !== 'undefined' &&
          (typeof order !== 'number' || !Number.isFinite(order))
        ) {
          throw new Error(`manifest.contributions.visualizers["${visualizerId}"].order must be a number`);
        }

        const tags = visualizer.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.visualizers["${visualizerId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.visualizers["${visualizerId}"].tags must be an array of strings`
              );
            }
          }
        }

        const inputs = visualizer.inputs;
        if (typeof inputs !== 'undefined') {
          if (!Array.isArray(inputs)) {
            throw new Error(`manifest.contributions.visualizers["${visualizerId}"].inputs must be an array`);
          }
          for (const input of inputs) {
            if (typeof input !== 'string' || input.length < 1) {
              throw new Error(
                `manifest.contributions.visualizers["${visualizerId}"].inputs must be an array of strings`
              );
            }
          }
        }

        const metadata = visualizer.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.visualizers["${visualizerId}"].metadata must be an object`);
          }
        }
      }
    }
  }
}

export async function readPmpmPluginEntryCode(pluginId: string): Promise<string | null> {
  return readDurableText('pmpm-entry', pluginId);
}

async function persistPmpmPluginEntryCode(pluginId: string, entryCode: string): Promise<boolean> {
  const ok = await writeDurableText('pmpm-entry', pluginId, entryCode);
  if (!ok) return false;
  const readBack = await readDurableText('pmpm-entry', pluginId);
  return readBack === entryCode;
}

async function removePmpmPluginEntryCode(pluginId: string): Promise<void> {
  await removeDurableText('pmpm-entry', pluginId);
}

export async function migrateInstalledPmpmPluginsToDurableStorage(): Promise<{
  migrated: number;
  failed: number;
}> {
  const plugins = loadInstalledPmpmPlugins();
  if (plugins.length === 0) return { migrated: 0, failed: 0 };

  let migrated = 0;
  let failed = 0;
  let changed = false;

  const next = plugins.map((plugin) => ({ ...plugin }));

  for (let i = 0; i < next.length; i += 1) {
    const plugin = next[i];
    const pluginId = plugin.manifest.metadata.id;
    const entryCode = plugin.entryCode;
    if (typeof entryCode !== 'string' || entryCode.length === 0) continue;

    const ok = await persistPmpmPluginEntryCode(pluginId, entryCode);
    if (!ok) {
      failed += 1;
      continue;
    }

    delete plugin.entryCode;
    migrated += 1;
    changed = true;
  }

  if (changed) {
    saveInstalledPmpmPlugins(next);
  }

  return { migrated, failed };
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
  const entryCode = plugin.entryCode;
  const stored =
    typeof entryCode === 'string' && entryCode.length > 0
      ? await persistPmpmPluginEntryCode(plugin.manifest.metadata.id, entryCode)
      : false;
  const persisted = stored ? { ...plugin, entryCode: undefined } : plugin;
  upsertInstalledPmpmPlugin(persisted);
  return persisted;
}

export function uninstallPmpmPlugin(id: string): void {
  const plugins = loadInstalledPmpmPlugins();
  saveInstalledPmpmPlugins(plugins.filter((plugin) => plugin.manifest.metadata.id !== id));
  void removePmpmPluginEntryCode(id);
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
