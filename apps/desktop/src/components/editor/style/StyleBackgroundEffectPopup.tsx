import { memo } from 'react';
import { BackgroundEffectSection } from './StyleSections';
import { StylePopupShell } from './StylePopupShell';
import { useStyleEditorModel } from './useStyleEditorModel';

export const StyleBackgroundEffectPopup = memo(function StyleBackgroundEffectPopup() {
  const model = useStyleEditorModel();
  return (
    <StylePopupShell titleKey="windows.editor.style-background-effect.title">
      <BackgroundEffectSection model={model} />
    </StylePopupShell>
  );
});

