import React from 'react';
import { unzip, strFromU8 } from 'fflate';
import type { Unzipped } from 'fflate';
import type { Magnet } from '../../types/pixel';
import type { MagnetRendererDefinition } from '../registry';
import { PluginMagnetHost } from './PluginMagnetHost';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import {
  readDurableText,
  readJson,
  readString,
  removeDurableText,
  tryWriteJson,
  writeDurableText,
  writeJson,
  writeString,
} from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastSignal } from '../../utils/windowCommunication';
import { recordPmpmAuditEvent } from './pmpmGovernance';

async function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return await new Promise((resolve, reject) => {
    unzip(bytes, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    });
  });
}

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
    workbenches?: Array<{
      id: string;
      title: string;
      description?: string;
      group?: string;
      order?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }>;
    pages?: Array<{
      id: string;
      title: string;
      description?: string;
      group?: string;
      order?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }>;
    windows?: Array<{
      id: string;
      title: string;
      description?: string;
      width?: number;
      height?: number;
      group?: string;
      order?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    }>;
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
  deniedPermissions?: string[];
  lastError?: string;
  lastErrorAt?: number;
};

export type PmpmPluginCrashSurface =
  | 'workbench'
  | 'magnet'
  | 'settings'
  | 'page'
  | 'visualizer'
  | 'window'
  | 'command';

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

  const declared = plugin.manifest.permissions ?? [];
  const denied = new Set(
    Array.isArray(plugin.deniedPermissions)
      ? plugin.deniedPermissions.filter((perm) => typeof perm === 'string' && perm.length > 0)
      : []
  );

  return new Set(declared.filter((perm) => !denied.has(perm)));
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
  try {
    recordPmpmAuditEvent({
      type: 'permission-denied',
      pluginId: options.pluginId,
      hostLabel: options.hostLabel,
      capability: options.capability,
      action: options.action,
    });
  } catch {
    // ignore
  }
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

export function validatePmpmManifest(manifest: unknown): asserts manifest is PmpmManifest {
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

    const workbenches = c.workbenches;
    if (typeof workbenches !== 'undefined') {
      if (!Array.isArray(workbenches)) {
        throw new Error('manifest.contributions.workbenches must be an array');
      }

      const ids = new Set<string>();
      for (const item of workbenches) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.workbenches entries must be objects');
        }
        const workbench = item as Record<string, unknown>;
        const workbenchId = workbench.id;
        if (typeof workbenchId !== 'string' || workbenchId.length < 1) {
          throw new Error('manifest.contributions.workbenches[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(workbenchId)) {
          throw new Error('manifest.contributions.workbenches[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(workbenchId)) {
          throw new Error(`manifest.contributions.workbenches[].id duplicated: "${workbenchId}"`);
        }
        ids.add(workbenchId);

        const title = workbench.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.workbenches["${workbenchId}"].title is required`);
        }

        const description = workbench.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(
            `manifest.contributions.workbenches["${workbenchId}"].description must be a string`
          );
        }

        const group = workbench.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.workbenches["${workbenchId}"].group must be a string`);
        }

        const order = workbench.order;
        if (typeof order !== 'undefined' && (typeof order !== 'number' || !Number.isFinite(order))) {
          throw new Error(`manifest.contributions.workbenches["${workbenchId}"].order must be a number`);
        }

        const tags = workbench.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.workbenches["${workbenchId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.workbenches["${workbenchId}"].tags must be an array of strings`
              );
            }
          }
        }

        const metadata = workbench.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.workbenches["${workbenchId}"].metadata must be an object`);
          }
        }
      }
    }

    const pages = c.pages;
    if (typeof pages !== 'undefined') {
      if (!Array.isArray(pages)) throw new Error('manifest.contributions.pages must be an array');

      const ids = new Set<string>();
      for (const item of pages) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.pages entries must be objects');
        }
        const page = item as Record<string, unknown>;
        const pageId = page.id;
        if (typeof pageId !== 'string' || pageId.length < 1) {
          throw new Error('manifest.contributions.pages[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(pageId)) {
          throw new Error('manifest.contributions.pages[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(pageId)) {
          throw new Error(`manifest.contributions.pages[].id duplicated: "${pageId}"`);
        }
        ids.add(pageId);

        const title = page.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.pages["${pageId}"].title is required`);
        }

        const description = page.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(`manifest.contributions.pages["${pageId}"].description must be a string`);
        }

        const group = page.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.pages["${pageId}"].group must be a string`);
        }

        const order = page.order;
        if (
          typeof order !== 'undefined' &&
          (typeof order !== 'number' || !Number.isFinite(order))
        ) {
          throw new Error(`manifest.contributions.pages["${pageId}"].order must be a number`);
        }

        const tags = page.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.pages["${pageId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.pages["${pageId}"].tags must be an array of strings`
              );
            }
          }
        }

        const metadata = page.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.pages["${pageId}"].metadata must be an object`);
          }
        }
      }
    }
    const windows = c.windows;
    if (typeof windows !== 'undefined') {
      if (!Array.isArray(windows)) throw new Error('manifest.contributions.windows must be an array');

      const ids = new Set<string>();
      for (const item of windows) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('manifest.contributions.windows entries must be objects');
        }
        const window = item as Record<string, unknown>;
        const windowId = window.id;
        if (typeof windowId !== 'string' || windowId.length < 1) {
          throw new Error('manifest.contributions.windows[].id is required');
        }
        if (!/^[a-z0-9-]{1,48}$/.test(windowId)) {
          throw new Error('manifest.contributions.windows[].id must match /^[a-z0-9-]{1,48}$/');
        }
        if (ids.has(windowId)) {
          throw new Error(`manifest.contributions.windows[].id duplicated: "${windowId}"`);
        }
        ids.add(windowId);

        const title = window.title;
        if (typeof title !== 'string' || title.length < 1) {
          throw new Error(`manifest.contributions.windows["${windowId}"].title is required`);
        }

        const description = window.description;
        if (typeof description !== 'undefined' && typeof description !== 'string') {
          throw new Error(`manifest.contributions.windows["${windowId}"].description must be a string`);
        }

        const width = window.width;
        if (
          typeof width !== 'undefined' &&
          (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
        ) {
          throw new Error(`manifest.contributions.windows["${windowId}"].width must be a positive number`);
        }

        const height = window.height;
        if (
          typeof height !== 'undefined' &&
          (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)
        ) {
          throw new Error(`manifest.contributions.windows["${windowId}"].height must be a positive number`);
        }

        const group = window.group;
        if (typeof group !== 'undefined' && typeof group !== 'string') {
          throw new Error(`manifest.contributions.windows["${windowId}"].group must be a string`);
        }

        const order = window.order;
        if (
          typeof order !== 'undefined' &&
          (typeof order !== 'number' || !Number.isFinite(order))
        ) {
          throw new Error(`manifest.contributions.windows["${windowId}"].order must be a number`);
        }

        const tags = window.tags;
        if (typeof tags !== 'undefined') {
          if (!Array.isArray(tags)) {
            throw new Error(`manifest.contributions.windows["${windowId}"].tags must be an array`);
          }
          for (const tag of tags) {
            if (typeof tag !== 'string' || tag.length < 1) {
              throw new Error(
                `manifest.contributions.windows["${windowId}"].tags must be an array of strings`
              );
            }
          }
        }

        const metadata = window.metadata;
        if (typeof metadata !== 'undefined') {
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            throw new Error(`manifest.contributions.windows["${windowId}"].metadata must be an object`);
          }
        }
      }
    }
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

const PMPM_DURABLE_MIGRATION_V1_BACKUP_ID = 'pmpm-plugins-v1';

type PmpmDurableMigrationStatus = 'running' | 'done' | 'partial' | 'failed' | 'rolled-back';

type PmpmDurableMigrationFailureStage = 'backup' | 'persist' | 'save';

export type PmpmDurableMigrationFailure = {
  pluginId: string;
  stage: PmpmDurableMigrationFailureStage;
  message: string;
};

export type PmpmDurableMigrationReport = {
  version: 1;
  startedAt: number;
  finishedAt: number;
  status: PmpmDurableMigrationStatus;
  candidates: number;
  migrated: number;
  failed: number;
  backup: { existed: boolean; created: boolean };
  failures: PmpmDurableMigrationFailure[];
};

function persistPmpmMigrationReport(report: PmpmDurableMigrationReport): void {
  writeJson(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1_REPORT, report, { mode: 'sync' });
}

async function ensurePmpmMigrationBackup(raw: string): Promise<
  | { ok: true; existed: boolean; created: boolean }
  | { ok: false; message: string }
> {
  const existing = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (typeof existing === 'string') {
    return { ok: true, existed: true, created: false };
  }

  const written = await writeDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID, raw);
  if (!written) {
    return { ok: false, message: 'writeDurableText failed' };
  }

  const readBack = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  if (readBack !== raw) {
    return { ok: false, message: 'backup readback mismatch' };
  }

  return { ok: true, existed: false, created: true };
}

function saveInstalledPmpmPlugins(plugins: InstalledPmpmPlugin[]): boolean {
  if (typeof window === 'undefined') return false;

  const ok = tryWriteJson(STORAGE_KEYS.PMPM_PLUGINS, plugins);
  if (!ok) return false;

  notifyPluginStoreChanged();
  void broadcastSignal(TAURI_EVENTS.PMPM_PLUGINS_UPDATED);
  return true;
}

export async function migrateInstalledPmpmPluginsToDurableStorage(options: {
  force?: boolean;
} = {}): Promise<{
  migrated: number;
  failed: number;
  skipped?: boolean;
}> {
  const plugins = loadInstalledPmpmPlugins();
  if (plugins.length === 0) return { migrated: 0, failed: 0 };

  const candidates = plugins.filter((plugin) => {
    const entryCode = plugin.entryCode;
    return typeof entryCode === 'string' && entryCode.length > 0;
  });

  const migrationFlag = readString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1);
  if (!options.force && migrationFlag === 'rolled-back') {
    return { migrated: 0, failed: 0, skipped: true };
  }
  if (!options.force && migrationFlag === 'done' && candidates.length === 0) {
    return { migrated: 0, failed: 0, skipped: true };
  }

  const startedAt = Date.now();
  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'running');

  let migrated = 0;
  let failed = 0;
  let changed = false;
  const failures: PmpmDurableMigrationFailure[] = [];
  let backupInfo: PmpmDurableMigrationReport['backup'] = { existed: false, created: false };

  const next = plugins.map((plugin) => ({ ...plugin }));

  if (candidates.length > 0) {
    const raw = readString(STORAGE_KEYS.PMPM_PLUGINS) ?? JSON.stringify(plugins);
    const backup = await ensurePmpmMigrationBackup(raw);
    if (!backup.ok) {
      const report: PmpmDurableMigrationReport = {
        version: 1,
        startedAt,
        finishedAt: Date.now(),
        status: 'failed',
        candidates: candidates.length,
        migrated: 0,
        failed: candidates.length,
        backup: backupInfo,
        failures: [{ pluginId: '*', stage: 'backup', message: backup.message }],
      };
      persistPmpmMigrationReport(report);
      writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'failed');
      return { migrated: 0, failed: candidates.length };
    }
    backupInfo = { existed: backup.existed, created: backup.created };
  }

  for (let i = 0; i < next.length; i += 1) {
    const plugin = next[i];
    const pluginId = plugin.manifest.metadata.id;
    const entryCode = plugin.entryCode;
    if (typeof entryCode !== 'string' || entryCode.length === 0) continue;

    const ok = await persistPmpmPluginEntryCode(pluginId, entryCode);
    if (!ok) {
      failed += 1;
      failures.push({ pluginId, stage: 'persist', message: 'persist durable entry failed' });
      continue;
    }

    delete plugin.entryCode;
    migrated += 1;
    changed = true;
  }

  if (changed) {
    const ok = saveInstalledPmpmPlugins(next);
    if (!ok) {
      failures.push({ pluginId: '*', stage: 'save', message: 'failed to persist localStorage index' });
      failed = Math.max(failed, 1);
    }
  }

  const finishedAt = Date.now();
  const status: PmpmDurableMigrationStatus =
    failures.some((item) => item.stage === 'backup' || item.stage === 'save')
      ? 'failed'
      : failed === 0
        ? 'done'
        : 'partial';

  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, status);

  persistPmpmMigrationReport({
    version: 1,
    startedAt,
    finishedAt,
    status,
    candidates: candidates.length,
    migrated,
    failed,
    backup: backupInfo,
    failures,
  });

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
  const files = await unzipAsync(packageBytes);

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Invalid .pmpm: missing manifest.json');
  }

  const manifestRaw = strFromU8(manifestBytes);
  const manifestUnknown = JSON.parse(manifestRaw) as unknown;
  validatePmpmManifest(manifestUnknown);

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
  const existing = getInstalledPmpmPlugin(plugin.manifest.metadata.id);

  const merged: InstalledPmpmPlugin = existing
    ? {
        ...plugin,
        enabled: existing.enabled,
        disabledReason: existing.disabledReason,
        deniedPermissions: existing.deniedPermissions,
        lastError: existing.lastError,
        lastErrorAt: existing.lastErrorAt,
      }
    : plugin;

  const entryCode = merged.entryCode;
  const stored =
    typeof entryCode === 'string' && entryCode.length > 0
      ? await persistPmpmPluginEntryCode(plugin.manifest.metadata.id, entryCode)
      : false;
  const persisted = stored ? { ...merged, entryCode: undefined } : merged;
  upsertInstalledPmpmPlugin(persisted);
  return persisted;
}

export function uninstallPmpmPlugin(id: string): void {
  const plugins = loadInstalledPmpmPlugins();
  saveInstalledPmpmPlugins(plugins.filter((plugin) => plugin.manifest.metadata.id !== id));
  void removePmpmPluginEntryCode(id);
}

function isPluginList(value: unknown): value is InstalledPmpmPlugin[] {
  return Array.isArray(value);
}

export async function rollbackPmpmDurableMigrationV1(options: {
  strategy?: 'backup' | 'rehydrate';
  removeDurableEntries?: boolean;
} = {}): Promise<{
  restored: number;
  missing: number;
  usedBackup: boolean;
  ok: boolean;
}> {
  if (typeof window === 'undefined') {
    return { restored: 0, missing: 0, usedBackup: false, ok: false };
  }

  const backupRaw = await readDurableText('migration-backup', PMPM_DURABLE_MIGRATION_V1_BACKUP_ID);
  const preferBackup =
    options.strategy === 'backup' || (options.strategy !== 'rehydrate' && typeof backupRaw === 'string');

  if (preferBackup && typeof backupRaw === 'string') {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(backupRaw) as unknown;
    } catch {
      parsed = null;
    }

    if (isPluginList(parsed)) {
      const ok = saveInstalledPmpmPlugins(parsed);
      if (!ok) return { restored: 0, missing: 0, usedBackup: true, ok: false };

      writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
      return { restored: parsed.length, missing: 0, usedBackup: true, ok: true };
    }
  }

  const installed = loadInstalledPmpmPlugins();
  if (installed.length === 0) {
    writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
    return { restored: 0, missing: 0, usedBackup: false, ok: true };
  }

  let restored = 0;
  let missing = 0;

  const next = installed.map((plugin) => ({ ...plugin }));

  for (let i = 0; i < next.length; i += 1) {
    const plugin = next[i];
    const pluginId = plugin.manifest.metadata.id;
    if (typeof plugin.entryCode === 'string' && plugin.entryCode.length > 0) continue;
    const entryCode = await readPmpmPluginEntryCode(pluginId);
    if (!entryCode) {
      missing += 1;
      continue;
    }
    plugin.entryCode = entryCode;
    restored += 1;
  }

  const ok = saveInstalledPmpmPlugins(next);
  if (!ok) return { restored: 0, missing, usedBackup: false, ok: false };

  if (options.removeDurableEntries) {
    for (const plugin of next) {
      const pluginId = plugin.manifest.metadata.id;
      await removePmpmPluginEntryCode(pluginId);
    }
  }

  writeString(STORAGE_KEYS.PMPM_DURABLE_MIGRATION_V1, 'rolled-back');
  return { restored, missing, usedBackup: false, ok: true };
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
  try {
    recordPmpmAuditEvent({ type: 'crash', pluginId, surface, message });
  } catch {
    // ignore
  }
}

export function setPmpmPluginEnabled(pluginId: string, enabled: boolean): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const prev = plugins[index];
  const nextEnabled = Boolean(enabled);
  const prevEnabled = prev.enabled ?? true;

  if (prevEnabled === nextEnabled) return;

  plugins[index] = nextEnabled
    ? { ...prev, enabled: true, disabledReason: undefined }
    : { ...prev, enabled: false, disabledReason: 'manual' };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({
      type: nextEnabled ? 'enabled' : 'disabled',
      pluginId,
      reason: nextEnabled ? undefined : 'manual',
    });
  } catch {
    // ignore
  }
}

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    out.add(trimmed);
  }
  return Array.from(out).sort();
}

function isSameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function setPmpmPluginDeniedPermissions(pluginId: string, denied: string[]): void {
  const plugins = loadInstalledPmpmPlugins();
  const index = plugins.findIndex((plugin) => plugin.manifest.metadata.id === pluginId);
  if (index < 0) return;

  const prev = plugins[index];
  const nextDenied = normalizePermissionList(denied);
  const prevDenied = normalizePermissionList(prev.deniedPermissions);

  if (isSameStringList(prevDenied, nextDenied)) return;

  plugins[index] = {
    ...prev,
    deniedPermissions: nextDenied.length > 0 ? nextDenied : undefined,
  };

  saveInstalledPmpmPlugins(plugins);
  try {
    recordPmpmAuditEvent({ type: 'permissions-updated', pluginId, deniedPermissions: nextDenied });
  } catch {
    // ignore
  }
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
