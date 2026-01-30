import type { ReactNode } from 'react';
import { useT } from '../../../i18n';
import '../StyleEditor.css';

export function StylePopupShell({ titleKey, children }: { titleKey: string; children: ReactNode }) {
  const t = useT();
  return (
    <div className="editor-style-editor">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t(titleKey)}
        </span>
      </div>
      <div className="editor-window-content">{children}</div>
    </div>
  );
}

