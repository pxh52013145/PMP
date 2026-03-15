export type VariantPresetMetadataV1 = {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
};

export type VariantPresetV1 = {
  formatVersion: '1.0';
  type: 'variant-preset';
  metadata: VariantPresetMetadataV1;
  target: {
    rendererId: string;
  };
  fragment: Record<string, unknown>;
};

function assertPlainObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function isValidId(id: string): boolean {
  return /^[a-z0-9-]+$/.test(id);
}

function validateStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be string[]`);
  }
  return value;
}

export function validateVariantPresetV1(value: unknown): asserts value is VariantPresetV1 {
  assertPlainObject(value, 'preset');
  const preset = value as Record<string, unknown>;
  if (value.formatVersion !== '1.0') throw new Error('preset.formatVersion must be "1.0"');
  if (value.type !== 'variant-preset') throw new Error('preset.type must be "variant-preset"');

  assertPlainObject(value.metadata, 'preset.metadata');
  if (typeof value.metadata.id !== 'string' || value.metadata.id.length < 1 || !isValidId(value.metadata.id)) {
    throw new Error('preset.metadata.id must be a valid id');
  }
  if (typeof value.metadata.name !== 'string' || value.metadata.name.length < 1) {
    throw new Error('preset.metadata.name is required');
  }
  if (typeof value.metadata.version !== 'string' || value.metadata.version.length < 1) {
    throw new Error('preset.metadata.version is required');
  }
  if (typeof value.metadata.author !== 'undefined' && typeof value.metadata.author !== 'string') {
    throw new Error('preset.metadata.author must be a string');
  }
  if (typeof value.metadata.description !== 'undefined' && typeof value.metadata.description !== 'string') {
    throw new Error('preset.metadata.description must be a string');
  }
  if (typeof value.metadata.tags !== 'undefined') {
    value.metadata.tags = validateStringArray(value.metadata.tags, 'preset.metadata.tags');
  }

  assertPlainObject(value.target, 'preset.target');
  if (typeof value.target.rendererId !== 'string' || value.target.rendererId.trim().length < 1) {
    throw new Error('preset.target.rendererId is required');
  }

  const fragment = typeof preset.fragment !== 'undefined' ? preset.fragment : preset.componentTheme;
  if (typeof fragment === 'undefined') {
    throw new Error('preset.fragment is required');
  }

  assertPlainObject(fragment, typeof preset.fragment !== 'undefined' ? 'preset.fragment' : 'preset.componentTheme');
  preset.fragment = fragment;
  delete preset.componentTheme;
}

export function parseVariantPresetFromText(text: string): VariantPresetV1 {
  const parsed = JSON.parse(text) as unknown;
  validateVariantPresetV1(parsed);
  return parsed;
}

