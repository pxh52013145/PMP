import type { PmpsEntryPoint } from './pmps';

export type MagnetShaderConfig = {
  shaderId: string;
  enabled: boolean;
  entryPoint?: PmpsEntryPoint;
  fpsLimit?: number;
  resolutionScale?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseOptionalEntryPoint(value: unknown): PmpsEntryPoint | undefined {
  if (value === 'auto' || value === 'main' || value === 'shadertoy') return value;
  return undefined;
}

export function parseMagnetShaderConfig(variantConfig: unknown): MagnetShaderConfig | null {
  if (!isRecord(variantConfig)) return null;

  const direct = parseOptionalString(variantConfig.shaderPackId) ?? parseOptionalString(variantConfig.shaderId);
  const shader = variantConfig.shader;

  if (typeof shader === 'string') {
    return { shaderId: shader, enabled: true };
  }

  if (!direct && !isRecord(shader)) return null;

  const shaderId =
    direct ??
    (isRecord(shader)
      ? parseOptionalString(shader.shaderPackId) ??
        parseOptionalString(shader.shaderId) ??
        parseOptionalString(shader.id)
      : undefined);
  if (!shaderId) return null;

  const enabledRaw = isRecord(shader) ? shader.enabled : undefined;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;
  if (!enabled) return { shaderId, enabled: false };

  const entryPoint = isRecord(shader) ? parseOptionalEntryPoint(shader.entryPoint) : undefined;
  const fpsLimit = isRecord(shader) ? parseOptionalNumber(shader.fpsLimit) : undefined;
  const resolutionScale = isRecord(shader) ? parseOptionalNumber(shader.resolutionScale) : undefined;

  return {
    shaderId,
    enabled: true,
    entryPoint,
    fpsLimit,
    resolutionScale,
  };
}

