import {
  useState,
  useCallback,
  useMemo,
  memo,
  useEffect,
  useDeferredValue,
  useRef,
  useSyncExternalStore,
  isValidElement,
  type ReactNode,
} from 'react';
import type {
  AnchorType,
  Magnet,
  MagnetAnimation,
  MagnetBoundsSpec,
  MagnetInsetConfig,
  MagnetStyle,
  PixelAnchor,
} from '../../types/pixel';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  setupConfigSync,
} from '../../utils/windowCommunication';
import { readJson, removeKey } from '../../modules/storage';
import { getMagnetDisplayName } from '../../modules/magnets/display';
import {
  getMagnetPreviewNode,
  getMagnetRenderer,
  getMagnetRenderersRevision,
  subscribeMagnetRenderers,
} from '../../magnet-system/registry';
import { listMagnetVariants } from '../../magnet-system/variantRegistry';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import { DEFAULT_MAGNET_TRANSITION } from '../../modules/magnets/chromePresets';
import {
  buildAnchorsFromOrigin,
  buildEditorMagnet,
  normalizeMagnetVariant,
  parseMagnetSkinPropsDraft,
} from './magnetCreatorModel';

import {
  findFirstMagnetPlacementCandidate,
  getOccupiedPixelKeys,
} from '../../utils/magnetPlacement';
import { useConfirmDialog } from '../core/ConfirmDialog';
import { useT } from '../../i18n';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import './EditorMagnetLibrary.css';

interface EditorMagnetLibraryProps {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
  onMagnetAddToLibrary: (magnet: Magnet) => void | Promise<void>;
  onMagnetUpdate: (magnet: Magnet) => void | Promise<void>;
  onMagnetActivate: (magnetId: string) => void;
  onMagnetDeactivate: (magnetId: string) => void;
  onMagnetDeleteFromLibrary: (magnetId: string) => void | Promise<void>;
}

type ViewMode = 'active' | 'inactive';
type FilterMode = 'all' | 'builtin' | 'custom' | 'fixed';
type DetailEditorMode = 'view' | 'edit' | 'create';

interface MagnetDetailDraft {
  id: string;
  name: string;
  anchorType: AnchorType;
  content: string;
  horizontalPixels: number;
  verticalPixels: number;
  rectWidth: number;
  rectHeight: number;
  boundsJson: string;
  styleJson: string;
  animationJson: string;
  chromeEnabled: boolean;
  chromeInsetJson: string;
  chromeOutsetJson: string;
  variant: string;
  skinPropsJson: string;
}

function estimateMagnetPixelCount(magnet: Magnet): number {
  const anchors = magnet.anchors ?? [];
  const footprint = magnet.gridFootprint;

  if (anchors.length === 0) {
    if (!footprint) return magnet.anchorType === 'single' ? 1 : 0;
    const width = Math.max(1, Math.round(footprint.width));
    const height = Math.max(1, Math.round(footprint.height));
    switch (magnet.anchorType) {
      case 'single':
        return 1;
      case 'horizontal':
        return width;
      case 'vertical':
        return height;
      case 'rectangular':
        return width * height;
      default:
        return 0;
    }
  }

  let minX = anchors[0].gridX;
  let maxX = anchors[0].gridX;
  let minY = anchors[0].gridY;
  let maxY = anchors[0].gridY;

  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.gridX < minX) minX = a.gridX;
    if (a.gridX > maxX) maxX = a.gridX;
    if (a.gridY < minY) minY = a.gridY;
    if (a.gridY > maxY) maxY = a.gridY;
  }

  const width = Math.max(0, maxX - minX + 1);
  const height = Math.max(0, maxY - minY + 1);

  switch (magnet.anchorType) {
    case 'single':
      return 1;
    case 'horizontal':
      return width;
    case 'vertical':
      return height;
    case 'rectangular':
      return width * height;
    default:
      return 0;
  }
}

const MAGNET_RENDERER_OPACITY_MIN = 0;
const MAGNET_RENDERER_OPACITY_MAX = 1;
const MAGNET_RENDERER_OPACITY_STEP = 0.05;

function clampMagnetRendererOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MAGNET_RENDERER_OPACITY_MIN, Math.min(MAGNET_RENDERER_OPACITY_MAX, value));
}

function getMagnetRendererOpacity(magnet: Magnet): number {
  return clampMagnetRendererOpacity(magnet.style.opacity ?? 1);
}

function toOpaquePreviewColor(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (!normalized) return value;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 4) return `#${hex.slice(0, 3)}`;
    if (hex.length === 8) return `#${hex.slice(0, 6)}`;
    return normalized;
  }

  const rgbaMatch = normalized.match(/^rgba?\((.+)\)$/i);
  if (!rgbaMatch) return value;
  const channels = rgbaMatch[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (channels.length < 3) return value;
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

const DEFAULT_CUSTOM_MAGNET_STYLE: MagnetStyle = {
  width: '36px',
  height: '36px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const DEFAULT_CUSTOM_MAGNET_ANIMATION: MagnetAnimation = {
  transition: DEFAULT_MAGNET_TRANSITION,
  hoverStyle: {
    transform: 'scale(1.05)',
    filter: 'brightness(1.1)',
  },
  activeStyle: {
    transform: 'scale(0.95)',
    filter: 'brightness(0.9)',
  },
};

function stringifyEditorJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback, null, 2);
}

function getMagnetAnchorDimensions(magnet: Magnet | null | undefined): {
  horizontalPixels: number;
  verticalPixels: number;
  rectWidth: number;
  rectHeight: number;
} {
  const anchors = magnet?.anchors ?? [];
  if (!magnet || anchors.length < 2) {
    return { horizontalPixels: 5, verticalPixels: 3, rectWidth: 5, rectHeight: 3 };
  }

  if (magnet.anchorType === 'horizontal') {
    const width = Math.abs(anchors[1].gridX - anchors[0].gridX) + 1;
    return { horizontalPixels: Math.max(1, width), verticalPixels: 3, rectWidth: 5, rectHeight: 3 };
  }

  if (magnet.anchorType === 'vertical') {
    const height = Math.abs(anchors[1].gridY - anchors[0].gridY) + 1;
    return { horizontalPixels: 5, verticalPixels: Math.max(1, height), rectWidth: 5, rectHeight: 3 };
  }

  if (magnet.anchorType === 'rectangular' && anchors.length >= 3) {
    const width = Math.abs(anchors[1].gridX - anchors[0].gridX) + 1;
    const height = Math.abs(anchors[2].gridY - anchors[0].gridY) + 1;
    return {
      horizontalPixels: 5,
      verticalPixels: 3,
      rectWidth: Math.max(1, width),
      rectHeight: Math.max(1, height),
    };
  }

  return { horizontalPixels: 5, verticalPixels: 3, rectWidth: 5, rectHeight: 3 };
}

function getMagnetAnchorOrigin(magnet: Magnet | null | undefined): { x: number; y: number } {
  const anchor = magnet?.anchors?.[0];
  return {
    x: typeof anchor?.gridX === 'number' ? anchor.gridX : 10,
    y: typeof anchor?.gridY === 'number' ? anchor.gridY : 10,
  };
}

function createDetailDraftFromMagnet(magnet: Magnet): MagnetDetailDraft {
  const dimensions = getMagnetAnchorDimensions(magnet);
  const content =
    typeof magnet.content === 'string' || typeof magnet.content === 'number'
      ? String(magnet.content)
      : '';

  return {
    id: magnet.id,
    name: magnet.name,
    anchorType: magnet.anchorType,
    content,
    horizontalPixels: dimensions.horizontalPixels,
    verticalPixels: dimensions.verticalPixels,
    rectWidth: dimensions.rectWidth,
    rectHeight: dimensions.rectHeight,
    boundsJson: stringifyEditorJson(
      magnet.bounds,
      createDefaultBoundsForMagnet(magnet.anchorType, magnet.style)
    ),
    styleJson: stringifyEditorJson(magnet.style, DEFAULT_CUSTOM_MAGNET_STYLE),
    animationJson: stringifyEditorJson(magnet.animation, DEFAULT_CUSTOM_MAGNET_ANIMATION),
    chromeEnabled: magnet.chrome?.enabled !== false,
    chromeInsetJson: stringifyEditorJson(magnet.chrome?.inset, {}),
    chromeOutsetJson: stringifyEditorJson(magnet.chrome?.outset, {}),
    variant: magnet.variant ?? '',
    skinPropsJson: stringifyEditorJson(magnet.skinProps, {}),
  };
}

function createNewDetailDraft(): MagnetDetailDraft {
  return {
    id: '',
    name: '',
    anchorType: 'single',
    content: '',
    horizontalPixels: 5,
    verticalPixels: 3,
    rectWidth: 5,
    rectHeight: 3,
    boundsJson: stringifyEditorJson(
      createDefaultBoundsForMagnet('single', DEFAULT_CUSTOM_MAGNET_STYLE),
      {}
    ),
    styleJson: stringifyEditorJson(DEFAULT_CUSTOM_MAGNET_STYLE, {}),
    animationJson: stringifyEditorJson(DEFAULT_CUSTOM_MAGNET_ANIMATION, {}),
    chromeEnabled: true,
    chromeInsetJson: '{}',
    chromeOutsetJson: '{}',
    variant: '',
    skinPropsJson: '{}',
  };
}

function parseObjectJson<T extends object>(
  value: string,
  fallback: T,
  options: { allowEmpty?: boolean } = {}
): T | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return options.allowEmpty ? undefined : fallback;
  }

  const parsed = JSON.parse(normalized) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('object-json-required');
  }

  const record = parsed as T;
  return Object.keys(record).length > 0 || !options.allowEmpty ? record : undefined;
}

function parseInsetJson(value: string): MagnetInsetConfig | undefined {
  const parsed = parseObjectJson<Record<string, unknown>>(value, {}, { allowEmpty: true });
  if (!parsed) return undefined;

  const inset: MagnetInsetConfig = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const candidate = parsed[side];
    if (candidate === undefined || candidate === null || candidate === '') continue;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
      throw new Error('inset-number-required');
    }
    if (candidate > 0) {
      inset[side] = candidate;
    }
  }

  return Object.keys(inset).length > 0 ? inset : undefined;
}

function buildAnchorsForDraft(draft: MagnetDetailDraft, sourceMagnet: Magnet | null): PixelAnchor[] {
  const origin = getMagnetAnchorOrigin(sourceMagnet);
  return buildAnchorsFromOrigin(draft.anchorType, origin.x, origin.y, {
    horizontalPixels: draft.horizontalPixels,
    verticalPixels: draft.verticalPixels,
    rectWidth: draft.rectWidth,
    rectHeight: draft.rectHeight,
  });
}

export const EditorMagnetLibrary = memo(function EditorMagnetLibrary({
  magnetLibrary,
  activeMagnetIds,
  builtInMagnetIds,
  onMagnetAddToLibrary,
  onMagnetUpdate,
  onMagnetActivate,
  onMagnetDeactivate,
  onMagnetDeleteFromLibrary,
}: EditorMagnetLibraryProps) {
  const t = useT();

  const formatRendererGroup = useCallback(
    (group: string) => {
      const key = `magnet.groups.${group}`;
      const translated = t(key);
      return translated === key ? group : translated;
    },
    [t]
  );
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const rendererRevision = useSyncExternalStore(
    subscribeMagnetRenderers,
    getMagnetRenderersRevision,
    getMagnetRenderersRevision
  );
  const [selectedMagnetId, setSelectedMagnetId] = useState<string | null>(null);
  const [detailEditorMode, setDetailEditorMode] = useState<DetailEditorMode>('view');
  const [detailDraft, setDetailDraft] = useState<MagnetDetailDraft | null>(null);
  const [detailErrors, setDetailErrors] = useState<string[]>([]);
  const [pendingFocusMagnetId, setPendingFocusMagnetId] = useState<string | null>(null);
  const [highlightedMagnetId, setHighlightedMagnetId] = useState<string | null>(null);
  const lastLibraryFocusRequestIdRef = useRef<string | null>(null);
  const [magnetRendererOpacityDrafts, setMagnetRendererOpacityDrafts] = useState<Record<string, number>>(
    {}
  );
  const opacityCommitInFlightRef = useRef<Set<string>>(new Set());
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const { isVisible } = useWindowActivity();

  useEffect(() => {
    if (isVisible) return;
    setDetailEditorMode('view');
    setDetailDraft(null);
    setDetailErrors([]);
    setPendingFocusMagnetId(null);
    setHighlightedMagnetId(null);
    setMagnetRendererOpacityDrafts({});
    opacityCommitInFlightRef.current.clear();
  }, [isVisible]);

  useEffect(() => {
    const knownIds = new Set(magnetLibrary.map((magnet) => magnet.id));
    setMagnetRendererOpacityDrafts((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [magnetId, draftOpacity] of Object.entries(prev)) {
        if (!knownIds.has(magnetId)) {
          changed = true;
          continue;
        }
        next[magnetId] = draftOpacity;
      }
      return changed ? next : prev;
    });
  }, [magnetLibrary]);

  // 鍒嗙被 Magnet
  const categorizedMagnets = useMemo(() => {
    const fixed = magnetLibrary.filter((m) => REQUIRED_MAGNET_IDS.has(m.id));
    const nonFixed = magnetLibrary.filter((m) => !REQUIRED_MAGNET_IDS.has(m.id));

    return {
      active: {
        all: nonFixed.filter((m) => activeMagnetIds.has(m.id)),
        builtin: nonFixed.filter((m) => activeMagnetIds.has(m.id) && builtInMagnetIds.has(m.id)),
        custom: nonFixed.filter((m) => activeMagnetIds.has(m.id) && !builtInMagnetIds.has(m.id)),
        fixed: fixed.filter((m) => activeMagnetIds.has(m.id)),
      },
      inactive: {
        all: nonFixed.filter((m) => !activeMagnetIds.has(m.id)),
        builtin: nonFixed.filter((m) => !activeMagnetIds.has(m.id) && builtInMagnetIds.has(m.id)),
        custom: nonFixed.filter((m) => !activeMagnetIds.has(m.id) && !builtInMagnetIds.has(m.id)),
        fixed: fixed.filter((m) => !activeMagnetIds.has(m.id)),
      },
    };
  }, [magnetLibrary, activeMagnetIds, builtInMagnetIds]);

  // 褰撳墠鏄剧ず鐨?Magnet锛堟敮鎸佹悳绱級
  const displayMagnets = useMemo(() => {
    void rendererRevision;
    const baseMagnets = categorizedMagnets[viewMode][filterMode];
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) return baseMagnets;

    return baseMagnets.filter((magnet) => {
      const rendererId = magnet.renderer ?? magnet.id;
      const renderer =
        getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
      const displayName = getMagnetDisplayName(magnet, t);
      const searchable: string[] = [
        magnet.id,
        rendererId,
        displayName,
        magnet.name,
        magnet.type,
        magnet.anchorType,
        magnet.description,
        renderer?.description,
        renderer?.group,
        ...(magnet.tags ?? []),
        ...(renderer?.tags ?? []),
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase());

      return searchable.some((value) => value.includes(normalizedQuery));
    });
  }, [categorizedMagnets, deferredSearchQuery, filterMode, rendererRevision, t, viewMode]);

  const selectedMagnet = useMemo(() => {
    if (selectedMagnetId) {
      const found = magnetLibrary.find((magnet) => magnet.id === selectedMagnetId);
      if (found) return found;
    }
    return displayMagnets[0] ?? magnetLibrary[0] ?? null;
  }, [displayMagnets, magnetLibrary, selectedMagnetId]);

  useEffect(() => {
    if (detailEditorMode === 'create') return;
    if (!selectedMagnet) {
      if (selectedMagnetId !== null) {
        setSelectedMagnetId(null);
      }
      return;
    }
    if (selectedMagnet.id !== selectedMagnetId) {
      setSelectedMagnetId(selectedMagnet.id);
    }
  }, [detailEditorMode, selectedMagnet, selectedMagnetId]);

  useEffect(() => {
    if (!highlightedMagnetId) return;
    const timer = window.setTimeout(() => setHighlightedMagnetId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [highlightedMagnetId]);

  useEffect(() => {
    type MagnetLibraryFocusRequestV1 = { requestId: string; magnetId: string; createdAt: number };

    const focus = () => {
      const raw = readJson<unknown>(STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1, null);
      if (!raw || typeof raw !== 'object') return;
      const record = raw as Partial<MagnetLibraryFocusRequestV1>;
      if (typeof record.requestId !== 'string' || record.requestId.trim().length === 0) return;
      if (record.requestId === lastLibraryFocusRequestIdRef.current) return;
      if (typeof record.magnetId !== 'string' || record.magnetId.trim().length === 0) return;
      if (typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) return;

      lastLibraryFocusRequestIdRef.current = record.requestId;
      removeKey(STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1);

      const magnetId = record.magnetId;
      const magnet = magnetLibrary.find((m) => m.id === magnetId) ?? null;
      if (!magnet) return;

      const nextViewMode: ViewMode = activeMagnetIds.has(magnetId) ? 'active' : 'inactive';
      const nextFilterMode: FilterMode = REQUIRED_MAGNET_IDS.has(magnetId)
        ? 'fixed'
        : builtInMagnetIds.has(magnetId)
          ? 'builtin'
          : 'custom';

      setViewMode(nextViewMode);
      setFilterMode(nextFilterMode);
      setSearchQuery('');
      setSelectedMagnetId(magnetId);
      setDetailEditorMode('view');
      setDetailDraft(null);
      setDetailErrors([]);
      setPendingFocusMagnetId(magnetId);
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.MAGNET_LIBRARY_FOCUS_REQUEST_V1],
      [TAURI_EVENTS.MAGNET_LIBRARY_FOCUS_REQUESTED],
      focus
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [activeMagnetIds, builtInMagnetIds, magnetLibrary]);

  useEffect(() => {
    if (!pendingFocusMagnetId) return;
    const element = document.querySelector<HTMLElement>(`[data-magnet-id="${pendingFocusMagnetId}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMagnetId(pendingFocusMagnetId);
    setPendingFocusMagnetId(null);
  }, [displayMagnets, pendingFocusMagnetId]);

  // 缁熻鏁伴噺
  const counts = useMemo(() => {
    const activeAll = categorizedMagnets.active.all.length;
    const activeFixed = categorizedMagnets.active.fixed.length;
    const inactiveAll = categorizedMagnets.inactive.all.length;
    const inactiveFixed = categorizedMagnets.inactive.fixed.length;

    return {
      active: {
        total: activeAll + activeFixed,
        all: activeAll,
        builtin: categorizedMagnets.active.builtin.length,
        custom: categorizedMagnets.active.custom.length,
        fixed: activeFixed,
      },
      inactive: {
        total: inactiveAll + inactiveFixed,
        all: inactiveAll,
        builtin: categorizedMagnets.inactive.builtin.length,
        custom: categorizedMagnets.inactive.custom.length,
        fixed: inactiveFixed,
      },
    };
  }, [categorizedMagnets]);

  const requestMagnetPlacement = useCallback(
    async (magnet: Magnet) => {
      const activeMagnets = magnetLibrary.filter((m) => m.id !== magnet.id && activeMagnetIds.has(m.id));
      const occupiedKeys = getOccupiedPixelKeys(activeMagnets);

      const candidate = findFirstMagnetPlacementCandidate(magnet, occupiedKeys);
      if (!candidate) {
        await confirm({
          title: t('editor.magnet-library.placement.noSpace.title'),
          message: t('editor.magnet-library.placement.noSpace.message', {
            name: getMagnetDisplayName(magnet, t),
          }),
          confirmText: t('common.action.ok'),
        });
        return;
      }

      onMagnetActivate(magnet.id);
    },
    [activeMagnetIds, confirm, magnetLibrary, onMagnetActivate, t]
  );

  const updateDetailDraft = useCallback((patch: Partial<MagnetDetailDraft>) => {
    setDetailDraft((current) => (current ? { ...current, ...patch } : current));
    setDetailErrors([]);
  }, []);

  const startCreateMagnet = useCallback(() => {
    setSelectedMagnetId(null);
    setDetailEditorMode('create');
    setDetailDraft(createNewDetailDraft());
    setDetailErrors([]);
  }, []);

  const startEditMagnet = useCallback((magnet: Magnet) => {
    setSelectedMagnetId(magnet.id);
    setDetailEditorMode('edit');
    setDetailDraft(createDetailDraftFromMagnet(magnet));
    setDetailErrors([]);
  }, []);

  const cancelDetailDraft = useCallback(() => {
    setDetailEditorMode('view');
    setDetailDraft(null);
    setDetailErrors([]);
  }, []);

  const buildMagnetFromDraft = useCallback(
    (draft: MagnetDetailDraft, sourceMagnet: Magnet | null): { magnet: Magnet | null; errors: string[] } => {
      const errors: string[] = [];
      const id = draft.id.trim();
      const name = draft.name.trim();

      if (!id) {
        errors.push(t('editor.magnet-library.editor.error.required', {
          field: t('editor.magnet-library.editor.field.id'),
        }));
      }
      if (!name) {
        errors.push(t('editor.magnet-library.editor.error.required', {
          field: t('editor.magnet-library.editor.field.name'),
        }));
      }
      if (!sourceMagnet && id && magnetLibrary.some((magnet) => magnet.id === id)) {
        errors.push(t('editor.magnet-library.editor.error.idExists', { id }));
      }

      let bounds: MagnetBoundsSpec | null = null;
      let style: MagnetStyle | null = null;
      let animation: MagnetAnimation | undefined;
      let chromeInset: MagnetInsetConfig | undefined;
      let chromeOutset: MagnetInsetConfig | undefined;
      let skinProps: Record<string, unknown> | null = null;

      try {
        bounds = parseObjectJson<MagnetBoundsSpec>(
          draft.boundsJson,
          createDefaultBoundsForMagnet(draft.anchorType, DEFAULT_CUSTOM_MAGNET_STYLE)
        ) ?? null;
      } catch {
        errors.push(t('editor.magnet-library.editor.error.invalidJson', {
          field: t('editor.magnet-library.editor.field.bounds'),
        }));
      }

      try {
        style = parseObjectJson<MagnetStyle>(draft.styleJson, DEFAULT_CUSTOM_MAGNET_STYLE) ?? null;
      } catch {
        errors.push(t('editor.magnet-library.editor.error.invalidJson', {
          field: t('editor.magnet-library.editor.field.style'),
        }));
      }

      try {
        animation = parseObjectJson<MagnetAnimation>(
          draft.animationJson,
          DEFAULT_CUSTOM_MAGNET_ANIMATION,
          { allowEmpty: true }
        );
      } catch {
        errors.push(t('editor.magnet-library.editor.error.invalidJson', {
          field: t('editor.magnet-library.editor.field.animation'),
        }));
      }

      try {
        chromeInset = parseInsetJson(draft.chromeInsetJson);
      } catch {
        errors.push(t('editor.magnet-library.editor.error.insetNumber', {
          field: t('editor.magnet-library.editor.field.chromeInset'),
        }));
      }

      try {
        chromeOutset = parseInsetJson(draft.chromeOutsetJson);
      } catch {
        errors.push(t('editor.magnet-library.editor.error.insetNumber', {
          field: t('editor.magnet-library.editor.field.chromeOutset'),
        }));
      }

      try {
        skinProps = parseMagnetSkinPropsDraft(draft.skinPropsJson);
      } catch {
        errors.push(t('editor.magnet-library.editor.error.skinPropsObject'));
      }

      if (errors.length > 0 || !bounds || !style) {
        return { magnet: null, errors };
      }

      const seedMagnet = sourceMagnet
        ? {
            ...sourceMagnet,
            chrome: {
              ...(sourceMagnet.chrome ?? {}),
              enabled: draft.chromeEnabled,
            },
          }
        : {
            chrome: {
              enabled: draft.chromeEnabled,
            },
          };

      const sourceHasComplexContent =
        sourceMagnet !== null &&
        typeof sourceMagnet.content !== 'string' &&
        typeof sourceMagnet.content !== 'number';

      const magnet = buildEditorMagnet({
        seedMagnet,
        fallbackType: sourceMagnet?.type ?? 'custom',
        fallbackInteractions: sourceMagnet?.interactions,
        id,
        name,
        anchorType: draft.anchorType,
        anchors: buildAnchorsForDraft(draft, sourceMagnet),
        bounds,
        content: sourceHasComplexContent ? sourceMagnet.content : draft.content,
        style,
        animation,
        chromeInset,
        chromeOutset,
        variant: draft.variant,
        skinProps,
      });

      return { magnet, errors };
    },
    [magnetLibrary, t]
  );

  const saveDetailDraft = useCallback(async () => {
    if (!detailDraft) {
      setDetailErrors([t('editor.magnet-library.editor.error.noDraft')]);
      return;
    }

    const sourceMagnet = detailEditorMode === 'edit' ? selectedMagnet : null;
    const { magnet, errors } = buildMagnetFromDraft(detailDraft, sourceMagnet);
    if (!magnet || errors.length > 0) {
      setDetailErrors(errors);
      return;
    }

    if (detailEditorMode === 'create') {
      await onMagnetAddToLibrary(magnet);
    } else {
      await onMagnetUpdate(magnet);
    }

    setSelectedMagnetId(magnet.id);
    setDetailEditorMode('view');
    setDetailDraft(null);
    setDetailErrors([]);
  }, [
    buildMagnetFromDraft,
    detailDraft,
    detailEditorMode,
    onMagnetAddToLibrary,
    onMagnetUpdate,
    selectedMagnet,
    t,
  ]);

  const handleRendererOpacityDraftChange = useCallback((magnetId: string, rawValue: string) => {
    const nextOpacity = clampMagnetRendererOpacity(Number.parseFloat(rawValue));
    setMagnetRendererOpacityDrafts((prev) => {
      if (Math.abs((prev[magnetId] ?? -1) - nextOpacity) < 0.001) return prev;
      return {
        ...prev,
        [magnetId]: nextOpacity,
      };
    });
  }, []);

  const commitRendererOpacity = useCallback(
    async (magnet: Magnet) => {
      if (opacityCommitInFlightRef.current.has(magnet.id)) {
        return;
      }

      const draftOpacity = magnetRendererOpacityDrafts[magnet.id];
      if (typeof draftOpacity !== 'number') {
        return;
      }

      const nextOpacity = clampMagnetRendererOpacity(draftOpacity);
      const currentOpacity = getMagnetRendererOpacity(magnet);

      setMagnetRendererOpacityDrafts((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, magnet.id)) return prev;
        const next = { ...prev };
        delete next[magnet.id];
        return next;
      });

      if (Math.abs(nextOpacity - currentOpacity) < 0.001) {
        return;
      }

      opacityCommitInFlightRef.current.add(magnet.id);
      try {
        await onMagnetUpdate({
          ...magnet,
          style: {
            ...magnet.style,
            opacity: nextOpacity,
          },
        });
      } finally {
        opacityCommitInFlightRef.current.delete(magnet.id);
      }
    },
    [magnetRendererOpacityDrafts, onMagnetUpdate]
  );

  const handleRendererVariantChange = useCallback(
    (magnet: Magnet, rawVariant: string) => {
      const nextVariant = normalizeMagnetVariant(rawVariant);
      if ((magnet.variant ?? '') === (nextVariant ?? '')) return;

      const nextMagnet = { ...magnet };
      if (nextVariant) {
        nextMagnet.variant = nextVariant;
      } else {
        delete nextMagnet.variant;
      }

      void onMagnetUpdate(nextMagnet);
    },
    [onMagnetUpdate]
  );

  const renderDraftEditor = (sourceMagnet: Magnet | null, draft: MagnetDetailDraft) => {
    const rendererId = sourceMagnet?.renderer ?? sourceMagnet?.id ?? draft.id.trim();
    const rendererVariants = rendererId ? listMagnetVariants(rendererId) : [];
    const selectedVariantKnown =
      !draft.variant || rendererVariants.some((candidate) => candidate.id === draft.variant);
    const sourceHasComplexContent =
      sourceMagnet !== null &&
      typeof sourceMagnet.content !== 'string' &&
      typeof sourceMagnet.content !== 'number';

    return (
      <div className="library-detail-editor">
        <div className="library-detail-toolbar">
          <div>
            <div className="library-detail-title">
              {detailEditorMode === 'create'
                ? t('editor.magnet-library.editor.createTitle')
                : t('editor.magnet-library.editor.editTitle')}
            </div>
            <div className="library-detail-subtitle">
              {t('editor.magnet-library.editor.lifecycleHint')}
            </div>
          </div>
          <div className="library-detail-actions">
            <button className="library-secondary-btn" type="button" onClick={cancelDetailDraft}>
              {t('common.action.cancel')}
            </button>
            <button className="library-primary-btn" type="button" onClick={() => void saveDetailDraft()}>
              {detailEditorMode === 'create' ? t('common.action.create') : t('common.action.save')}
            </button>
          </div>
        </div>

          {detailErrors.length > 0 ? (
          <div className="library-detail-errors">
            {detailErrors.map((error, index) => (
              <div key={`${index}:${error}`}>{error}</div>
            ))}
          </div>
        ) : null}

        <div className="library-form-grid">
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.id')}</span>
            <input
              value={draft.id}
              disabled={detailEditorMode === 'edit'}
              onChange={(event) => updateDetailDraft({ id: event.target.value })}
            />
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.name')}</span>
            <input
              value={draft.name}
              onChange={(event) => updateDetailDraft({ name: event.target.value })}
            />
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.anchorType')}</span>
            <select
              value={draft.anchorType}
              onChange={(event) =>
                updateDetailDraft({ anchorType: event.target.value as AnchorType })
              }
            >
              <option value="single">{t('editor.magnet-library.editor.anchorType.single')}</option>
              <option value="horizontal">{t('editor.magnet-library.editor.anchorType.horizontal')}</option>
              <option value="vertical">{t('editor.magnet-library.editor.anchorType.vertical')}</option>
              <option value="rectangular">{t('editor.magnet-library.editor.anchorType.rectangular')}</option>
            </select>
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.content')}</span>
            <input
              value={draft.content}
              disabled={sourceHasComplexContent}
              onChange={(event) => updateDetailDraft({ content: event.target.value })}
              placeholder={sourceHasComplexContent ? t('editor.magnet-library.editor.contentComplex') : ''}
            />
          </label>
        </div>

        <div className="library-form-grid library-form-grid--compact">
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.horizontalPixels')}</span>
            <input
              type="number"
              min={1}
              max={27}
              value={draft.horizontalPixels}
              onChange={(event) =>
                updateDetailDraft({
                  horizontalPixels: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                })
              }
            />
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.verticalPixels')}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.verticalPixels}
              onChange={(event) =>
                updateDetailDraft({
                  verticalPixels: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                })
              }
            />
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.rectWidth')}</span>
            <input
              type="number"
              min={1}
              max={27}
              value={draft.rectWidth}
              onChange={(event) =>
                updateDetailDraft({
                  rectWidth: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                })
              }
            />
          </label>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.editor.field.rectHeight')}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.rectHeight}
              onChange={(event) =>
                updateDetailDraft({
                  rectHeight: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                })
              }
            />
          </label>
        </div>

        <div className="library-form-section">
          <div className="library-detail-section-title">
            {t('editor.magnet-library.editor.section.appearance')}
          </div>
          <div className="library-form-grid">
            <label className="library-form-field">
              <span>{t('editor.magnet-library.magnet.variant.label')}</span>
              <select
                value={draft.variant}
                onChange={(event) => updateDetailDraft({ variant: event.target.value })}
              >
                <option value="">{t('editor.magnet-library.magnet.variant.default')}</option>
                {rendererVariants.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
                {draft.variant && !selectedVariantKnown ? (
                  <option value={draft.variant}>
                    {t('editor.magnet-library.magnet.variant.unknown', {
                      variant: draft.variant,
                    })}
                  </option>
                ) : null}
              </select>
            </label>
            <label className="library-form-field library-form-field--checkbox">
              <input
                type="checkbox"
                checked={draft.chromeEnabled}
                onChange={(event) => updateDetailDraft({ chromeEnabled: event.target.checked })}
              />
              <span>{t('editor.magnet-library.editor.field.chromeEnabled')}</span>
            </label>
          </div>
          <div className="library-detail-note">
            {rendererVariants.length > 0
              ? t('editor.magnet-library.magnet.variant.hint', { count: rendererVariants.length })
              : t('editor.magnet-library.editor.variantEmpty', { rendererId: rendererId || '-' })}
          </div>
        </div>

        <div className="library-form-section">
          <div className="library-detail-section-title">
            {t('editor.magnet-library.editor.section.json')}
          </div>
          <label className="library-form-field library-form-field--textarea">
            <span>{t('editor.magnet-library.editor.field.skinProps')}</span>
            <textarea
              rows={5}
              value={draft.skinPropsJson}
              onChange={(event) => updateDetailDraft({ skinPropsJson: event.target.value })}
              spellCheck={false}
            />
          </label>
          <div className="library-form-grid">
            <label className="library-form-field library-form-field--textarea">
              <span>{t('editor.magnet-library.editor.field.chromeInset')}</span>
              <textarea
                rows={4}
                value={draft.chromeInsetJson}
                onChange={(event) => updateDetailDraft({ chromeInsetJson: event.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="library-form-field library-form-field--textarea">
              <span>{t('editor.magnet-library.editor.field.chromeOutset')}</span>
              <textarea
                rows={4}
                value={draft.chromeOutsetJson}
                onChange={(event) => updateDetailDraft({ chromeOutsetJson: event.target.value })}
                spellCheck={false}
              />
            </label>
          </div>
          <label className="library-form-field library-form-field--textarea">
            <span>{t('editor.magnet-library.editor.field.bounds')}</span>
            <textarea
              rows={8}
              value={draft.boundsJson}
              onChange={(event) => updateDetailDraft({ boundsJson: event.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="library-form-field library-form-field--textarea">
            <span>{t('editor.magnet-library.editor.field.style')}</span>
            <textarea
              rows={8}
              value={draft.styleJson}
              onChange={(event) => updateDetailDraft({ styleJson: event.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="library-form-field library-form-field--textarea">
            <span>{t('editor.magnet-library.editor.field.animation')}</span>
            <textarea
              rows={6}
              value={draft.animationJson}
              onChange={(event) => updateDetailDraft({ animationJson: event.target.value })}
              spellCheck={false}
            />
          </label>
        </div>
      </div>
    );
  };

  const renderDetailView = (magnet: Magnet) => {
    const isBuiltIn = builtInMagnetIds.has(magnet.id);
    const isActive = activeMagnetIds.has(magnet.id);
    const isRequired = REQUIRED_MAGNET_IDS.has(magnet.id);
    const rendererId = magnet.renderer ?? magnet.id;
    const renderer = getMagnetRenderer(rendererId) ?? (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
    const rendererVariants = listMagnetVariants(rendererId);
    const currentVariant = magnet.variant ?? '';
    const currentVariantKnown =
      !currentVariant || rendererVariants.some((candidate) => candidate.id === currentVariant);
    const magnetRendererOpacity =
      magnetRendererOpacityDrafts[magnet.id] ?? getMagnetRendererOpacity(magnet);
    const magnetRendererOpacityPercent = Math.round(magnetRendererOpacity * 100);
    const chromeEnabled = magnet.chrome?.enabled !== false;

    return (
      <div className="library-detail-view">
        <div className="library-detail-toolbar">
          <div>
            <div className="library-detail-title">{getMagnetDisplayName(magnet, t)}</div>
            <div className="library-detail-subtitle">{magnet.id}</div>
          </div>
          <div className="library-detail-actions">
            <button className="library-secondary-btn" type="button" onClick={startCreateMagnet}>
              {t('editor.magnet-library.action.newCustom')}
            </button>
            <button className="library-primary-btn" type="button" onClick={() => startEditMagnet(magnet)}>
              {t('editor.magnet-library.action.editDetail')}
            </button>
          </div>
        </div>

        <div className="library-detail-tags">
          <span>{isActive ? t('editor.magnet-library.detail.active') : t('editor.magnet-library.detail.inactive')}</span>
          <span>{isBuiltIn ? t('editor.magnet-library.badge.builtin') : t('editor.magnet-library.badge.custom')}</span>
          {isRequired ? <span>{t('editor.magnet-library.badge.required')}</span> : null}
          <span>{rendererId}</span>
        </div>

        <div className="library-detail-actions library-detail-actions--inline">
          {isActive ? (
            <button
              className="library-secondary-btn"
              type="button"
              disabled={isRequired}
              onClick={() => onMagnetDeactivate(magnet.id)}
            >
              {t('common.action.disable')}
            </button>
          ) : (
            <button
              className="library-secondary-btn"
              type="button"
              onClick={() => void requestMagnetPlacement(magnet)}
            >
              {t('common.action.enable')}
            </button>
          )}
          <button
            className="library-secondary-btn"
            type="button"
            onClick={() =>
              void onMagnetUpdate({
                ...magnet,
                chrome: { ...(magnet.chrome ?? {}), enabled: !chromeEnabled },
              })
            }
          >
            {chromeEnabled
              ? t('editor.magnet-library.magnet.tooltip.chrome.disable')
              : t('editor.magnet-library.magnet.tooltip.chrome.enable')}
          </button>
          {!isBuiltIn && !isActive ? (
            <button
              className="library-danger-btn"
              type="button"
              onClick={() => void onMagnetDeleteFromLibrary(magnet.id)}
            >
              {t('common.action.delete')}
            </button>
          ) : null}
        </div>

        <div className="library-detail-grid">
          <span>{t('editor.magnet-library.editor.field.anchorType')}</span>
          <strong>{magnet.anchorType}</strong>
          <span>{t('editor.magnet-library.detail.renderer')}</span>
          <strong>{renderer?.id ?? rendererId}</strong>
          <span>{t('editor.magnet-library.detail.rendererGroup')}</span>
          <strong>{renderer?.group ? formatRendererGroup(renderer.group) : '-'}</strong>
          <span>{t('editor.magnet-library.detail.pixelCount')}</span>
          <strong>{estimateMagnetPixelCount(magnet)}</strong>
        </div>

        <div className="library-form-section">
          <div className="library-detail-section-title">
            {t('editor.magnet-library.editor.section.appearance')}
          </div>
          <label className="library-form-field">
            <span>{t('editor.magnet-library.magnet.variant.label')}</span>
            <select
              value={currentVariant}
              onChange={(event) => handleRendererVariantChange(magnet, event.target.value)}
            >
              <option value="">{t('editor.magnet-library.magnet.variant.default')}</option>
              {rendererVariants.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
              {currentVariant && !currentVariantKnown ? (
                <option value={currentVariant}>
                  {t('editor.magnet-library.magnet.variant.unknown', { variant: currentVariant })}
                </option>
              ) : null}
            </select>
          </label>
          <div className="library-opacity-control">
            <div className="magnet-opacity-label">
              {t('editor.magnet-library.magnet.opacity.label')}
            </div>
            <div className="magnet-opacity-slider-row">
              <div className="magnet-opacity-slider-shell">
                <div className="magnet-opacity-slider-track">
                  <div className="magnet-opacity-slider-grid" />
                  <div
                    className="magnet-opacity-slider-fill"
                    style={{ width: `${magnetRendererOpacityPercent}%` }}
                  />
                </div>
                <input
                  className="magnet-opacity-slider"
                  type="range"
                  min={MAGNET_RENDERER_OPACITY_MIN}
                  max={MAGNET_RENDERER_OPACITY_MAX}
                  step={MAGNET_RENDERER_OPACITY_STEP}
                  value={magnetRendererOpacity}
                  onChange={(event) => handleRendererOpacityDraftChange(magnet.id, event.target.value)}
                  onPointerUp={() => void commitRendererOpacity(magnet)}
                  onBlur={() => void commitRendererOpacity(magnet)}
                  onKeyUp={(event) => {
                    if (event.key === 'Enter') {
                      void commitRendererOpacity(magnet);
                    }
                  }}
                />
              </div>
              <span className="magnet-opacity-value">
                {t('editor.magnet-library.magnet.opacity.value', {
                  percent: magnetRendererOpacityPercent,
                })}
              </span>
            </div>
          </div>
          <div className="library-detail-note">
            {t('editor.magnet-library.detail.themeHint')}
          </div>
        </div>

        <div className="library-form-section">
          <div className="library-detail-section-title">
            {t('editor.magnet-library.detail.definition')}
          </div>
          <div className="library-code-grid">
            <div>
              <div className="library-code-title">{t('editor.magnet-library.detail.anchors')}</div>
              <pre>{stringifyEditorJson(magnet.anchors, [])}</pre>
            </div>
            <div>
              <div className="library-code-title">{t('editor.magnet-library.detail.bounds')}</div>
              <pre>{stringifyEditorJson(magnet.bounds, {})}</pre>
            </div>
            <div>
              <div className="library-code-title">{t('editor.magnet-library.detail.chrome')}</div>
              <pre>{stringifyEditorJson(magnet.chrome, {})}</pre>
            </div>
            <div>
              <div className="library-code-title">{t('editor.magnet-library.detail.skinProps')}</div>
              <pre>{stringifyEditorJson(magnet.skinProps, {})}</pre>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="editor-magnet-library">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.library.title')}
        </span>
      </div>

      <div className="editor-window-content library-studio-content">
        <aside className="library-sidebar">
          <div className="library-sidebar-toolbar">
            <button
              className={`view-btn ${viewMode === 'active' ? 'active' : ''}`}
              type="button"
              onClick={() => setViewMode('active')}
            >
              {t('editor.magnet-library.view.active', { count: counts.active.total })}
            </button>
            <button
              className={`view-btn ${viewMode === 'inactive' ? 'active' : ''}`}
              type="button"
              onClick={() => setViewMode('inactive')}
            >
              {t('editor.magnet-library.view.inactive', { count: counts.inactive.total })}
            </button>
          </div>

          <div className="library-filter-row">
            <button
              className={`filter-btn ${filterMode === 'all' ? 'active' : ''}`}
              type="button"
              onClick={() => setFilterMode('all')}
            >
              {t('editor.magnet-library.filter.all', { count: counts[viewMode].all })}
            </button>
            <button
              className={`filter-btn ${filterMode === 'builtin' ? 'active' : ''}`}
              type="button"
              onClick={() => setFilterMode('builtin')}
            >
              {t('editor.magnet-library.filter.builtin', { count: counts[viewMode].builtin })}
            </button>
            <button
              className={`filter-btn ${filterMode === 'custom' ? 'active' : ''}`}
              type="button"
              onClick={() => setFilterMode('custom')}
            >
              {t('editor.magnet-library.filter.custom', { count: counts[viewMode].custom })}
            </button>
            <button
              className={`filter-btn ${filterMode === 'fixed' ? 'active' : ''}`}
              type="button"
              onClick={() => setFilterMode('fixed')}
            >
              {t('editor.magnet-library.filter.fixed', { count: counts[viewMode].fixed })}
            </button>
          </div>

          <div className="library-search-row">
            <input
              className="library-search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('editor.magnet-library.search.placeholder')}
            />
            {searchQuery.trim().length > 0 ? (
              <button
                className="library-search-clear-btn"
                type="button"
                onClick={() => setSearchQuery('')}
                title={t('editor.magnet-library.search.clearTitle')}
              >
                x
              </button>
            ) : null}
            <div className="library-search-count" title={t('editor.magnet-library.search.countTitle')}>
              {displayMagnets.length}
            </div>
          </div>

          <button className="library-create-btn" type="button" onClick={startCreateMagnet}>
            {t('editor.magnet-library.action.newCustom')}
          </button>

          <div className="library-list" role="listbox" aria-label={t('windows.editor.library.title')}>
            {displayMagnets.length === 0 ? (
              <div className="empty-state">
                {viewMode === 'active'
                  ? t('editor.magnet-library.empty.active')
                  : t('editor.magnet-library.empty.inactive')}
                {filterMode !== 'all' ? (
                  <div className="empty-hint">{t('editor.magnet-library.empty.hint')}</div>
                ) : null}
              </div>
            ) : (
              displayMagnets.map((magnet) => {
                const isBuiltIn = builtInMagnetIds.has(magnet.id);
                const isActive = activeMagnetIds.has(magnet.id);
                const isRequired = REQUIRED_MAGNET_IDS.has(magnet.id);
                const magnetDisplayName = getMagnetDisplayName(magnet, t);
                const pixelCount = estimateMagnetPixelCount(magnet);
                const chromeEnabled = magnet.chrome?.enabled !== false;
                const rendererId = magnet.renderer ?? magnet.id;
                const renderer =
                  getMagnetRenderer(rendererId) ??
                  (rendererId === magnet.id ? null : getMagnetRenderer(magnet.id));
                const rendererGroup = renderer?.group;
                const currentVariant = magnet.variant ?? '';

                const registryPreview = getMagnetPreviewNode(magnet);
                let previewContent: ReactNode = registryPreview ?? null;
                if (!previewContent) {
                  const content = magnet.content;
                  if (typeof content === 'string' || typeof content === 'number') {
                    previewContent = content;
                  } else if (isValidElement(content)) {
                    previewContent = content;
                  } else if (content === null || content === undefined) {
                    previewContent = magnetDisplayName;
                  } else {
                    previewContent = `[${magnetDisplayName}]`;
                  }
                }

                return (
                  <button
                    key={magnet.id}
                    type="button"
                    className={`magnet-item library-list-item ${
                      selectedMagnet?.id === magnet.id && detailEditorMode !== 'create'
                        ? 'library-list-item--selected'
                        : ''
                    } ${highlightedMagnetId === magnet.id ? 'magnet-item--focused' : ''}`}
                    data-magnet-id={magnet.id}
                    role="option"
                    aria-selected={selectedMagnet?.id === magnet.id && detailEditorMode !== 'create'}
                    onClick={() => {
                      setSelectedMagnetId(magnet.id);
                      setDetailEditorMode('view');
                      setDetailDraft(null);
                      setDetailErrors([]);
                    }}
                  >
                    <span
                      className="magnet-preview"
                      style={{
                        color: chromeEnabled ? magnet.style.color : undefined,
                        borderRadius: magnet.style.borderRadius,
                      }}
                    >
                      <span
                        className="magnet-preview-underlay"
                        style={{
                          backgroundColor: chromeEnabled
                            ? toOpaquePreviewColor(magnet.style.backgroundColor)
                            : 'transparent',
                          border: chromeEnabled
                            ? magnet.style.border
                            : '1px dashed rgba(255,255,255,0.18)',
                        }}
                      />
                      <span className="magnet-preview-content">{previewContent}</span>
                    </span>
                    <span className="magnet-body">
                      <span className="magnet-info">
                        <span className="magnet-name">{magnetDisplayName}</span>
                        <span className="magnet-id">{magnet.id}</span>
                        <span className="magnet-meta">
                          {rendererGroup ? (
                            <span className="magnet-group">{formatRendererGroup(rendererGroup)}</span>
                          ) : null}
                          <span className="magnet-type">{magnet.type}</span>
                          <span className="magnet-anchor">{magnet.anchorType}</span>
                          <span className="magnet-pixels">
                            {t('editor.magnet-library.magnet.pixels', { count: pixelCount })}
                          </span>
                          {currentVariant ? (
                            <span className="magnet-variant-tag">
                              {t('editor.magnet-library.magnet.variant.current', {
                                variant: currentVariant,
                              })}
                            </span>
                          ) : null}
                          {isActive ? (
                            <span className="magnet-badge active">
                              {t('editor.magnet-library.detail.active')}
                            </span>
                          ) : null}
                          {isRequired ? (
                            <span className="magnet-badge builtin">
                              {t('editor.magnet-library.badge.required')}
                            </span>
                          ) : null}
                          {isBuiltIn ? (
                            <span className="magnet-badge builtin">
                              {t('editor.magnet-library.badge.builtin')}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="library-detail-panel">
          {detailEditorMode === 'create' && detailDraft
            ? renderDraftEditor(null, detailDraft)
            : detailEditorMode === 'edit' && detailDraft && selectedMagnet
              ? renderDraftEditor(selectedMagnet, detailDraft)
              : selectedMagnet
                ? renderDetailView(selectedMagnet)
                : (
                  <div className="library-detail-empty">
                    {t('editor.magnet-library.detail.empty')}
                  </div>
                )}
        </section>
      </div>
      {confirmDialog}
    </div>
  );
});


