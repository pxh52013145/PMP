import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n';
import { COMMANDS_SERVICE_TOKEN, dispatchRequiredCommand } from '../../services/commands';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { TAURI_EVENTS, setupTauriListenerWithPayload } from '../../utils/windowCommunication';
import { setMagnetChromeOverrideMode, useMagnetChromeOverrideMode, type MagnetChromeOverrideMode } from '../../modules/magnets';
import './StyleBar.css';

const telemetry = getTelemetryLogger('editor', 'StyleBar');
const STYLE_POPUP_OPEN_COMMAND_BY_TYPE = {
  'style-pixel': 'app:open-style-pixel-editor-window',
  'style-cover-color': 'app:open-style-cover-color-editor-window',
  'style-background-effect': 'app:open-style-background-effect-editor-window',
  'style-border-effect': 'app:open-style-border-effect-editor-window',
} as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const StyleBar = memo(function StyleBar() {
  const t = useT();
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
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
  const chromeOverrideMode = useMagnetChromeOverrideMode();

  const applyChromeMode = useCallback((mode: MagnetChromeOverrideMode) => {
    void setMagnetChromeOverrideMode(mode);
  }, []);

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
        const { closeEditorWindow } = await import('../../utils/editorWindows');
        const isOpen = openPopups.has(type);
        if (isOpen) {
          await closeEditorWindow(type);
          return;
        }
        await dispatchRequiredCommand(
          commands,
          STYLE_POPUP_OPEN_COMMAND_BY_TYPE[type],
          `Style popup command service is not available for ${type}.`
        );
      } catch (error) {
        telemetry.error('editor.style-popup.toggle.failed', {
          message: getErrorMessage(error),
          fields: {
            popupType: type,
          },
        });
      }
    },
    [commands, openPopups]
  );

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

        <div className="style-bar-chrome">
          <span className="style-bar-chrome-title">{t('editor.style-bar.chrome.title')}</span>
          <div className="style-bar-chrome-controls">
            <button
              type="button"
              className={`style-bar-btn style-bar-btn--chip ${chromeOverrideMode === 'force-on' ? 'active' : ''}`}
              onClick={() => applyChromeMode('force-on')}
              title={t('editor.style-bar.chrome.mode.forceOn')}
              aria-label={t('editor.style-bar.chrome.mode.forceOn')}
            >
              {t('editor.style-bar.chrome.mode.forceOn')}
            </button>
            <button
              type="button"
              className={`style-bar-btn style-bar-btn--chip ${chromeOverrideMode === 'force-off' ? 'active' : ''}`}
              onClick={() => applyChromeMode('force-off')}
              title={t('editor.style-bar.chrome.mode.forceOff')}
              aria-label={t('editor.style-bar.chrome.mode.forceOff')}
            >
              {t('editor.style-bar.chrome.mode.forceOff')}
            </button>
            <button
              type="button"
              className={`style-bar-btn style-bar-btn--chip ${chromeOverrideMode === 'maintain' ? 'active' : ''}`}
              onClick={() => applyChromeMode('maintain')}
              title={t('editor.style-bar.chrome.mode.maintain')}
              aria-label={t('editor.style-bar.chrome.mode.maintain')}
            >
              {t('editor.style-bar.chrome.mode.maintain')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
});
