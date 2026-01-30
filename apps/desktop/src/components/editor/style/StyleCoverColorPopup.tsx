import { memo } from 'react';
import { CoverColorSection } from './StyleSections';
import { StylePopupShell } from './StylePopupShell';
import { useStyleEditorModel } from './useStyleEditorModel';

export const StyleCoverColorPopup = memo(function StyleCoverColorPopup() {
  const model = useStyleEditorModel();
  return (
    <StylePopupShell titleKey="windows.editor.style-cover-color.title">
      <CoverColorSection model={model} />
    </StylePopupShell>
  );
});

