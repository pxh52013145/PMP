import { memo } from 'react';
import { BorderEffectSection } from './StyleSections';
import { StylePopupShell } from './StylePopupShell';
import { useStyleEditorModel } from './useStyleEditorModel';

export const StyleBorderEffectPopup = memo(function StyleBorderEffectPopup() {
  const model = useStyleEditorModel();
  return (
    <StylePopupShell titleKey="windows.editor.style-border-effect.title">
      <BorderEffectSection model={model} />
    </StylePopupShell>
  );
});

