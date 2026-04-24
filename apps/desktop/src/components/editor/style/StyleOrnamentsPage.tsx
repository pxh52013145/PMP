import { memo } from 'react';
import { useT } from '../../../i18n';

export interface StyleOrnamentsPageProps {
  onAddOrnament: () => void;
  onDone: () => void;
}

export const StyleOrnamentsPage = memo(function StyleOrnamentsPage({
  onAddOrnament,
  onDone,
}: StyleOrnamentsPageProps) {
  const t = useT();

  return (
    <div className="style-ornaments-page">
      <div className="style-ornaments-page__copy">
        <span className="style-ornaments-page__title">
          {t('editor.style-bar.ornaments.editingTitle')}
        </span>
        <span className="style-ornaments-page__desc">
          {t('editor.style-bar.ornaments.editingDesc')}
        </span>
      </div>

      <div className="style-ornaments-page__actions">
        <button type="button" className="style-bar-btn" onClick={onAddOrnament}>
          {t('editor.style-bar.ornaments.add')}
        </button>
        <button type="button" className="style-bar-btn active" onClick={onDone}>
          {t('editor.style-bar.ornaments.done')}
        </button>
      </div>
    </div>
  );
});
