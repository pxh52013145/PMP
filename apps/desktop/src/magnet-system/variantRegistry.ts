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

const variantsByRenderer = new Map<string, VariantMap>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    variantsByRenderer.clear();
  });
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
}

export function listMagnetVariants(rendererId: string): MagnetVariantDefinition[] {
  const variants = variantsByRenderer.get(rendererId);
  if (!variants) return [];
  return Array.from(variants.values());
}

export function clearMagnetVariants(rendererId?: string): void {
  if (rendererId) {
    variantsByRenderer.delete(rendererId);
    return;
  }
  variantsByRenderer.clear();
}

