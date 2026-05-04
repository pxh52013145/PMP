import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { readString, removeKey, usePersistentSetting, writeString } from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate, setupTauriListener } from '../../utils/windowCommunication';
import { useT } from '../../i18n';
import {
  createDefaultMagnetSpaceLayout,
  createDefaultMagnetSpacesState,
  createInitialMagnetSpaceTemplateLayout,
  createNextSpaceId,
  ensureMagnetSpaceLayout,
  magnetLayoutStoreApplyPatch,
  magnetLayoutStoreBootstrap,
  magnetLayoutStoreGetState,
  loadMagnetConfig,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  saveMagnetSpaceLayout,
  sanitizeMagnetSpacesState,
  sanitizeMagnetSpaceLayout,
  type MagnetLayoutStoreState,
  type MagnetSpacePreset,
  type MagnetSpaceHistoryItem,
  type MagnetSpaceLayout,
  useMagnetConfig,
} from '../../modules/magnets';
import { DEFAULT_ACTIVE_MAGNET_IDS, REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { PixelAnchor } from '../../types/pixel';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { ConfirmDialog } from './ConfirmDialog';
import { InputDialog } from './InputDialog';
import { buildMagnetVariantRenderers } from './shared/magnetVariantCatalog';
import { useResolvedMagnetSkinRenderer } from './shared/useResolvedMagnetSkinRenderer';
import { MATRIX_CHANGE_VARIANT_PRESETS, parseMatrixChangeSkinProps } from './matrixChangeSkin';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import './MatrixChangeMagnet.css';

const MAX_HISTORY_PER_SPACE = 20;
const telemetry = getTelemetryLogger('magnets', 'MatrixChangeMagnet');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSpaceBadge(spaceId: string): string {
  const match = spaceId.match(/^space(\d+)$/);
  if (match) return `S${match[1]}`;
  return 'S';
}

type MatrixChangeDialogState =
  | { kind: 'create'; newId: string; nextOrder: number; defaultName: string }
  | { kind: 'clone'; sourceSpaceId: string; newId: string; nextOrder: number; defaultName: string }
  | { kind: 'rename'; spaceId: string; currentName: string }
  | { kind: 'delete'; spaceId: string; spaceName: string }
  | { kind: 'clear'; spaceId: string; spaceName: string }
  | { kind: 'reset'; spaceId: string; spaceName: string }
  | null;

function clonePixelAnchors(anchors: PixelAnchor[]): PixelAnchor[] {
  return anchors.map((anchor) => ({ ...anchor }));
}

function createMagnetSpacePresetId(): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `preset-${Date.now()}-${random}`;
}

function createMagnetSpaceHistoryItemId(): string {
  const random = Math.random().toString(36).slice(2, 9);
  return `history-${Date.now()}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeMagnetSpacePresetsState(raw: unknown): Record<string, MagnetSpacePreset[]> {
  if (!isRecord(raw)) return {};
  const result: Record<string, MagnetSpacePreset[]> = {};
  for (const [spaceId, listRaw] of Object.entries(raw)) {
    if (!Array.isArray(listRaw)) continue;
    const seen = new Set<string>();
    const presets: MagnetSpacePreset[] = [];
    for (const entry of listRaw) {
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!id || !name) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const createdAtRaw = entry.createdAt;
      const createdAt = typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
      presets.push({
        id,
        name,
        createdAt,
        layout: sanitizeMagnetSpaceLayout(entry.layout),
      });
    }
    if (presets.length > 0) result[spaceId] = presets;
  }
  return result;
}

function sanitizeMagnetSpaceHistoryState(raw: unknown): Record<string, MagnetSpaceHistoryItem[]> {
  if (!isRecord(raw)) return {};
  const result: Record<string, MagnetSpaceHistoryItem[]> = {};
  for (const [spaceId, listRaw] of Object.entries(raw)) {
    if (!Array.isArray(listRaw)) continue;
    const seen = new Set<string>();
    const items: MagnetSpaceHistoryItem[] = [];
    for (const entry of listRaw) {
      if (!isRecord(entry)) continue;
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const createdAtRaw = entry.createdAt;
      const createdAt = typeof createdAtRaw === 'number' && Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
      items.push({
        id,
        reason,
        createdAt,
        layout: sanitizeMagnetSpaceLayout(entry.layout),
      });
    }
    if (items.length > MAX_HISTORY_PER_SPACE) {
      items.sort((a, b) => a.createdAt - b.createdAt);
      items.splice(0, items.length - MAX_HISTORY_PER_SPACE);
    }
    if (items.length > 0) result[spaceId] = items;
  }
  return result;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

type MatrixChangeRendererProps = {
  skinProps?: Record<string, unknown>;
};

function MatrixChangeMagnetDefaultRenderer({ skinProps: rawSkinProps }: MatrixChangeRendererProps) {
  const skinProps = useMemo(() => parseMatrixChangeSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();
  const { magnetLibrary, activeMagnetIds, setActiveMagnetIds, setMagnetLibrary, reloadFromStorage } =
    useMagnetConfig();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const defaultSpacesState = useMemo(() => createDefaultMagnetSpacesState(), []);
  const [spacesRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACES, defaultSpacesState, {
    format: 'json',
  });
  const storedSpacesState = useMemo(() => sanitizeMagnetSpacesState(spacesRaw), [spacesRaw]);
  const [layoutStoreState, setLayoutStoreState] = useState<MagnetLayoutStoreState | null>(null);
  const storeRevisionRef = useRef(0);

  const defaultPresetsState = useMemo(() => ({} as Record<string, MagnetSpacePreset[]>), []);
  const [presetsRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACE_PRESETS, defaultPresetsState, {
    format: 'json',
  });
  const storedPresetsState = useMemo(() => sanitizeMagnetSpacePresetsState(presetsRaw), [presetsRaw]);

  const defaultHistoryState = useMemo(() => ({} as Record<string, MagnetSpaceHistoryItem[]>), []);
  const [historyRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACE_HISTORY, defaultHistoryState, {
    format: 'json',
  });
  const storedHistoryState = useMemo(() => sanitizeMagnetSpaceHistoryState(historyRaw), [historyRaw]);

  const spacesState = useMemo(() => {
    if (isTauri && layoutStoreState) return layoutStoreState.spaces;
    return storedSpacesState;
  }, [isTauri, layoutStoreState, storedSpacesState]);

  const presetsState = useMemo(() => {
    if (isTauri && layoutStoreState) return layoutStoreState.presetsBySpaceId;
    return storedPresetsState;
  }, [isTauri, layoutStoreState, storedPresetsState]);

  const historyState = useMemo(() => {
    if (isTauri && layoutStoreState) return layoutStoreState.historyBySpaceId;
    return storedHistoryState;
  }, [isTauri, layoutStoreState, storedHistoryState]);

  const refreshLayoutStoreState = useCallback(async () => {
    if (!isTauri) return;
    const state = await magnetLayoutStoreGetState();
    if (!state) return;
    storeRevisionRef.current = state.revision;
    setLayoutStoreState(state);
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;

    const run = async () => {
      const bootstrapped = await magnetLayoutStoreBootstrap();
      const state = bootstrapped?.state ?? (await magnetLayoutStoreGetState());
      if (disposed || !state) return;
      storeRevisionRef.current = state.revision;
      setLayoutStoreState(state);
    };

    void run();

    return () => {
      disposed = true;
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const cleanupPromise = setupTauriListener(TAURI_EVENTS.MAGNET_LAYOUT_STORE_UPDATED, () => {
      void refreshLayoutStoreState();
    });
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri, refreshLayoutStoreState]);
  const activeSpaceId = spacesState.activeSpaceId;
  const activeSpace = useMemo(
    () => spacesState.spaces.find((s) => s.id === activeSpaceId) ?? null,
    [activeSpaceId, spacesState.spaces]
  );
  const badge = useMemo(() => getSpaceBadge(activeSpaceId), [activeSpaceId]);

  const [panel, setPanel] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dialog, setDialog] = useState<MatrixChangeDialogState>(null);
  const [presetsDialogOpen, setPresetsDialogOpen] = useState(false);
  const [presetNameDialog, setPresetNameDialog] = useState<{ defaultName: string } | null>(null);
  const [deletePresetDialog, setDeletePresetDialog] = useState<{ presetId: string; presetName: string } | null>(
    null
  );
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [deleteHistoryDialog, setDeleteHistoryDialog] = useState<{ historyId: string; label: string } | null>(null);
  const [clearHistoryDialogOpen, setClearHistoryDialogOpen] = useState(false);

  const presetsForActiveSpace = useMemo(
    () => presetsState[activeSpaceId] ?? [],
    [activeSpaceId, presetsState]
  );

  const historyForActiveSpace = useMemo(
    () => historyState[activeSpaceId] ?? [],
    [activeSpaceId, historyState]
  );

  const applyLayoutStorePatch = useCallback(
    async (patches: Parameters<typeof magnetLayoutStoreApplyPatch>[0]['patches'], reason: string) => {
      if (!isTauri) return;
      let expectedRevision = storeRevisionRef.current;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const attemptReason = attempt === 0 ? reason : `${reason}:retry${attempt === 1 ? '' : attempt}`;
        const response = await magnetLayoutStoreApplyPatch({ expectedRevision, patches, reason: attemptReason });
        if (!response) {
          telemetry.warn('layout_store.apply_patch.no_response', {
            fields: {
              reason: attemptReason,
              patchCount: patches.length,
            },
          });
          return;
        }

        storeRevisionRef.current = response.state.revision;
        setLayoutStoreState(response.state);

        if (response.ok) return;
        if (response.error?.code !== 'revisionConflict') {
          telemetry.warn('layout_store.apply_patch.failed', {
            message: response.error?.message ?? 'Failed to apply layout store patch.',
            fields: {
              reason: attemptReason,
              patchCount: patches.length,
              errorCode: response.error?.code ?? null,
            },
          });
          return;
        }

        const retryRevision = response.state.revision;
        if (retryRevision <= 0 || retryRevision === expectedRevision) {
          telemetry.warn('layout_store.apply_patch.revision_conflict_stalled', {
            fields: {
              reason: attemptReason,
              expectedRevision,
              retryRevision,
            },
          });
          return;
        }
        expectedRevision = retryRevision;
      }
    },
    [isTauri]
  );

  const switchToSpace = useCallback(
    (nextSpaceId: string) => {
      if (!nextSpaceId || nextSpaceId === activeSpaceId) return;
      if (!isTauri) {
        const nextState = { ...spacesState, activeSpaceId: nextSpaceId };
        void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, nextState, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
        return;
      }
      void applyLayoutStorePatch([{ kind: 'setActiveSpaceId', spaceId: nextSpaceId }], 'switchToSpace');
    },
    [activeSpaceId, applyLayoutStorePatch, isTauri, spacesState]
  );

  const copySpaceStorage = useCallback((sourceSpaceId: string, destSpaceId: string) => {
    if (!isTauri) {
      const layout = ensureMagnetSpaceLayout(sourceSpaceId).layout;
      saveMagnetSpaceLayout(layout, resolveMagnetLayoutStorageKey(destSpaceId));
    }

    const sourceConfigKey = resolveMagnetConfigStorageKey(sourceSpaceId);
    const destConfigKey = resolveMagnetConfigStorageKey(destSpaceId);
    const sourceConfig = loadMagnetConfig(sourceConfigKey);
    const raw = readString(sourceConfigKey);
    if (!sourceConfig || !raw) {
      removeKey(destConfigKey);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'object' && parsed !== null) {
        (parsed as { customMagnets?: unknown }).customMagnets = [];
      }
      writeString(destConfigKey, JSON.stringify(parsed));
    } catch {
      writeString(destConfigKey, JSON.stringify({ ...sourceConfig, customMagnets: [] }));
    }
  }, [isTauri]);

  const closePanel = useCallback(() => {
    setPanel((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  const togglePanelAt = useCallback((x: number, y: number) => {
    setPanel((prev) => (prev.open ? { ...prev, open: false } : { open: true, x, y }));
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanelAt(e.clientX + 8, e.clientY + 8);
    },
    [togglePanelAt]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      togglePanelAt(e.clientX + 8, e.clientY + 8);
    },
    [togglePanelAt]
  );

  useEffect(() => {
    if (!panel.open) return;

    const clampPanelToViewport = () => {
      const node = panelRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const margin = 10;
      const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
      const nextLeft = Math.min(Math.max(panel.x, margin), maxLeft);
      const nextTop = Math.min(Math.max(panel.y, margin), maxTop);
      if (nextLeft === panel.x && nextTop === panel.y) return;
      setPanel((prev) => (prev.open ? { ...prev, x: nextLeft, y: nextTop } : prev));
    };

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      closePanel();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };

    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', clampPanelToViewport);
    clampPanelToViewport();
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', clampPanelToViewport);
    };
  }, [closePanel, panel.open, panel.x, panel.y]);

  const openCreateDialog = useCallback(() => {
    const newId = createNextSpaceId(spacesState);
    const nextOrder =
      Math.max(0, ...spacesState.spaces.map((s) => (Number.isFinite(s.order) ? s.order : 0))) + 1;
    const match = newId.match(/^space(\d+)$/);
    const defaultName = t('magnet.matrix-change.space.defaultName', { order: match?.[1] ?? nextOrder });

    setDialog({ kind: 'create', newId, nextOrder, defaultName });
    closePanel();
  }, [closePanel, spacesState, t]);

  const openCloneDialog = useCallback(() => {
    if (!activeSpace) return;
    const newId = createNextSpaceId(spacesState);
    const nextOrder =
      Math.max(0, ...spacesState.spaces.map((s) => (Number.isFinite(s.order) ? s.order : 0))) + 1;
    const defaultName = t('magnet.matrix-change.space.cloneName', { name: activeSpace.name });

    setDialog({ kind: 'clone', sourceSpaceId: activeSpace.id, newId, nextOrder, defaultName });
    closePanel();
  }, [activeSpace, closePanel, spacesState, t]);

  const openRenameDialog = useCallback(() => {
    if (!activeSpace) return;
    setDialog({ kind: 'rename', spaceId: activeSpace.id, currentName: activeSpace.name });
    closePanel();
  }, [activeSpace, closePanel]);

  const openDeleteDialog = useCallback(() => {
    if (!skinProps.showDangerActions) return;
    if (!activeSpace) return;
    if (activeSpace.id === 'space1') return;
    if (spacesState.spaces.length <= 1) return;
    setDialog({ kind: 'delete', spaceId: activeSpace.id, spaceName: activeSpace.name });
    closePanel();
  }, [activeSpace, closePanel, skinProps.showDangerActions, spacesState.spaces.length]);

  const openClearDialog = useCallback(() => {
    if (!skinProps.showDangerActions) return;
    setDialog({
      kind: 'clear',
      spaceId: activeSpaceId,
      spaceName: activeSpace?.name ?? activeSpaceId,
    });
    closePanel();
  }, [activeSpace?.name, activeSpaceId, closePanel, skinProps.showDangerActions]);

  const openResetDialog = useCallback(() => {
    if (!skinProps.showDangerActions) return;
    setDialog({
      kind: 'reset',
      spaceId: activeSpaceId,
      spaceName: activeSpace?.name ?? activeSpaceId,
    });
    closePanel();
  }, [activeSpace?.name, activeSpaceId, closePanel, skinProps.showDangerActions]);

  const closeDialog = useCallback(() => setDialog(null), []);

  const closePresetsDialog = useCallback(() => {
    setPresetsDialogOpen(false);
    setPresetNameDialog(null);
    setDeletePresetDialog(null);
  }, []);

  const openPresetsDialog = useCallback(() => {
    if (!skinProps.showPresetsAction) return;
    setPresetsDialogOpen(true);
    closePanel();
  }, [closePanel, skinProps.showPresetsAction]);

  const closeHistoryDialog = useCallback(() => {
    setHistoryDialogOpen(false);
    setDeleteHistoryDialog(null);
    setClearHistoryDialogOpen(false);
  }, []);

  const openHistoryDialog = useCallback(() => {
    if (!skinProps.showHistoryAction) return;
    setHistoryDialogOpen(true);
    closePanel();
  }, [closePanel, skinProps.showHistoryAction]);

  useEffect(() => {
    if (skinProps.showPresetsAction) return;
    setPresetsDialogOpen(false);
    setPresetNameDialog(null);
    setDeletePresetDialog(null);
  }, [skinProps.showPresetsAction]);

  useEffect(() => {
    if (skinProps.showHistoryAction) return;
    setHistoryDialogOpen(false);
    setDeleteHistoryDialog(null);
    setClearHistoryDialogOpen(false);
  }, [skinProps.showHistoryAction]);

  useEffect(() => {
    if (skinProps.showDangerActions) return;
    setDialog((prev) =>
      prev && (prev.kind === 'delete' || prev.kind === 'clear' || prev.kind === 'reset') ? null : prev
    );
  }, [skinProps.showDangerActions]);

  useEffect(() => {
    if (!presetsDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePresetsDialog();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [closePresetsDialog, presetsDialogOpen]);

  useEffect(() => {
    if (!historyDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHistoryDialog();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [closeHistoryDialog, historyDialogOpen]);

  const formatHistoryReason = useCallback(
    (reason: string): string => {
      switch (reason) {
        case 'enterEdit':
          return t('magnet.matrix-change.history.reason.enterEdit');
        case 'applyPreset':
          return t('magnet.matrix-change.history.reason.applyPreset');
        case 'applySystemPreset':
          return t('magnet.matrix-change.history.reason.applySystemPreset');
        case 'restoreHistory':
          return t('magnet.matrix-change.history.reason.restoreHistory');
        case 'clearSpaceLayout':
          return t('magnet.matrix-change.history.reason.clearSpaceLayout');
        case 'resetSpaceLayout':
          return t('magnet.matrix-change.history.reason.resetSpaceLayout');
        default:
          return t('magnet.matrix-change.history.reason.fallback', { reason: reason || '?' });
      }
    },
    [t]
  );

  const formatHistoryTime = useCallback((createdAt: number): string => {
    try {
      return new Date(createdAt).toLocaleString();
    } catch {
      return '';
    }
  }, []);

  const buildCurrentLayoutSnapshot = useCallback((): MagnetSpaceLayout => {
    const active = new Set<string>();
    for (const id of activeMagnetIds) active.add(id);
    for (const id of REQUIRED_MAGNET_IDS) active.add(id);
    const anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {};
    for (const magnet of magnetLibrary) {
      if (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) continue;
      anchorsByMagnetId[magnet.id] = clonePixelAnchors(magnet.anchors);
    }
    return { version: 1, activeMagnetIds: [...active], anchorsByMagnetId };
  }, [activeMagnetIds, magnetLibrary]);

  const buildSystemDefaultLayout = useCallback((): MagnetSpaceLayout => {
    return createDefaultMagnetSpaceLayout('space1', DEFAULT_ACTIVE_MAGNET_IDS);
  }, []);

  const createHistorySnapshotItem = useCallback(
    (reason: string): MagnetSpaceHistoryItem => {
      return {
        id: createMagnetSpaceHistoryItemId(),
        reason,
        createdAt: Date.now(),
        layout: buildCurrentLayoutSnapshot(),
      };
    },
    [buildCurrentLayoutSnapshot]
  );

  const applyPresetLayout = useCallback(
    async (layout: MagnetSpaceLayout, reason: string) => {
      const historyItem = createHistorySnapshotItem(reason);
      if (isTauri) {
        await applyLayoutStorePatch(
          [
            { kind: 'pushSpaceHistory', spaceId: activeSpaceId, item: historyItem },
            { kind: 'setSpaceLayout', spaceId: activeSpaceId, layout },
          ],
          reason
        );
        reloadFromStorage();
        return;
      }
      const nextHistory = sanitizeMagnetSpaceHistoryState({
        ...historyState,
        [activeSpaceId]: [...historyForActiveSpace, historyItem],
      });
      void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_HISTORY, nextHistory);
      saveMagnetSpaceLayout(layout, resolveMagnetLayoutStorageKey(activeSpaceId));
      reloadFromStorage();
    },
    [
      activeSpaceId,
      applyLayoutStorePatch,
      createHistorySnapshotItem,
      historyForActiveSpace,
      historyState,
      isTauri,
      reloadFromStorage,
    ]
  );

  const shortcutPrefixActiveRef = useRef(false);
  const shortcutPrefixResetTimeoutRef = useRef<number | null>(null);
  useEffect(() => {
    const resetPrefix = () => {
      shortcutPrefixActiveRef.current = false;
      if (shortcutPrefixResetTimeoutRef.current !== null) {
        window.clearTimeout(shortcutPrefixResetTimeoutRef.current);
        shortcutPrefixResetTimeoutRef.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        shortcutPrefixActiveRef.current = true;
        if (shortcutPrefixResetTimeoutRef.current !== null) {
          window.clearTimeout(shortcutPrefixResetTimeoutRef.current);
        }
        shortcutPrefixResetTimeoutRef.current = window.setTimeout(resetPrefix, 1500);
        return;
      }

      if (!shortcutPrefixActiveRef.current) return;
      const match = e.key.match(/^[1-9]$/);
      if (!match) return;

      const targetSpaceId = `space${match[0]}`;
      const exists = spacesState.spaces.some((space) => space.id === targetSpaceId);
      if (!exists) return;

      e.preventDefault();
      switchToSpace(targetSpaceId);
      resetPrefix();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 's' || e.key === 'S') {
        resetPrefix();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      resetPrefix();
    };
  }, [spacesState.spaces, switchToSpace]);

  return (
    <>
      <button
        type="button"
        className="matrix-change-magnet"
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={
          t('magnet.matrix-change.tooltip', {
            name: activeSpace?.name ?? activeSpaceId,
            badge,
          })
        }
      >
        <span className="matrix-change-magnet-badge">{badge}</span>
        {skinProps.showLabel ? <span>{t('magnet.matrix-change.button')}</span> : null}
      </button>

      {panel.open && (
        typeof document === 'undefined'
          ? null
          : createPortal(
              <div
                ref={panelRef}
                className="matrix-change-magnet-panel"
                style={{ left: panel.x, top: panel.y }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="matrix-change-magnet-panel-header">
                  <div className="matrix-change-magnet-panel-title">{t('magnet.matrix-change.panel.title')}</div>
                  <div className="matrix-change-magnet-panel-subtitle">
                    {t('magnet.matrix-change.panel.current', { name: activeSpace?.name ?? activeSpaceId })}
                  </div>
                </div>

                <div className="matrix-change-magnet-panel-list">
                  {spacesState.spaces.map((space) => {
                    const isActive = space.id === activeSpaceId;
                    return (
                      <button
                        key={space.id}
                        type="button"
                        className={`matrix-change-magnet-panel-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          switchToSpace(space.id);
                          closePanel();
                        }}
                      >
                        <span className="matrix-change-magnet-panel-item-badge">{getSpaceBadge(space.id)}</span>
                        <span className="matrix-change-magnet-panel-item-name">{space.name}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="matrix-change-magnet-panel-actions">
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openCreateDialog}
                  >
                    + {t('magnet.matrix-change.action.create')}
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openCloneDialog}
                    disabled={!activeSpace}
                  >
                    {t('magnet.matrix-change.action.clone')}
                  </button>
                  {skinProps.showPresetsAction ? (
                    <button
                      type="button"
                      className="matrix-change-magnet-panel-action"
                      onClick={openPresetsDialog}
                    >
                      {t('magnet.matrix-change.action.presets')}
                    </button>
                  ) : null}
                  {skinProps.showHistoryAction ? (
                    <button
                      type="button"
                      className="matrix-change-magnet-panel-action"
                      onClick={openHistoryDialog}
                    >
                      {t('magnet.matrix-change.action.history')}
                    </button>
                  ) : null}
                  {skinProps.showDangerActions ? (
                    <button
                      type="button"
                      className="matrix-change-magnet-panel-action"
                      onClick={openClearDialog}
                    >
                      {t('common.action.clear')}
                    </button>
                  ) : null}
                  {skinProps.showDangerActions ? (
                    <button
                      type="button"
                      className="matrix-change-magnet-panel-action"
                      onClick={openResetDialog}
                    >
                      {t('common.action.reset')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openRenameDialog}
                    disabled={!activeSpace}
                  >
                    {t('common.action.rename')}
                  </button>
                  {skinProps.showDangerActions ? (
                    <button
                      type="button"
                      className="matrix-change-magnet-panel-action danger"
                      onClick={openDeleteDialog}
                      disabled={!activeSpace || activeSpaceId === 'space1' || spacesState.spaces.length <= 1}
                    >
                      {t('common.action.delete')}
                    </button>
                  ) : null}
                </div>
              </div>,
              document.body
            )
      )}

      <InputDialog
        isOpen={dialog?.kind === 'create'}
        title={t('magnet.matrix-change.dialog.create.title')}
        message={t('magnet.matrix-change.dialog.create.message')}
        defaultValue={dialog?.kind === 'create' ? dialog.defaultName : ''}
        confirmText={t('magnet.matrix-change.dialog.create.confirm')}
        cancelText={t('common.action.cancel')}
        onConfirm={(value) => {
          if (!dialog || dialog.kind !== 'create') return;
          const name = value.trim() || dialog.defaultName;
          const nextState = sanitizeMagnetSpacesState({
            ...spacesState,
            activeSpaceId: dialog.newId,
            spaces: [
              ...spacesState.spaces,
              { id: dialog.newId, name, order: dialog.nextOrder, createdAt: Date.now() },
            ],
          });
          if (!isTauri) {
            void broadcastDataUpdate(
              STORAGE_KEYS.MAGNET_SPACES,
              nextState,
              TAURI_EVENTS.MAGNET_SPACES_UPDATED
            );
            closeDialog();
            return;
          }
          void applyLayoutStorePatch([{ kind: 'setSpacesState', spaces: nextState }], 'createSpace');
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <InputDialog
        isOpen={dialog?.kind === 'clone'}
        title={t('magnet.matrix-change.dialog.clone.title')}
        message={t('magnet.matrix-change.dialog.clone.message')}
        defaultValue={dialog?.kind === 'clone' ? dialog.defaultName : ''}
        confirmText={t('magnet.matrix-change.dialog.clone.confirm')}
        cancelText={t('common.action.cancel')}
        onConfirm={(value) => {
          if (!dialog || dialog.kind !== 'clone') return;
          const name = value.trim() || dialog.defaultName;
          try {
            copySpaceStorage(dialog.sourceSpaceId, dialog.newId);
          } catch (error) {
            telemetry.warn('space.clone_storage.failed', {
              message: readErrorMessage(error),
              fields: {
                sourceSpaceId: dialog.sourceSpaceId,
                targetSpaceId: dialog.newId,
              },
            });
          }
          const nextState = sanitizeMagnetSpacesState({
            ...spacesState,
            activeSpaceId: dialog.newId,
            spaces: [
              ...spacesState.spaces,
              { id: dialog.newId, name, order: dialog.nextOrder, createdAt: Date.now() },
            ],
          });
          if (!isTauri) {
            void broadcastDataUpdate(
              STORAGE_KEYS.MAGNET_SPACES,
              nextState,
              TAURI_EVENTS.MAGNET_SPACES_UPDATED
            );
            closeDialog();
            return;
          }

          const sourceLayout = layoutStoreState?.layoutsBySpaceId[dialog.sourceSpaceId];
          if (sourceLayout) {
            void applyLayoutStorePatch(
              [
                { kind: 'setSpacesState', spaces: nextState },
                { kind: 'setSpaceLayout', spaceId: dialog.newId, layout: sourceLayout },
              ],
              'cloneSpace'
            );
          }
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <InputDialog
        isOpen={dialog?.kind === 'rename'}
        title={t('magnet.matrix-change.dialog.rename.title')}
        message={t('magnet.matrix-change.dialog.rename.message')}
        defaultValue={dialog?.kind === 'rename' ? dialog.currentName : ''}
        confirmText={t('common.action.save')}
        cancelText={t('common.action.cancel')}
        onConfirm={(value) => {
          if (!dialog || dialog.kind !== 'rename') return;
          const nextName = value.trim();
          if (!nextName || nextName === dialog.currentName) {
            closeDialog();
            return;
          }
          const nextState = sanitizeMagnetSpacesState({
            ...spacesState,
            spaces: spacesState.spaces.map((s) =>
              s.id === dialog.spaceId ? { ...s, name: nextName } : s
            ),
          });
          if (!isTauri) {
            void broadcastDataUpdate(
              STORAGE_KEYS.MAGNET_SPACES,
              nextState,
              TAURI_EVENTS.MAGNET_SPACES_UPDATED
            );
            closeDialog();
            return;
          }

          void applyLayoutStorePatch([{ kind: 'setSpacesState', spaces: nextState }], 'renameSpace');
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      {presetsDialogOpen &&
        (typeof document === 'undefined'
          ? null
          : createPortal(
              <div className="matrix-change-presets-overlay" onMouseDown={closePresetsDialog}>
                <div className="matrix-change-presets-dialog" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="matrix-change-presets-header">
                    <div className="matrix-change-presets-title">{t('magnet.matrix-change.presets.title')}</div>
                    <div className="matrix-change-presets-subtitle">
                      {t('magnet.matrix-change.presets.subtitle', { name: activeSpace?.name ?? activeSpaceId })}
                    </div>
                  </div>

                  <div className="matrix-change-presets-list">
                    {activeSpaceId === 'space1' && (
                      <div className="matrix-change-presets-item">
                        <div className="matrix-change-presets-item-main">
                          <div className="matrix-change-presets-item-name">
                            {t('magnet.matrix-change.presets.systemDefault')}
                          </div>
                          <div className="matrix-change-presets-item-meta">{t('magnet.matrix-change.presets.systemBadge')}</div>
                        </div>
                        <div className="matrix-change-presets-item-actions">
                          <button
                            type="button"
                            className="matrix-change-presets-item-action primary"
                            onClick={() => {
                              void applyPresetLayout(buildSystemDefaultLayout(), 'applySystemPreset');
                              closePresetsDialog();
                            }}
                          >
                            {t('common.action.apply')}
                          </button>
                        </div>
                      </div>
                    )}

                    {presetsForActiveSpace.length === 0 ? (
                      <div className="matrix-change-presets-empty">
                        {t('magnet.matrix-change.presets.empty')}
                      </div>
                    ) : (
                      presetsForActiveSpace.map((preset) => (
                        <div key={preset.id} className="matrix-change-presets-item">
                          <div className="matrix-change-presets-item-main">
                            <div className="matrix-change-presets-item-name">{preset.name}</div>
                          </div>
                          <div className="matrix-change-presets-item-actions">
                            <button
                              type="button"
                              className="matrix-change-presets-item-action"
                              onClick={() => {
                                void applyPresetLayout(preset.layout, 'applyPreset');
                                closePresetsDialog();
                              }}
                            >
                              {t('common.action.apply')}
                            </button>
                            <button
                              type="button"
                              className="matrix-change-presets-item-action danger"
                              onClick={() => setDeletePresetDialog({ presetId: preset.id, presetName: preset.name })}
                            >
                              {t('common.action.delete')}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="matrix-change-presets-footer">
                    <button
                      type="button"
                      className="matrix-change-presets-footer-btn"
                      onClick={() => {
                        const defaultName = t('magnet.matrix-change.presets.defaultName', {
                          order: presetsForActiveSpace.length + 1,
                        });
                        setPresetNameDialog({ defaultName });
                      }}
                    >
                      {t('magnet.matrix-change.presets.saveCurrent')}
                    </button>
                    <button
                      type="button"
                      className="matrix-change-presets-footer-btn"
                      onClick={closePresetsDialog}
                    >
                      {t('common.action.cancel')}
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            ))}

      <InputDialog
        isOpen={presetNameDialog !== null}
        title={t('magnet.matrix-change.presets.saveDialog.title')}
        message={t('magnet.matrix-change.presets.saveDialog.message')}
        defaultValue={presetNameDialog?.defaultName ?? ''}
        confirmText={t('common.action.save')}
        cancelText={t('common.action.cancel')}
        onConfirm={(value) => {
          const resolved = value.trim() || presetNameDialog?.defaultName || '';
          if (!resolved) {
            setPresetNameDialog(null);
            return;
          }
          const preset: MagnetSpacePreset = {
            id: createMagnetSpacePresetId(),
            name: resolved,
            createdAt: Date.now(),
            layout: buildCurrentLayoutSnapshot(),
          };

          if (isTauri) {
            void applyLayoutStorePatch(
              [{ kind: 'upsertSpacePreset', spaceId: activeSpaceId, preset }],
              'saveSpacePreset'
            );
          } else {
            const next = sanitizeMagnetSpacePresetsState({
              ...presetsState,
              [activeSpaceId]: [...presetsForActiveSpace, preset],
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_PRESETS, next);
          }
          setPresetNameDialog(null);
        }}
        onCancel={() => setPresetNameDialog(null)}
      />

      <ConfirmDialog
        isOpen={deletePresetDialog !== null}
        title={t('magnet.matrix-change.presets.deleteDialog.title')}
        message={
          deletePresetDialog
            ? t('magnet.matrix-change.presets.deleteDialog.message', { name: deletePresetDialog.presetName })
            : ''
        }
        confirmText={t('common.action.delete')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!deletePresetDialog) return;
          const presetId = deletePresetDialog.presetId;
          if (isTauri) {
            void applyLayoutStorePatch(
              [{ kind: 'deleteSpacePreset', spaceId: activeSpaceId, presetId }],
              'deleteSpacePreset'
            );
          } else {
            const nextList = presetsForActiveSpace.filter((p) => p.id !== presetId);
            const next = sanitizeMagnetSpacePresetsState({
              ...presetsState,
              [activeSpaceId]: nextList,
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_PRESETS, next);
          }
          setDeletePresetDialog(null);
        }}
        onCancel={() => setDeletePresetDialog(null)}
      />

      {historyDialogOpen &&
        (typeof document === 'undefined'
          ? null
          : createPortal(
              <div className="matrix-change-history-overlay" onMouseDown={closeHistoryDialog}>
                <div className="matrix-change-history-dialog" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="matrix-change-history-header">
                    <div className="matrix-change-history-title">{t('magnet.matrix-change.history.title')}</div>
                    <div className="matrix-change-history-subtitle">
                      {t('magnet.matrix-change.history.subtitle', { name: activeSpace?.name ?? activeSpaceId })}
                    </div>
                  </div>

                  <div className="matrix-change-history-list">
                    {historyForActiveSpace.length === 0 ? (
                      <div className="matrix-change-history-empty">{t('magnet.matrix-change.history.empty')}</div>
                    ) : (
                      [...historyForActiveSpace]
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .map((item) => {
                          const label = `${formatHistoryReason(item.reason)} · ${formatHistoryTime(item.createdAt)}`;
                          return (
                            <div key={item.id} className="matrix-change-history-item">
                              <div className="matrix-change-history-item-main">
                                <div className="matrix-change-history-item-name">{formatHistoryReason(item.reason)}</div>
                                <div className="matrix-change-history-item-meta">{formatHistoryTime(item.createdAt)}</div>
                              </div>
                              <div className="matrix-change-history-item-actions">
                                <button
                                  type="button"
                                  className="matrix-change-history-item-action"
                                  onClick={() => {
                                    void applyPresetLayout(item.layout, 'restoreHistory');
                                    closeHistoryDialog();
                                  }}
                                >
                                  {t('common.action.apply')}
                                </button>
                                <button
                                  type="button"
                                  className="matrix-change-history-item-action danger"
                                  onClick={() => setDeleteHistoryDialog({ historyId: item.id, label })}
                                >
                                  {t('common.action.delete')}
                                </button>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>

                  <div className="matrix-change-history-footer">
                    <button
                      type="button"
                      className="matrix-change-history-footer-btn"
                      disabled={historyForActiveSpace.length === 0}
                      onClick={() => setClearHistoryDialogOpen(true)}
                    >
                      {t('common.action.clear')}
                    </button>
                    <button
                      type="button"
                      className="matrix-change-history-footer-btn"
                      onClick={closeHistoryDialog}
                    >
                      {t('common.action.cancel')}
                    </button>
                  </div>
                </div>
              </div>,
              document.body
            ))}

      <ConfirmDialog
        isOpen={deleteHistoryDialog !== null}
        title={t('magnet.matrix-change.history.deleteDialog.title')}
        message={
          deleteHistoryDialog
            ? t('magnet.matrix-change.history.deleteDialog.message', { label: deleteHistoryDialog.label })
            : ''
        }
        confirmText={t('common.action.delete')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!deleteHistoryDialog) return;
          const historyId = deleteHistoryDialog.historyId;
          if (isTauri) {
            void applyLayoutStorePatch(
              [{ kind: 'deleteSpaceHistoryItem', spaceId: activeSpaceId, historyId }],
              'deleteSpaceHistoryItem'
            );
          } else {
            const nextList = historyForActiveSpace.filter((item) => item.id !== historyId);
            const next = sanitizeMagnetSpaceHistoryState({
              ...historyState,
              [activeSpaceId]: nextList,
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_HISTORY, next);
          }
          setDeleteHistoryDialog(null);
        }}
        onCancel={() => setDeleteHistoryDialog(null)}
      />

      <ConfirmDialog
        isOpen={clearHistoryDialogOpen}
        title={t('magnet.matrix-change.history.clearDialog.title')}
        message={t('magnet.matrix-change.history.clearDialog.message', { name: activeSpace?.name ?? activeSpaceId })}
        confirmText={t('common.action.clear')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (isTauri) {
            void applyLayoutStorePatch([{ kind: 'clearSpaceHistory', spaceId: activeSpaceId }], 'clearSpaceHistory');
          } else {
            const next = sanitizeMagnetSpaceHistoryState({
              ...historyState,
              [activeSpaceId]: [],
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_HISTORY, next);
          }
          setClearHistoryDialogOpen(false);
        }}
        onCancel={() => setClearHistoryDialogOpen(false)}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'delete'}
        title={t('magnet.matrix-change.dialog.delete.title')}
        message={
          dialog?.kind === 'delete'
            ? t('magnet.matrix-change.dialog.delete.message', { name: dialog.spaceName })
            : ''
        }
        confirmText={t('common.action.delete')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!dialog || dialog.kind !== 'delete') return;
          if (dialog.spaceId === 'space1') {
            closeDialog();
            return;
          }
          const remaining = spacesState.spaces.filter((s) => s.id !== dialog.spaceId);
          const nextActive = remaining[0]?.id ?? 'space1';
          const nextState = sanitizeMagnetSpacesState({
            ...spacesState,
            activeSpaceId: nextActive,
            spaces: remaining,
          });
          if (!isTauri) {
            void broadcastDataUpdate(
              STORAGE_KEYS.MAGNET_SPACES,
              nextState,
              TAURI_EVENTS.MAGNET_SPACES_UPDATED
            );
            closeDialog();
            return;
          }
          void applyLayoutStorePatch([{ kind: 'setSpacesState', spaces: nextState }], 'deleteSpace');
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'clear'}
        title={t('magnet.matrix-change.dialog.clear.title')}
        message={
          dialog?.kind === 'clear'
            ? t('magnet.matrix-change.dialog.clear.message', { name: dialog.spaceName })
            : ''
        }
        confirmText={t('common.action.clear')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!dialog || dialog.kind !== 'clear') return;
          const historyItem = createHistorySnapshotItem('clearSpaceLayout');
          if (!isTauri) {
            const nextHistory = sanitizeMagnetSpaceHistoryState({
              ...historyState,
              [activeSpaceId]: [...historyForActiveSpace, historyItem],
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_HISTORY, nextHistory);
          }
          const nextActive = new Set(REQUIRED_MAGNET_IDS);
          setActiveMagnetIds(nextActive);
          setMagnetLibrary((prev) =>
            prev.map((magnet) => {
              if (REQUIRED_MAGNET_IDS.has(magnet.id)) return magnet;
              return { ...magnet, anchors: [] };
            })
          );

          if (isTauri) {
            const anchorsByMagnetId: MagnetSpaceLayout['anchorsByMagnetId'] = {};
            for (const magnet of magnetLibrary) {
              if (!REQUIRED_MAGNET_IDS.has(magnet.id)) continue;
              if (!Array.isArray(magnet.anchors) || magnet.anchors.length === 0) continue;
              anchorsByMagnetId[magnet.id] = clonePixelAnchors(magnet.anchors);
            }

            const systemLayout = createDefaultMagnetSpaceLayout(dialog.spaceId, new Set<string>());
            for (const [magnetId, anchors] of Object.entries(systemLayout.anchorsByMagnetId)) {
              if (Array.isArray(anchorsByMagnetId[magnetId]) && anchorsByMagnetId[magnetId]!.length > 0) continue;
              anchorsByMagnetId[magnetId] = clonePixelAnchors(anchors);
            }
            const layout: MagnetSpaceLayout = {
              version: 1,
              activeMagnetIds: [...nextActive],
              anchorsByMagnetId,
            };
            void applyLayoutStorePatch(
              [
                { kind: 'pushSpaceHistory', spaceId: dialog.spaceId, item: historyItem },
                { kind: 'setSpaceLayout', spaceId: dialog.spaceId, layout },
              ],
              'clearSpaceLayout'
            );
          }
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'reset'}
        title={t('magnet.matrix-change.dialog.reset.title')}
        message={
          dialog?.kind === 'reset'
            ? t('magnet.matrix-change.dialog.reset.message', { name: dialog.spaceName })
            : ''
        }
        confirmText={t('common.action.reset')}
        cancelText={t('common.action.cancel')}
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!dialog || dialog.kind !== 'reset') return;
          const historyItem = createHistorySnapshotItem('resetSpaceLayout');
          if (!isTauri) {
            const nextHistory = sanitizeMagnetSpaceHistoryState({
              ...historyState,
              [activeSpaceId]: [...historyForActiveSpace, historyItem],
            });
            void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACE_HISTORY, nextHistory);
          }
          removeKey(resolveMagnetConfigStorageKey(dialog.spaceId));
          removeKey(resolveMagnetLayoutStorageKey(dialog.spaceId));

          if (isTauri) {
            const resetSpace = spacesState.spaces.find((space) => space.id === dialog.spaceId);
            const layout =
              createInitialMagnetSpaceTemplateLayout(
                resetSpace?.seedTemplateId,
                DEFAULT_ACTIVE_MAGNET_IDS
              ) ?? createDefaultMagnetSpaceLayout(dialog.spaceId, DEFAULT_ACTIVE_MAGNET_IDS);
            void applyLayoutStorePatch(
              [
                { kind: 'pushSpaceHistory', spaceId: dialog.spaceId, item: historyItem },
                { kind: 'setSpaceLayout', spaceId: dialog.spaceId, layout },
              ],
              'resetSpaceLayout'
            );
          }
          reloadFromStorage();
          closeDialog();
        }}
        onCancel={closeDialog}
      />
    </>
  );
}

const MATRIX_CHANGE_RENDERERS = {
  ...buildMagnetVariantRenderers(MatrixChangeMagnetDefaultRenderer, MATRIX_CHANGE_VARIANT_PRESETS),
} satisfies Record<string, ComponentType<MatrixChangeRendererProps>>;

export function MatrixChangeMagnet() {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-matrix-change', MATRIX_CHANGE_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer skinProps={skin.props} />;
}
