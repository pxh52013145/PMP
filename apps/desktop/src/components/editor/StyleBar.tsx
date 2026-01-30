import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from '../../utils/windowCommunication';
import './StyleBar.css';

export const StyleBar = memo(function StyleBar({ onOpenOrnaments }: { onOpenOrnaments: () => void }) {
  const t = useT();
  const isTauri = isTauriRuntime();
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

  return (
    <div className="style-bar-root">
      <div className="style-bar-header" data-tauri-drag-region>
        <span className="style-bar-header-icon" data-tauri-drag-region>
          ◥◤
        </span>
        <span className="style-bar-header-title" data-tauri-drag-region>
          {t('windows.editor.style.title')}
        </span>
        <div className="style-bar-grip" data-tauri-drag-region />
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
          className="style-bar-btn style-bar-btn--ornaments"
          onClick={onOpenOrnaments}
          disabled={!isTauri}
          title={t('editor.style-bar.ornaments.title')}
          aria-label={t('editor.style-bar.ornaments.title')}
        >
          {t('editor.style-bar.ornaments.label')}
        </button>
      </div>
    </div>
  );
});
