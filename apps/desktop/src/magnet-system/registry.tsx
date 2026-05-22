import type { ReactNode } from 'react';
import type { Magnet } from '../types/pixel';
import { t } from '../i18n/core';
import { getMagnetPreviewText } from '../modules/magnets/display';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

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
type RendererListener = () => void;

const rendererRegistry: RendererMap = new Map();
const rendererListeners = new Set<RendererListener>();
let rendererRevision = 0;
const telemetry = getTelemetryLogger('magnets', 'registry');

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rendererRegistry.clear();
    rendererListeners.clear();
    rendererRevision = 0;
  });
}

function notifyRendererRegistryChanged(): void {
  rendererRevision += 1;
  for (const listener of Array.from(rendererListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('magnet_renderer.listener.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

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
    telemetry.warn('magnet_renderer.register.skipped_duplicate', {
      message: `Renderer "${id}" already exists, skipping registration.`,
      fields: {
        rendererId: id,
      },
    });
    return;
  }

  rendererRegistry.set(id, definition);
  notifyRendererRegistryChanged();
}

export function unregisterMagnetRenderer(id: string): void {
  const didDelete = rendererRegistry.delete(id);
  if (didDelete) {
    notifyRendererRegistryChanged();
  }
}

export function clearMagnetRenderers(): void {
  if (rendererRegistry.size === 0) return;
  rendererRegistry.clear();
  notifyRendererRegistryChanged();
}

export function getMagnetRenderer(id: string): MagnetRendererDefinition | null {
  return rendererRegistry.get(id) || null;
}

export function getMagnetPreviewNode(magnet: Magnet): ReactNode | null {
  const rendererId = magnet.renderer ?? magnet.id;
  const entry =
    getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
  return normalizePreview(entry?.preview) ?? getMagnetPreviewText(magnet, t) ?? null;
}

export function listRegisteredMagnetRenderers(): MagnetRendererDefinition[] {
  return Array.from(rendererRegistry.values());
}

export function getMagnetRenderersRevision(): number {
  return rendererRevision;
}

export function subscribeMagnetRenderers(listener: RendererListener): () => void {
  rendererListeners.add(listener);
  return () => {
    rendererListeners.delete(listener);
  };
}

