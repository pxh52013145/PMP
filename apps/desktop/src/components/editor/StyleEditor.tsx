import { memo } from 'react';
import './StyleEditor.css';
import { useT } from '../../i18n';
import { BackgroundEffectSection, BorderEffectSection, CoverColorSection, PixelSection } from './style/StyleSections';
import { useStyleEditorModel } from './style/useStyleEditorModel';

/**
 * Full style editor panel (legacy), kept as a reusable source-of-truth for the popup editors.
 * The current UX uses a docked style bar + dedicated popup windows.
 */
export const StyleEditor = memo(function StyleEditor() {
  const t = useT();
  const model = useStyleEditorModel();

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

      </div>
    </div>
  );
});
