import { memo, useCallback } from 'react';
import './StyleEditor.css';
import { useT } from '../../i18n';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { STORAGE_KEYS, TAURI_EVENTS, broadcastDataUpdate } from '../../utils/windowCommunication';
import { BackgroundEffectSection, BorderEffectSection, CoverColorSection, PixelSection } from './style/StyleSections';
import { useStyleEditorModel } from './style/useStyleEditorModel';

/**
 * Full style editor panel (legacy), kept as a reusable source-of-truth for the popup editors.
 * The current UX uses a docked style bar + dedicated popup windows.
 */
export const StyleEditor = memo(function StyleEditor() {
  const t = useT();
  const model = useStyleEditorModel();

  const handleOpenOrnamentsEditor = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await broadcastDataUpdate(
        STORAGE_KEYS.ORNAMENTS_OVERLAY_EDITING,
        true,
        TAURI_EVENTS.ORNAMENTS_OVERLAY_EDITING_UPDATED
      );

      const { calculateWindowPosition, openEditorWindow } = await import('../../utils/editorWindows');
      const position = await calculateWindowPosition('ornaments');
      await openEditorWindow({ type: 'ornaments', ...position });
    } catch (error) {
      console.error('[StyleEditor] Failed to open ornaments editor window:', error);
    }
  }, []);

  return (
    <div className="editor-style-editor">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.style.title')}
        </span>
      </div>

      <div className="editor-window-content">
        <PixelSection model={model} />
        <CoverColorSection model={model} />
        <BackgroundEffectSection model={model} />
        <BorderEffectSection model={model} />

        <section className="style-section">
          <h3 className="section-title">{t('editor.style-editor.section.ornaments.title')}</h3>
          <p className="section-description">{t('editor.style-editor.section.ornaments.desc')}</p>
          <button type="button" className="open-ornaments-button" onClick={() => void handleOpenOrnamentsEditor()}>
            {t('editor.style-bar.ornaments.label')}
          </button>
        </section>
      </div>
    </div>
  );
});
