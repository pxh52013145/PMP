import type {
  PmpHostManifestContributionDescriptor,
  PxpManifestV2,
} from '@pixel-matrix/plugin-platform-contracts';
import type { Magnet } from '../../types/pixel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import type { InstalledHostExtensionRecord } from './extensions';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readManifest(input: InstalledHostExtensionRecord | PxpManifestV2): PxpManifestV2 {
  return 'manifest' in input ? input.manifest : input;
}

export function readInstalledExtensionPmpHostContributions(
  input: InstalledHostExtensionRecord | PxpManifestV2
): PmpHostManifestContributionDescriptor | null {
  const manifest = readManifest(input);
  const host = manifest.contributes?.host;
  if (!isPlainObject(host)) return null;
  const pmp = host.pmp;
  if (!isPlainObject(pmp)) return null;
  return pmp as PmpHostManifestContributionDescriptor;
}

export function supportsInstalledExtensionMagnetSurface(
  record: Pick<InstalledHostExtensionRecord, 'manifest'>
): boolean {
  const contributions = readInstalledExtensionPmpHostContributions(record.manifest);
  if (!contributions?.magnets) return false;
  return record.manifest.runtimes.some((runtime) => runtime.kind === 'webview');
}

function buildFootprintFromHostMagnetDescriptor(
  contributions: PmpHostManifestContributionDescriptor
): Pick<Magnet, 'anchorType' | 'gridFootprint'> {
  const anchor = contributions.magnets?.defaultAnchor;
  const coords = anchor?.coordinates?.filter(Boolean) ?? [];

  if (coords.length >= 2) {
    const [a, b] = coords;
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);

    if (minY === maxY) {
      return { anchorType: 'horizontal', gridFootprint: { width, height: 1 } };
    }

    if (minX === maxX) {
      return { anchorType: 'vertical', gridFootprint: { width: 1, height } };
    }

    return { anchorType: 'rectangular', gridFootprint: { width, height } };
  }

  return { anchorType: 'single', gridFootprint: { width: 1, height: 1 } };
}

export function createMagnetTemplateFromInstalledExtension(
  record: InstalledHostExtensionRecord
): Magnet {
  const contributions = readInstalledExtensionPmpHostContributions(record);
  const { anchorType, gridFootprint } = buildFootprintFromHostMagnetDescriptor(
    contributions ?? {}
  );
  const identity = record.manifest.identity;
  const style: Magnet['style'] = {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: '2.7px',
    padding: '8px',
    ...(contributions?.magnets?.defaultStyle ?? {}),
  };

  return {
    id: identity.id,
    type: 'custom',
    name: identity.displayName ?? identity.name,
    renderer: identity.id,
    previewText: identity.displayName ?? identity.name,
    description: identity.description,
    tags: [...(identity.keywords ?? []), ...(identity.categories ?? [])],
    anchorType,
    anchors: [],
    gridFootprint,
    content: '',
    style,
    bounds: createDefaultBoundsForMagnet(anchorType, {
      width: style.width,
      height: style.height,
    }),
    state: 'idle',
    interactions: {
      draggable: true,
      clickable: true,
    },
  };
}
