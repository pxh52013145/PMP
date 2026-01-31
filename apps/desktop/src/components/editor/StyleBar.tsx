import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { readJson } from '../../modules/storage';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  STORAGE_KEYS,
  TAURI_EVENTS,
  broadcastDataUpdate,
  setupConfigSync,
  setupTauriListenerWithPayload,
} from '../../utils/windowCommunication';
import './StyleBar.css';

export const StyleBar = memo(function StyleBar() {
  const t = useT();
  const isTauriMemo = useMemo(() => isTauriRuntime(), []);

  type StylePopupType =
    | 'style-pixel'
    | 'style-cover-color'
    | 'style-background-effect'
    | 'style-border-effect';

  const popupTypes = useMemo(
    () => ['style-pixel', 'style-cover-color', 'style-background-effect', 'style-border-effect'] as const,
    []
  );

  const isStylePopupType = useCallback(
    (value: string): value is StylePopupType => (popupTypes as readonly string[]).includes(value),
    [popupTypes]
  );

  const [openPopups, setOpenPopups] = useState<Set<string>>(() => new Set());
  const [ornamentsEditing, setOrnamentsEditing] = useState<boolean>(() =>
    readJson<boolean>(STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING, false)
  );

  const reloadOrnamentsEditing = useCallback(() => {
    setOrnamentsEditing(readJson<boolean>(STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING, false));
  }, []);

  useEffect(() => {
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING],
      [TAURI_EVENTS.ORNAMENTS_OVERLAY_EDITING_UPDATED],
      reloadOrnamentsEditing
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [reloadOrnamentsEditing]);

  useEffect(() => {
    if (!isTauriMemo) return;

    let disposed = false;

    const onShown = async () => {
      const unlistenShown = await setupTauriListenerWithPayload<string>(TAURI_EVENTS.EDITOR_WINDOW_SHOWN, (type) => {
        if (disposed) return;
        if (!isStylePopupType(type)) return;
        setOpenPopups((prev) => new Set([...prev, type]));
      });
      return unlistenShown;
    };

    const onHidden = async () => {
      const unlistenHidden = await setupTauriListenerWithPayload<string>(TAURI_EVENTS.EDITOR_WINDOW_HIDDEN, (type) => {
        if (disposed) return;
        if (!isStylePopupType(type)) return;
        setOpenPopups((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      });
      return unlistenHidden;
    };

    let unlistenShown: (() => void) | null = null;
    let unlistenHidden: (() => void) | null = null;
    void Promise.all([onShown(), onHidden()]).then(([u1, u2]) => {
      if (disposed) {
        u1();
        u2();
        return;
      }
      unlistenShown = u1;
      unlistenHidden = u2;
    });

    return () => {
      disposed = true;
      if (unlistenShown) unlistenShown();
      if (unlistenHidden) unlistenHidden();
    };
  }, [isStylePopupType, isTauriMemo]);

  const openStylePopup = useCallback(
    async (type: StylePopupType) => {
      if (!isTauriRuntime()) return;
      try {
        const { calculateWindowPosition, closeEditorWindow, openEditorWindow } = await import('../../utils/editorWindows');
        const isOpen = openPopups.has(type);
        if (isOpen) {
          await closeEditorWindow(type);
          return;
        }
        const position = await calculateWindowPosition(type);
        await openEditorWindow({ type, ...position });
      } catch (error) {
        console.error('[StyleBar] Failed to open style popup window:', type, error);
      }
    },
    [openPopups]
  );

  const setOrnamentsEditingState = useCallback(async (next: boolean) => {
    setOrnamentsEditing(next);

    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING,
        next,
        TAURI_EVENTS.ORNAMENTS_OVERLAY_EDITING_UPDATED
      );
    } catch {
      // best-effort
    }

    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      await invoke('ornaments_overlay_set_editing', { editing: next });
      if (!next) {
        await invoke('ornaments_overlay_set_interactive_rects', { rects: [] });
      }
    } catch {
      // best-effort
    }
  }, []);

  const toggleOrnamentsEditing = useCallback(async () => {
    if (!isTauriRuntime()) return;
    await setOrnamentsEditingState(!ornamentsEditing);
  }, [ornamentsEditing, setOrnamentsEditingState]);

  useEffect(() => {
    if (!isTauriMemo) return;

    let disposed = false;
    let unlistenHidden: (() => void) | null = null;

    void setupTauriListenerWithPayload<string>(TAURI_EVENTS.EDITOR_WINDOW_HIDDEN, (payload) => {
      if (disposed) return;
      if (payload !== 'style') return;
      if (!ornamentsEditing) return;
      void setOrnamentsEditingState(false);
    }).then((u) => {
      if (disposed) {
        u();
        return;
      }
      unlistenHidden = u;
    });

    return () => {
      disposed = true;
      if (unlistenHidden) unlistenHidden();
    };
  }, [isTauriMemo, ornamentsEditing, setOrnamentsEditingState]);

  return (
    <div className="style-bar-root">
      <div className="style-bar-header">
        <span className="style-bar-header-icon">
          ◥◤
        </span>
        <span className="style-bar-header-title">
          {t('windows.editor.style.title')}
        </span>
        <div className="style-bar-grip" data-tauri-drag-region aria-label={t('common.drag')} title={t('common.drag')} />
      </div>

      <div className="style-bar-actions">
        <button
          type="button"
          className={`style-bar-btn ${openPopups.has('style-pixel') ? 'active' : ''}`}
          onClick={() => void openStylePopup('style-pixel')}
          title={t('editor.style-bar.pixel.title')}
          aria-label={t('editor.style-bar.pixel.title')}
        >
          {t('editor.style-bar.pixel.label')}
        </button>

        <button
          type="button"
          className={`style-bar-btn ${openPopups.has('style-cover-color') ? 'active' : ''}`}
          onClick={() => void openStylePopup('style-cover-color')}
          title={t('editor.style-bar.coverColor.title')}
          aria-label={t('editor.style-bar.coverColor.title')}
        >
          {t('editor.style-bar.coverColor.label')}
        </button>

        <button
          type="button"
          className={`style-bar-btn ${openPopups.has('style-background-effect') ? 'active' : ''}`}
          onClick={() => void openStylePopup('style-background-effect')}
          title={t('editor.style-bar.backgroundEffect.title')}
          aria-label={t('editor.style-bar.backgroundEffect.title')}
        >
          {t('editor.style-bar.backgroundEffect.label')}
        </button>

        <button
          type="button"
          className={`style-bar-btn ${openPopups.has('style-border-effect') ? 'active' : ''}`}
          onClick={() => void openStylePopup('style-border-effect')}
          title={t('editor.style-bar.borderEffect.title')}
          aria-label={t('editor.style-bar.borderEffect.title')}
        >
          {t('editor.style-bar.borderEffect.label')}
        </button>

        <button
          type="button"
          className={`style-bar-btn style-bar-btn--ornaments ${ornamentsEditing ? 'active' : ''}`}
          onClick={() => void toggleOrnamentsEditing()}
          title={t('editor.style-bar.ornaments.title')}
          aria-label={t('editor.style-bar.ornaments.title')}
        >
          {t('editor.style-bar.ornaments.label')}
        </button>
      </div>
    </div>
  );
});
