export type MagnetSpace = {
  id: string;
  name: string;
  order: number;
  createdAt: number;
};

export type MagnetSpacesState = {
  version: 1;
  activeSpaceId: string;
  spaces: MagnetSpace[];
};

export function createDefaultMagnetSpacesState(now: number = Date.now()): MagnetSpacesState {
  return {
    version: 1,
    activeSpaceId: 'space1',
    spaces: [
      { id: 'space1', name: '空间1', order: 1, createdAt: now },
      { id: 'space2', name: '空间2', order: 2, createdAt: now },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeSpace(value: unknown): MagnetSpace | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!id) return null;

  const nameRaw = typeof value.name === 'string' ? value.name.trim() : '';
  const name = nameRaw || id;
  const order = typeof value.order === 'number' && Number.isFinite(value.order) ? value.order : 0;
  const createdAt =
    typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0;

  return { id, name, order, createdAt };
}

export function sanitizeMagnetSpacesState(
  value: unknown,
  now: number = Date.now()
): MagnetSpacesState {
  const fallback = createDefaultMagnetSpacesState(now);
  if (!isRecord(value)) return fallback;
  if (value.version !== 1) return fallback;

  const rawSpaces = Array.isArray(value.spaces) ? value.spaces : [];
  const seen = new Set<string>();
  const spaces: MagnetSpace[] = [];

  for (const entry of rawSpaces) {
    const space = sanitizeSpace(entry);
    if (!space) continue;
    if (seen.has(space.id)) continue;
    seen.add(space.id);
    spaces.push(space);
  }

  const ensureDefault = (id: 'space1' | 'space2', name: string, order: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    spaces.push({ id, name, order, createdAt: now });
  };
  ensureDefault('space1', '空间1', 1);
  ensureDefault('space2', '空间2', 2);

  const withOrder = spaces.map((space, idx) => ({
    ...space,
    order: space.order > 0 ? space.order : idx + 1,
    createdAt: space.createdAt > 0 ? space.createdAt : now,
  }));

  withOrder.sort((a, b) => (a.order - b.order) || (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));

  const normalizedActiveSpaceId = typeof value.activeSpaceId === 'string' ? value.activeSpaceId.trim() : '';
  const activeSpaceId = normalizedActiveSpaceId && seen.has(normalizedActiveSpaceId) ? normalizedActiveSpaceId : withOrder[0]!.id;

  return {
    version: 1,
    activeSpaceId,
    spaces: withOrder,
  };
}

export function createNextSpaceId(state: MagnetSpacesState): string {
  const taken = new Set(state.spaces.map((s) => s.id));
  for (let i = 1; i < 1000; i += 1) {
    const id = `space${i}`;
    if (!taken.has(id)) return id;
  }
  return `space-${Date.now()}`;
}

export function getNextSpaceId(state: MagnetSpacesState, currentSpaceId: string): string {
  const idx = state.spaces.findIndex((s) => s.id === currentSpaceId);
  if (idx < 0) return state.spaces[0]?.id ?? 'space1';
  return state.spaces[(idx + 1) % state.spaces.length]?.id ?? state.spaces[0]?.id ?? 'space1';
}
