import React from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import type { Magnet } from '../../types/pixel';
import type { MagnetRendererDefinition } from '../registry';
import { PluginMagnetHost } from './PluginMagnetHost';
import { BUILTIN_MAGNET_IDS } from '../../constants/magnets';
import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

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
};

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
  writeJson(STORAGE_KEYS.PMPM_PLUGINS, plugins);
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
  const files = unzipSync(new Uint8Array(bytes));

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

  return {
    manifest: manifestUnknown,
    entryCode: strFromU8(entryBytes),
    installedAt: Date.now(),
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

  return {
    id,
    source: 'plugin',
    description: plugin.manifest.metadata.description,
    group: 'plugin',
    tags: plugin.manifest.metadata.tags,
    metadata: {
      pluginVersion: plugin.manifest.metadata.version,
      permissions: plugin.manifest.permissions ?? [],
    },
    render: () => React.createElement(PluginMagnetHost, { pluginId: id }),
    preview: plugin.manifest.metadata.name,
  };
}
