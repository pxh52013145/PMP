import type {
  PlatformConnectorDefinition,
  PlatformInstanceAuthSnapshot,
  PlatformInstanceRecord,
  PlatformRenderSelectionRecord,
} from '../../../modules/music-platform';
import { getPlatformInstanceAuthSnapshot } from '../../../modules/music-platform';

export type PlatformRegistrationVisualState =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'unauthorized'
  | 'disabled';

type PlatformRegistrationItemLike = {
  entry: {
    connectorId: string;
  };
  renderSelection?: PlatformRenderSelectionRecord | null;
};

export function buildPlatformAuthSnapshotMapByConnectorId(
  instances: PlatformInstanceRecord[]
): Record<string, PlatformInstanceAuthSnapshot | null> {
  const next: Record<string, PlatformInstanceAuthSnapshot | null> = {};
  for (const instance of instances) {
    const connectorId =
      typeof instance.metadata?.connectorId === 'string' ? instance.metadata.connectorId : '';
    if (!connectorId) continue;
    next[connectorId] = getPlatformInstanceAuthSnapshot(instance.instanceId);
  }
  return next;
}

export function resolvePlatformRegistrationState(
  definition: PlatformConnectorDefinition,
  snapshot: PlatformInstanceAuthSnapshot | null | undefined,
  renderSelection?: PlatformRenderSelectionRecord | null
): PlatformRegistrationVisualState {
  if (!definition.enabled || definition.authFlow !== 'qr') return 'disabled';
  const normalized = snapshot?.authState?.trim().toLowerCase() ?? 'unauthorized';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'authorized') {
    return renderSelection?.mounted ? 'active' : 'inactive';
  }
  return 'unauthorized';
}

export function filterMountedPlatformRegistrationItems<T extends PlatformRegistrationItemLike>(
  items: T[]
): T[] {
  return items.filter((item) => item.renderSelection?.mounted === true);
}

export function resolveActiveMountedPlatformRegistrationItem<T extends PlatformRegistrationItemLike>(
  selectedConnectorId: string | null | undefined,
  items: T[]
): T | null {
  const mountedItems = filterMountedPlatformRegistrationItems(items);
  return mountedItems.find((item) => item.entry.connectorId === selectedConnectorId) ?? mountedItems[0] ?? null;
}
