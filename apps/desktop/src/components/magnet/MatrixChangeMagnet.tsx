import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readString, removeKey, usePersistentSetting, writeString } from '../../modules/storage';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';
import {
  createDefaultMagnetSpacesState,
  createNextSpaceId,
  ensureMagnetSpaceLayout,
  loadMagnetConfig,
  resolveMagnetConfigStorageKey,
  resolveMagnetLayoutStorageKey,
  readMagnetCatalogState,
  saveMagnetSpaceLayout,
  sanitizeMagnetSpacesState,
  useMagnetConfig,
} from '../../modules/magnets';
import { REQUIRED_MAGNET_IDS } from '../../constants/magnets';
import type { Magnet, PixelAnchor } from '../../types/pixel';
import { ConfirmDialog } from './ConfirmDialog';
import { InputDialog } from './InputDialog';
import './MatrixChangeMagnet.css';

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

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

export function MatrixChangeMagnet() {
  const { defaultMagnetLibrary, magnetLibrary, setActiveMagnetIds, setMagnetLibrary, reloadFromStorage } =
    useMagnetConfig();
  const defaultSpacesState = useMemo(() => createDefaultMagnetSpacesState(), []);
  const [spacesRaw] = usePersistentSetting(STORAGE_KEYS.MAGNET_SPACES, defaultSpacesState, {
    format: 'json',
  });
  const spacesState = useMemo(() => sanitizeMagnetSpacesState(spacesRaw), [spacesRaw]);
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

  const switchToSpace = useCallback(
    (nextSpaceId: string) => {
      if (!nextSpaceId || nextSpaceId === activeSpaceId) return;
      const nextState = { ...spacesState, activeSpaceId: nextSpaceId };
      void broadcastDataUpdate(STORAGE_KEYS.MAGNET_SPACES, nextState, TAURI_EVENTS.MAGNET_SPACES_UPDATED);
    },
    [activeSpaceId, spacesState]
  );

  const copySpaceStorage = useCallback((sourceSpaceId: string, destSpaceId: string) => {
    const layout = ensureMagnetSpaceLayout(sourceSpaceId).layout;
    saveMagnetSpaceLayout(layout, resolveMagnetLayoutStorageKey(destSpaceId));

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
  }, []);

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
    const defaultName = match ? `空间${match[1]}` : `空间${nextOrder}`;

    setDialog({ kind: 'create', newId, nextOrder, defaultName });
    closePanel();
  }, [closePanel, spacesState]);

  const openCloneDialog = useCallback(() => {
    if (!activeSpace) return;
    const newId = createNextSpaceId(spacesState);
    const nextOrder =
      Math.max(0, ...spacesState.spaces.map((s) => (Number.isFinite(s.order) ? s.order : 0))) + 1;
    const defaultName = `${activeSpace.name} 副本`;

    setDialog({ kind: 'clone', sourceSpaceId: activeSpace.id, newId, nextOrder, defaultName });
    closePanel();
  }, [activeSpace, closePanel, spacesState]);

  const openRenameDialog = useCallback(() => {
    if (!activeSpace) return;
    setDialog({ kind: 'rename', spaceId: activeSpace.id, currentName: activeSpace.name });
    closePanel();
  }, [activeSpace, closePanel]);

  const openDeleteDialog = useCallback(() => {
    if (!activeSpace) return;
    if (activeSpace.id === 'space1') return;
    if (spacesState.spaces.length <= 1) return;
    setDialog({ kind: 'delete', spaceId: activeSpace.id, spaceName: activeSpace.name });
    closePanel();
  }, [activeSpace, closePanel, spacesState.spaces.length]);

  const openClearDialog = useCallback(() => {
    setDialog({
      kind: 'clear',
      spaceId: activeSpaceId,
      spaceName: activeSpace?.name ?? activeSpaceId,
    });
    closePanel();
  }, [activeSpace?.name, activeSpaceId, closePanel]);

  const openResetDialog = useCallback(() => {
    setDialog({
      kind: 'reset',
      spaceId: activeSpaceId,
      spaceName: activeSpace?.name ?? activeSpaceId,
    });
    closePanel();
  }, [activeSpace?.name, activeSpaceId, closePanel]);

  const closeDialog = useCallback(() => setDialog(null), []);

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
        title={`空间切换：点击打开面板\n当前：${activeSpace?.name ?? activeSpaceId} (${badge})`}
      >
        <span className="matrix-change-magnet-badge">{badge}</span>
        <span>SPACE</span>
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
                  <div className="matrix-change-magnet-panel-title">Magnet Spaces</div>
                  <div className="matrix-change-magnet-panel-subtitle">
                    当前：{activeSpace?.name ?? activeSpaceId}
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
                    + 新建
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openCloneDialog}
                    disabled={!activeSpace}
                  >
                    克隆
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openClearDialog}
                  >
                    清空
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openResetDialog}
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action"
                    onClick={openRenameDialog}
                    disabled={!activeSpace}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    className="matrix-change-magnet-panel-action danger"
                    onClick={openDeleteDialog}
                    disabled={!activeSpace || activeSpaceId === 'space1' || spacesState.spaces.length <= 1}
                  >
                    删除
                  </button>
                </div>
              </div>,
              document.body
            )
      )}

      <InputDialog
        isOpen={dialog?.kind === 'create'}
        title="新建空间"
        message="请输入空间名称（可稍后重命名）"
        defaultValue={dialog?.kind === 'create' ? dialog.defaultName : ''}
        confirmText="创建并切换"
        cancelText="取消"
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
          void broadcastDataUpdate(
            STORAGE_KEYS.MAGNET_SPACES,
            nextState,
            TAURI_EVENTS.MAGNET_SPACES_UPDATED
          );
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <InputDialog
        isOpen={dialog?.kind === 'clone'}
        title="克隆空间"
        message="请输入新空间名称（将复制当前空间的布局 + 配置）"
        defaultValue={dialog?.kind === 'clone' ? dialog.defaultName : ''}
        confirmText="克隆并切换"
        cancelText="取消"
        onConfirm={(value) => {
          if (!dialog || dialog.kind !== 'clone') return;
          const name = value.trim() || dialog.defaultName;
          try {
            copySpaceStorage(dialog.sourceSpaceId, dialog.newId);
          } catch (error) {
            console.warn('[magnets] Failed to clone space storage', error);
          }
          const nextState = sanitizeMagnetSpacesState({
            ...spacesState,
            activeSpaceId: dialog.newId,
            spaces: [
              ...spacesState.spaces,
              { id: dialog.newId, name, order: dialog.nextOrder, createdAt: Date.now() },
            ],
          });
          void broadcastDataUpdate(
            STORAGE_KEYS.MAGNET_SPACES,
            nextState,
            TAURI_EVENTS.MAGNET_SPACES_UPDATED
          );
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <InputDialog
        isOpen={dialog?.kind === 'rename'}
        title="重命名空间"
        message="请输入新的空间名称"
        defaultValue={dialog?.kind === 'rename' ? dialog.currentName : ''}
        confirmText="保存"
        cancelText="取消"
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
          void broadcastDataUpdate(
            STORAGE_KEYS.MAGNET_SPACES,
            nextState,
            TAURI_EVENTS.MAGNET_SPACES_UPDATED
          );
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'delete'}
        title="删除空间"
        message={
          dialog?.kind === 'delete'
            ? `确认删除空间 "${dialog.spaceName}"？（不会清除该空间保存的布局/配置数据）`
            : ''
        }
        confirmText="删除"
        cancelText="取消"
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
          void broadcastDataUpdate(
            STORAGE_KEYS.MAGNET_SPACES,
            nextState,
            TAURI_EVENTS.MAGNET_SPACES_UPDATED
          );
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'clear'}
        title="清空空间"
        message={
          dialog?.kind === 'clear'
            ? `清空空间 "${dialog.spaceName}"？（仅保留必备磁贴：窗控 + switch + edit）`
            : ''
        }
        confirmText="清空"
        cancelText="取消"
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!dialog || dialog.kind !== 'clear') return;
          const catalogMagnets = readMagnetCatalogState().magnets;
          const defaultAnchorsByMagnetId = new Map<string, PixelAnchor[]>();
          for (const magnet of defaultMagnetLibrary) {
            defaultAnchorsByMagnetId.set(magnet.id, clonePixelAnchors(magnet.anchors));
          }
          for (const magnet of catalogMagnets) {
            defaultAnchorsByMagnetId.set(magnet.id, clonePixelAnchors(magnet.anchors));
          }

          const nextLibrary: Magnet[] = magnetLibrary.map((magnet) => {
            if (REQUIRED_MAGNET_IDS.has(magnet.id)) return magnet;
            const nextAnchors = defaultAnchorsByMagnetId.get(magnet.id);
            if (!nextAnchors) return magnet;
            return { ...magnet, anchors: nextAnchors };
          });

          setMagnetLibrary(nextLibrary);
          setActiveMagnetIds(new Set(REQUIRED_MAGNET_IDS));
          closeDialog();
        }}
        onCancel={closeDialog}
      />

      <ConfirmDialog
        isOpen={dialog?.kind === 'reset'}
        title="重置空间"
        message={
          dialog?.kind === 'reset'
            ? `重置空间 "${dialog.spaceName}"？（将删除该空间保存的布局/配置并回到默认）`
            : ''
        }
        confirmText="重置"
        cancelText="取消"
        confirmButtonStyle="danger"
        onConfirm={() => {
          if (!dialog || dialog.kind !== 'reset') return;
          removeKey(resolveMagnetLayoutStorageKey(dialog.spaceId));
          removeKey(resolveMagnetConfigStorageKey(dialog.spaceId));
          reloadFromStorage();
          closeDialog();
        }}
        onCancel={closeDialog}
      />
    </>
  );
}
