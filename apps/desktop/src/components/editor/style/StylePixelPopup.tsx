import { memo } from 'react';
import { PixelSection } from './StyleSections';
import { StylePopupShell } from './StylePopupShell';
import { useStyleEditorModel } from './useStyleEditorModel';

export const StylePixelPopup = memo(function StylePixelPopup() {
  const model = useStyleEditorModel();
  return (
    <StylePopupShell titleKey="windows.editor.style-pixel.title">
      <PixelSection model={model} />
    </StylePopupShell>
  );
});

