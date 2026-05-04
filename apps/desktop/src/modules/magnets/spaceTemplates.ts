import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { PixelAnchor } from '../../types/pixel';
import type { MagnetSpaceLayout } from './layout';
import {
  MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS,
  PLUGIN_DEVELOPMENT_WORKSPACE_DEFAULT_ANCHORS,
  SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID,
  SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID,
} from './systemLayouts';

export const INITIAL_MAGNET_SPACE_TEMPLATE_IDS = {
  main: 'main',
  musicTagWorkbench: 'music-tag-workbench',
  pluginDevelopmentWorkspace: 'plugin-development-workspace',
} as const;

export type InitialMagnetSpaceTemplateId =
  (typeof INITIAL_MAGNET_SPACE_TEMPLATE_IDS)[keyof typeof INITIAL_MAGNET_SPACE_TEMPLATE_IDS];

export type InitialMagnetSpaceTemplate = {
  id: string;
  name: string;
  order: number;
  seedTemplateId: InitialMagnetSpaceTemplateId;
};

export const INITIAL_MAGNET_SPACE_TEMPLATES: readonly InitialMagnetSpaceTemplate[] = [
  {
    id: 'space1',
    name: '\u7a7a\u95f41',
    order: 1,
    seedTemplateId: INITIAL_MAGNET_SPACE_TEMPLATE_IDS.main,
  },
  {
    id: 'space2',
    name: '\u7a7a\u95f42',
    order: 2,
    seedTemplateId: INITIAL_MAGNET_SPACE_TEMPLATE_IDS.musicTagWorkbench,
  },
  {
    id: 'space3',
    name: '\u7a7a\u95f43',
    order: 3,
    seedTemplateId: INITIAL_MAGNET_SPACE_TEMPLATE_IDS.pluginDevelopmentWorkspace,
  },
];

export function isInitialMagnetSpaceTemplateId(
  value: string
): value is InitialMagnetSpaceTemplateId {
  return (Object.values(INITIAL_MAGNET_SPACE_TEMPLATE_IDS) as string[]).includes(value);
}

export function getInitialMagnetSpaceTemplate(
  spaceId: string
): InitialMagnetSpaceTemplate | null {
  const normalized = spaceId.trim();
  return INITIAL_MAGNET_SPACE_TEMPLATES.find((template) => template.id === normalized) ?? null;
}

function cloneAnchorsByMagnetId(
  anchorsByMagnetId: Record<string, PixelAnchor[]>
): Record<string, PixelAnchor[]> {
  const result: Record<string, PixelAnchor[]> = {};
  for (const [magnetId, anchors] of Object.entries(anchorsByMagnetId)) {
    result[magnetId] = anchors.map((anchor) => ({ ...anchor }));
  }
  return result;
}

function buildLayoutFromSeed(
  activeSeed: Iterable<string>,
  anchorsSeed: Record<string, PixelAnchor[]>
): MagnetSpaceLayout {
  const active = new Set<string>();
  for (const id of activeSeed) {
    const normalized = id.trim();
    if (normalized) active.add(normalized);
  }
  for (const id of REQUIRED_MAGNET_IDS) active.add(id);

  const anchorsByMagnetId = cloneAnchorsByMagnetId(anchorsSeed);
  for (const magnetId of Object.keys(anchorsByMagnetId)) {
    if (active.has(magnetId)) continue;
    delete anchorsByMagnetId[magnetId];
  }

  return {
    version: 1,
    activeMagnetIds: [...active],
    anchorsByMagnetId,
  };
}

export function createInitialMagnetSpaceTemplateLayout(
  seedTemplateId: string | null | undefined,
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetSpaceLayout | null {
  const normalized = typeof seedTemplateId === 'string' ? seedTemplateId.trim() : '';
  if (!isInitialMagnetSpaceTemplateId(normalized)) return null;

  if (normalized === INITIAL_MAGNET_SPACE_TEMPLATE_IDS.main) {
    return buildLayoutFromSeed(defaultActiveMagnetIds, SYSTEM_SPACE1_DEFAULT_ANCHORS_BY_MAGNET_ID);
  }

  if (normalized === INITIAL_MAGNET_SPACE_TEMPLATE_IDS.musicTagWorkbench) {
    return buildLayoutFromSeed([...REQUIRED_MAGNET_IDS, 'music-tag-workbench'], {
      ...SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID,
      'music-tag-workbench': MUSIC_TAG_WORKBENCH_DEFAULT_ANCHORS,
    });
  }

  return buildLayoutFromSeed([...REQUIRED_MAGNET_IDS, 'plugin-development-workspace'], {
    ...SYSTEM_REQUIRED_ANCHORS_BY_MAGNET_ID,
    'plugin-development-workspace': PLUGIN_DEVELOPMENT_WORKSPACE_DEFAULT_ANCHORS,
  });
}

export function getInitialMagnetSpaceTemplateLayoutForSpace(
  spaceId: string,
  defaultActiveMagnetIds: ReadonlySet<string> = DEFAULT_ACTIVE_MAGNET_IDS
): MagnetSpaceLayout | null {
  const template = getInitialMagnetSpaceTemplate(spaceId);
  if (!template) return null;
  return createInitialMagnetSpaceTemplateLayout(template.seedTemplateId, defaultActiveMagnetIds);
}
