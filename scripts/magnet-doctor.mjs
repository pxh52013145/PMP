#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function usage(exitCode = 0) {
  const text = `
Usage:
  pnpm magnet:doctor -- --file <config.json> [--json]

Notes:
  - The input file should be an exported Magnet config JSON (same shape as utils/configManager export).
  - This tool only reports issues; it does not modify files.
`;
  // eslint-disable-next-line no-console
  console.log(text.trim());
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = [...argv];
  const out = { file: null, json: false };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') usage(0);
    if (a === '--json') {
      out.json = true;
      continue;
    }
    if (a === '--file' || a === '-f') {
      out.file = args[i + 1] ?? null;
      i++;
      continue;
    }
  }

  return out;
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) return null;
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return null;
  return source.slice(start, end + endMarker.length);
}

function extractQuotedStrings(source) {
  const out = [];
  const re = /'([^']+)'/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  return out;
}

function extractBuiltinMagnetIds(magnetsTsSource) {
  const block =
    sliceBetween(magnetsTsSource, 'export const BUILTIN_MAGNET_ID_LIST', '] as const;') ??
    sliceBetween(magnetsTsSource, 'export const BUILTIN_MAGNET_ID_LIST', '];');
  if (!block) return new Set();
  return new Set(extractQuotedStrings(block));
}

function extractBuiltinRendererIds(registrySource) {
  const block = sliceBetween(registrySource, 'const builtinDefinitions', '];');
  if (!block) return new Set();
  const out = new Set();
  const re = /\bid:\s*'([^']+)'/g;
  for (const m of block.matchAll(re)) out.add(m[1]);
  return out;
}

function extractBuiltinVariants(registrySource) {
  const variantsByRenderer = new Map();
  const re = /registerMagnetVariant\s*\(\s*'([^']+)'\s*,\s*\{[\s\S]*?\bid:\s*'([^']+)'/g;

  for (const m of registrySource.matchAll(re)) {
    const rendererId = m[1];
    const variantId = m[2];
    let set = variantsByRenderer.get(rendererId);
    if (!set) {
      set = new Set();
      variantsByRenderer.set(rendererId, set);
    }
    set.add(variantId);
  }

  return variantsByRenderer;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inferOccupiedPixels(anchors) {
  const getByIdOrRole = (ids, roles) => {
    return anchors.find((a) => ids.includes(a.id)) ?? anchors.find((a) => roles.includes(a.role));
  };

  const single = anchors.length === 1 ? anchors[0] : null;
  if (single) return [{ x: single.gridX, y: single.gridY }];

  const topLeft = getByIdOrRole(['top-left'], ['anchor']);
  const bottomRight = getByIdOrRole(['bottom-right'], []);
  if (topLeft && bottomRight) {
    const minX = Math.min(topLeft.gridX, bottomRight.gridX);
    const maxX = Math.max(topLeft.gridX, bottomRight.gridX);
    const minY = Math.min(topLeft.gridY, bottomRight.gridY);
    const maxY = Math.max(topLeft.gridY, bottomRight.gridY);
    const pixels = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        pixels.push({ x, y });
      }
    }
    return pixels;
  }

  const left = getByIdOrRole(['left'], ['anchor']);
  const right = getByIdOrRole(['right'], ['boundary']);
  if (left && right && left.gridY === right.gridY) {
    const minX = Math.min(left.gridX, right.gridX);
    const maxX = Math.max(left.gridX, right.gridX);
    const y = left.gridY;
    const pixels = [];
    for (let x = minX; x <= maxX; x++) pixels.push({ x, y });
    return pixels;
  }

  const top = getByIdOrRole(['top'], ['anchor']);
  const bottom = getByIdOrRole(['bottom'], ['boundary']);
  if (top && bottom && top.gridX === bottom.gridX) {
    const x = top.gridX;
    const minY = Math.min(top.gridY, bottom.gridY);
    const maxY = Math.max(top.gridY, bottom.gridY);
    const pixels = [];
    for (let y = minY; y <= maxY; y++) pixels.push({ x, y });
    return pixels;
  }

  return anchors.map((a) => ({ x: a.gridX, y: a.gridY }));
}

function formatList(items, max = 10) {
  if (items.length <= max) return items;
  return items.slice(0, max).concat([`... (+${items.length - max} more)`]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) usage(1);

  const inputPath = path.resolve(process.cwd(), args.file);
  const raw = await fs.readFile(inputPath, 'utf8');

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    // eslint-disable-next-line no-console
    console.error(`Invalid JSON: ${inputPath}`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];

  if (!isPlainObject(config)) {
    errors.push('config must be an object');
  }

  const version = config?.version;
  if (typeof version !== 'string') errors.push('config.version must be a string');

  const gridSize = config?.gridSize;
  if (!isPlainObject(gridSize)) {
    errors.push('config.gridSize must be an object');
  }

  const columns = gridSize?.columns;
  const rows = gridSize?.rows;
  if (!Number.isFinite(columns) || columns <= 0)
    errors.push('gridSize.columns must be a positive number');
  if (!Number.isFinite(rows) || rows <= 0) errors.push('gridSize.rows must be a positive number');

  const magnets = config?.magnets;
  if (!isPlainObject(magnets)) errors.push('config.magnets must be an object');

  const customMagnets = config?.customMagnets;
  if (!Array.isArray(customMagnets)) errors.push('config.customMagnets must be an array');

  const registryPath = path.resolve(process.cwd(), 'apps/desktop/src/magnet-system/registry.tsx');
  const builtinMagnetsPath = path.resolve(process.cwd(), 'apps/desktop/src/constants/magnets.ts');
  const [registrySource, builtinMagnetsSource] = await Promise.all([
    fs.readFile(registryPath, 'utf8'),
    fs.readFile(builtinMagnetsPath, 'utf8'),
  ]);

  const builtinMagnetIds = extractBuiltinMagnetIds(builtinMagnetsSource);
  const builtinRendererIds = extractBuiltinRendererIds(registrySource);
  const builtinVariants = extractBuiltinVariants(registrySource);

  const customMagnetIds = new Set();
  const duplicateCustomIds = new Set();
  if (Array.isArray(customMagnets)) {
    for (const magnet of customMagnets) {
      const id = magnet?.id;
      if (typeof id !== 'string' || id.length === 0) {
        errors.push('customMagnets contains an entry without a valid string id');
        continue;
      }
      if (customMagnetIds.has(id)) duplicateCustomIds.add(id);
      customMagnetIds.add(id);
      if (builtinMagnetIds.has(id)) {
        errors.push(`customMagnets contains a built-in id: "${id}"`);
      }
    }
  }
  if (duplicateCustomIds.size > 0) {
    errors.push(
      `customMagnets contains duplicate ids: ${Array.from(duplicateCustomIds).join(', ')}`
    );
  }

  const unknownMagnetStateIds = [];
  const activeMagnetEntries = [];

  if (isPlainObject(magnets)) {
    for (const [magnetId, magnetConfig] of Object.entries(magnets)) {
      if (!builtinMagnetIds.has(magnetId) && !customMagnetIds.has(magnetId)) {
        unknownMagnetStateIds.push(magnetId);
      }

      if (!isPlainObject(magnetConfig)) {
        errors.push(`magnets["${magnetId}"] must be an object`);
        continue;
      }

      const rawAnchors = magnetConfig.anchors;
      const anchors = Array.isArray(rawAnchors) ? rawAnchors : [];
      const isActive = magnetConfig.isActive === true;

      if (!Array.isArray(rawAnchors)) {
        errors.push(`magnets["${magnetId}"].anchors must be an array`);
      } else if (anchors.length === 0) {
        // As of M5, an inactive magnet may have empty anchors (never placed yet or intentionally cleared).
        if (isActive) {
          errors.push(
            `magnets["${magnetId}"].anchors must be a non-empty array when isActive=true`
          );
        }
      } else {
        for (const [idx, anchor] of anchors.entries()) {
          const x = anchor?.gridX;
          const y = anchor?.gridY;
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            errors.push(`magnets["${magnetId}"].anchors[${idx}] must have numeric gridX/gridY`);
            continue;
          }
          if (Number.isFinite(columns) && (x < 0 || x >= columns)) {
            errors.push(`magnets["${magnetId}"].anchors[${idx}].gridX out of bounds: ${x}`);
          }
          if (Number.isFinite(rows) && (y < 0 || y >= rows)) {
            errors.push(`magnets["${magnetId}"].anchors[${idx}].gridY out of bounds: ${y}`);
          }
        }
      }

      const renderer = magnetConfig.renderer;
      if (renderer !== undefined && typeof renderer !== 'string') {
        warnings.push(`magnets["${magnetId}"].renderer should be a string when present`);
      }

      if (
        typeof renderer === 'string' &&
        renderer.length > 0 &&
        !builtinRendererIds.has(renderer)
      ) {
        warnings.push(`unknown renderer "${renderer}" (magnet "${magnetId}", maybe a plugin)`);
      }

      const variant = magnetConfig.variant;
      if (variant !== undefined && typeof variant !== 'string') {
        warnings.push(`magnets["${magnetId}"].variant should be a string when present`);
      }
      if (typeof renderer === 'string' && typeof variant === 'string') {
        const known = builtinVariants.get(renderer);
        if (known && !known.has(variant)) {
          warnings.push(
            `unknown variant "${variant}" for renderer "${renderer}" (magnet "${magnetId}")`
          );
        } else if (!known) {
          warnings.push(
            `variant "${variant}" set for renderer "${renderer}" with no registered variants`
          );
        }
      }

      if (isActive && anchors.length > 0) {
        activeMagnetEntries.push({ id: magnetId, anchors });
      }
    }
  }

  if (unknownMagnetStateIds.length > 0) {
    warnings.push(
      `magnet states exist for unknown ids: ${formatList(unknownMagnetStateIds.sort(), 12).join(', ')}`
    );
  }

  const conflicts = [];
  if (Number.isFinite(columns) && Number.isFinite(rows)) {
    const occupancy = new Map(); // pixelKey -> magnetId[]
    for (const entry of activeMagnetEntries) {
      const pixels = inferOccupiedPixels(entry.anchors);
      for (const p of pixels) {
        const key = `${p.x},${p.y}`;
        const list = occupancy.get(key);
        if (list) {
          list.push(entry.id);
        } else {
          occupancy.set(key, [entry.id]);
        }
      }
    }
    for (const [pixel, ids] of occupancy.entries()) {
      const uniq = Array.from(new Set(ids));
      if (uniq.length > 1) conflicts.push({ pixel, magnets: uniq });
    }
  }

  const report = {
    input: inputPath,
    version: typeof version === 'string' ? version : null,
    gridSize: Number.isFinite(columns) && Number.isFinite(rows) ? { columns, rows } : null,
    counts: {
      magnetStates: isPlainObject(magnets) ? Object.keys(magnets).length : 0,
      activeMagnets: activeMagnetEntries.length,
      customMagnets: Array.isArray(customMagnets) ? customMagnets.length : 0,
      builtinMagnets: builtinMagnetIds.size,
      builtinRenderers: builtinRendererIds.size,
      builtinVariantRenderers: builtinVariants.size,
      conflicts: conflicts.length,
      errors: errors.length,
      warnings: warnings.length,
    },
    errors,
    warnings,
    conflicts: conflicts.slice(0, 50),
  };

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } else {
    const lines = [];
    lines.push('Magnet Doctor Report');
    lines.push(`- file: ${report.input}`);
    if (report.gridSize) lines.push(`- grid: ${report.gridSize.columns}x${report.gridSize.rows}`);
    if (report.version) lines.push(`- version: ${report.version}`);
    lines.push(
      `- states: ${report.counts.magnetStates} (active ${report.counts.activeMagnets}), custom: ${report.counts.customMagnets}`
    );
    lines.push(
      `- builtin: magnets ${report.counts.builtinMagnets}, renderers ${report.counts.builtinRenderers}, variantRenderers ${report.counts.builtinVariantRenderers}`
    );

    if (errors.length > 0) {
      lines.push('');
      lines.push(`Errors (${errors.length}):`);
      for (const e of errors) lines.push(`- ${e}`);
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push(`Warnings (${warnings.length}):`);
      for (const w of warnings) lines.push(`- ${w}`);
    }

    if (conflicts.length > 0) {
      lines.push('');
      lines.push(`Conflicts (${conflicts.length} pixels overlapped among active magnets):`);
      for (const c of conflicts.slice(0, 12)) {
        lines.push(`- ${c.pixel}: ${c.magnets.join(' <-> ')}`);
      }
      if (conflicts.length > 12) lines.push(`- ... (+${conflicts.length - 12} more)`);
    }

    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

try {
  await main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
}
