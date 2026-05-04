import {
  INITIAL_MAGNET_SPACE_TEMPLATE_IDS,
  INITIAL_MAGNET_SPACE_TEMPLATES,
  isInitialMagnetSpaceTemplateId,
  type InitialMagnetSpaceTemplateId,
} from './spaceTemplates';

export type MagnetSpace = {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  seedTemplateId?: InitialMagnetSpaceTemplateId;
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
    spaces: INITIAL_MAGNET_SPACE_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      order: template.order,
      createdAt: now,
      seedTemplateId: template.seedTemplateId,
    })),
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
  const seedTemplateIdRaw =
    typeof value.seedTemplateId === 'string' ? value.seedTemplateId.trim() : '';
  const seedTemplateId = isInitialMagnetSpaceTemplateId(seedTemplateIdRaw)
    ? seedTemplateIdRaw
    : undefined;

  return seedTemplateId ? { id, name, order, createdAt, seedTemplateId } : { id, name, order, createdAt };
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

  if (spaces.length === 0) return fallback;

  if (!seen.has('space1')) {
    const mainTemplate = INITIAL_MAGNET_SPACE_TEMPLATES.find(
      (template) => template.seedTemplateId === INITIAL_MAGNET_SPACE_TEMPLATE_IDS.main
    );
    seen.add('space1');
    spaces.push({
      id: 'space1',
      name: mainTemplate?.name ?? 'space1',
      order: mainTemplate?.order ?? 1,
      createdAt: now,
      seedTemplateId: INITIAL_MAGNET_SPACE_TEMPLATE_IDS.main,
    });
  }

  const withOrder = spaces.map((space, idx) => ({
    ...space,
    order: space.order > 0 ? space.order : idx + 1,
    createdAt: space.createdAt > 0 ? space.createdAt : now,
  }));

  withOrder.sort(
    (a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );

  const normalizedActiveSpaceId =
    typeof value.activeSpaceId === 'string' ? value.activeSpaceId.trim() : '';
  const activeSpaceId =
    normalizedActiveSpaceId && seen.has(normalizedActiveSpaceId)
      ? normalizedActiveSpaceId
      : withOrder[0]!.id;

  return {
    version: 1,
    activeSpaceId,
    spaces: withOrder,
  };
}

export function createNextSpaceId(state: MagnetSpacesState): string {
  const usedNumbers = state.spaces
    .map((space) => {
      const match = space.id.match(/^space(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  const start = Math.max(0, ...usedNumbers) + 1;
  const taken = new Set(state.spaces.map((space) => space.id));
  for (let i = start; i < start + 1000; i += 1) {
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
