import { getTelemetryLogger } from '../services/telemetry/TelemetryService';

export type MagnetVariantSource = 'builtin' | 'plugin' | 'runtime';

export interface MagnetVariantDefinition {
  id: string;
  label: string;
  description?: string;
  source?: MagnetVariantSource;
  metadata?: Record<string, unknown>;
}

export interface RegisterVariantOptions {
  overwrite?: boolean;
}

type VariantMap = Map<string, MagnetVariantDefinition>;
type VariantListener = () => void;

const variantsByRenderer = new Map<string, VariantMap>();
const variantListeners = new Set<VariantListener>();
let variantRevision = 0;
const telemetry = getTelemetryLogger('magnets', 'variantRegistry');

function notifyVariantRegistryChanged(): void {
  variantRevision += 1;
  for (const listener of Array.from(variantListeners)) {
    try {
      listener();
    } catch (error) {
      telemetry.warn('magnet_variant.listener.failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function registerMagnetVariant(
  rendererId: string,
  variant: MagnetVariantDefinition,
  options: RegisterVariantOptions = {}
): void {
  if (!rendererId) throw new Error('rendererId is required');
  if (!variant.id) throw new Error('variant.id is required');

  let variants = variantsByRenderer.get(rendererId);
  if (!variants) {
    variants = new Map();
    variantsByRenderer.set(rendererId, variants);
  }

  const exists = variants.has(variant.id);
  if (exists && options.overwrite === false) {
    return;
  }

  variants.set(variant.id, variant);
  notifyVariantRegistryChanged();
}

export function listMagnetVariants(rendererId: string): MagnetVariantDefinition[] {
  const variants = variantsByRenderer.get(rendererId);
  if (!variants) return [];
  return Array.from(variants.values());
}

export function clearMagnetVariants(rendererId?: string): void {
  if (rendererId) {
    if (variantsByRenderer.delete(rendererId)) {
      notifyVariantRegistryChanged();
    }
    return;
  }
  if (variantsByRenderer.size === 0) return;
  variantsByRenderer.clear();
  notifyVariantRegistryChanged();
}

export function replaceMagnetVariants(
  rendererId: string,
  variants: readonly MagnetVariantDefinition[]
): void {
  if (!rendererId) throw new Error('rendererId is required');

  const next = new Map<string, MagnetVariantDefinition>();
  for (const variant of variants) {
    if (!variant.id) throw new Error('variant.id is required');
    next.set(variant.id, variant);
  }

  if (next.size === 0) {
    if (variantsByRenderer.delete(rendererId)) {
      notifyVariantRegistryChanged();
    }
    return;
  }

  variantsByRenderer.set(rendererId, next);
  notifyVariantRegistryChanged();
}

export function getMagnetVariantsRevision(): number {
  return variantRevision;
}

export function subscribeMagnetVariants(listener: VariantListener): () => void {
  variantListeners.add(listener);
  return () => {
    variantListeners.delete(listener);
  };
}

