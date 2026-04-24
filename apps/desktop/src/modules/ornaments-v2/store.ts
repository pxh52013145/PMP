import { useCallback, useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { readJson, writeJson } from '../storage';
import {
  broadcastDataUpdate,
  setupConfigSync,
  STORAGE_KEYS,
  TAURI_EVENTS,
} from '../../utils/windowCommunication';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export type OrnamentAnchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type OrnamentPlane = -1 | 1;

export interface OrnamentItem {
  id: string;
  name?: string;
  enabled: boolean;
  media: {
    path: string;
    mime: string;
    animated: boolean;
    sourceWidth: number;
    sourceHeight: number;
  };
  placement: {
    anchor: OrnamentAnchor;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  };
  layer: {
    plane: OrnamentPlane;
    order: number;
  };
}

export interface OrnamentsConfigV2 {
  version: 2;
  items: OrnamentItem[];
}

export const EMPTY_ORNAMENTS_CONFIG: OrnamentsConfigV2 = {
  version: 2,
  items: [],
};

function normalizeItem(value: unknown, index: number): OrnamentItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<OrnamentItem>;
  const media = item.media;
  const placement = item.placement;
  if (!media?.path || !placement) return null;

  const width = Number.isFinite(placement.width) && placement.width > 0 ? placement.width : 160;
  const height = Number.isFinite(placement.height) && placement.height > 0 ? placement.height : 160;
  const plane = item.layer?.plane === -1 ? -1 : 1;
  const order = Number.isFinite(item.layer?.order) ? item.layer?.order ?? index : index;

  return {
    id: item.id || `ornament-${index}`,
    name: item.name,
    enabled: item.enabled !== false,
    media: {
      path: media.path,
      mime: media.mime || 'image/*',
      animated: Boolean(media.animated),
      sourceWidth: Number.isFinite(media.sourceWidth) ? media.sourceWidth : width,
      sourceHeight: Number.isFinite(media.sourceHeight) ? media.sourceHeight : height,
    },
    placement: {
      anchor: placement.anchor || 'center',
      offsetX: Number.isFinite(placement.offsetX) ? placement.offsetX : 0,
      offsetY: Number.isFinite(placement.offsetY) ? placement.offsetY : 0,
      width,
      height,
    },
    layer: { plane, order },
  };
}

export function normalizeOrnamentsConfig(value: unknown): OrnamentsConfigV2 {
  if (!value || typeof value !== 'object') return EMPTY_ORNAMENTS_CONFIG;
  const items = Array.isArray((value as Partial<OrnamentsConfigV2>).items)
    ? (value as Partial<OrnamentsConfigV2>).items ?? []
    : [];
  return {
    version: 2,
    items: items.map(normalizeItem).filter((item): item is OrnamentItem => Boolean(item)),
  };
}

export function readOrnamentsConfig(): OrnamentsConfigV2 {
  return normalizeOrnamentsConfig(readJson(STORAGE_KEYS.ORNAMENTS_V2, EMPTY_ORNAMENTS_CONFIG));
}

export function writeOrnamentsConfig(config: OrnamentsConfigV2): void {
  writeJson(STORAGE_KEYS.ORNAMENTS_V2, normalizeOrnamentsConfig(config));
}

export async function persistOrnamentsConfig(config: OrnamentsConfigV2): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.ORNAMENTS_V2,
    normalizeOrnamentsConfig(config),
    TAURI_EVENTS.ORNAMENTS_UPDATED
  );
}

export function ornamentMediaUrl(item: OrnamentItem): string {
  return isTauriRuntime() ? convertFileSrc(item.media.path) : item.media.path;
}

export function createOrnamentItem(input: {
  path: string;
  mime: string;
  sourceWidth: number;
  sourceHeight: number;
  name?: string;
  order: number;
}): OrnamentItem {
  const maxEdge = 180;
  const scale = Math.min(1, maxEdge / Math.max(input.sourceWidth, input.sourceHeight, 1));
  const width = Math.max(32, Math.round(input.sourceWidth * scale));
  const height = Math.max(32, Math.round(input.sourceHeight * scale));
  return {
    id: `ornament-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    enabled: true,
    media: {
      path: input.path,
      mime: input.mime,
      animated: /gif|webp/i.test(input.mime) || /\.(gif|webp)$/i.test(input.path),
      sourceWidth: input.sourceWidth,
      sourceHeight: input.sourceHeight,
    },
    placement: {
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      width,
      height,
    },
    layer: {
      plane: 1,
      order: input.order,
    },
  };
}

export function useOrnamentsConfig(): [OrnamentsConfigV2, (next: OrnamentsConfigV2) => Promise<void>] {
  const [config, setConfig] = useState(readOrnamentsConfig);

  useEffect(() => {
    let disposed = false;
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.ORNAMENTS_V2],
      [TAURI_EVENTS.ORNAMENTS_UPDATED],
      () => {
        if (!disposed) setConfig(readOrnamentsConfig());
      }
    );
    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  const updateConfig = useCallback(async (next: OrnamentsConfigV2) => {
    const normalized = normalizeOrnamentsConfig(next);
    setConfig(normalized);
    await persistOrnamentsConfig(normalized);
  }, []);

  return [config, updateConfig];
}
