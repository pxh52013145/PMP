import type { ReactNode } from 'react';
import type { Magnet } from '../types/pixel';

export type MagnetRendererSource = 'builtin' | 'plugin' | 'runtime';

export interface MagnetRendererDefinition {
  id: string;
  render: () => ReactNode;
  preview?: ReactNode | (() => ReactNode);
  description?: string;
  group?: string;
  tags?: string[];
  source?: MagnetRendererSource;
  metadata?: Record<string, unknown>;
}

type RendererMap = Map<string, MagnetRendererDefinition>;

const rendererRegistry: RendererMap = new Map();

function normalizePreview(preview?: ReactNode | (() => ReactNode)): ReactNode | undefined {
  if (typeof preview === 'function') {
    return (preview as () => ReactNode)();
  }
  return preview;
}

export interface RegisterOptions {
  overwrite?: boolean;
}

export function registerMagnetRenderer(
  definition: MagnetRendererDefinition,
  options: RegisterOptions = {}
): void {
  const { id } = definition;
  if (!id) {
    throw new Error('Magnet renderer id is required');
  }

  const exists = rendererRegistry.has(id);
  if (exists && options.overwrite === false) {
    console.warn(`[MagnetRegistry] Renderer "${id}" already exists, skip registering`);
    return;
  }

  rendererRegistry.set(id, definition);
}

export function unregisterMagnetRenderer(id: string): void {
  rendererRegistry.delete(id);
}

export function clearMagnetRenderers(): void {
  rendererRegistry.clear();
}

export function getMagnetRenderer(id: string): MagnetRendererDefinition | null {
  return rendererRegistry.get(id) || null;
}

export function getMagnetPreviewNode(magnet: Magnet): ReactNode | null {
  const rendererId = magnet.renderer ?? magnet.id;
  const entry =
    getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
  return normalizePreview(entry?.preview) ?? magnet.previewText ?? null;
}

export function listRegisteredMagnetRenderers(): MagnetRendererDefinition[] {
  return Array.from(rendererRegistry.values());
}

