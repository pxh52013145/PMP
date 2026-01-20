import React from 'react';
import './ConfirmDialog.css';

export type ExitDialogProps = {
  open: boolean;
  title: string;
  message: string;
  cancelText: string;
  hideText: string;
  exitText: string;
  onCancel: () => void;
  onHide: () => void;
  onExit: () => void;
};

export const ExitDialog: React.FC<ExitDialogProps> = ({
  open,
  title,
  message,
  cancelText,
  hideText,
  exitText,
  onCancel,
  onHide,
  onExit,
}) => {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="pmp-confirm-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="pmp-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pmp-confirm-header">
          <div className="pmp-confirm-title">{title}</div>
        </div>
        <div className="pmp-confirm-body">
          <pre className="pmp-confirm-message">{message}</pre>
        </div>
        <div className="pmp-confirm-footer">
          <button type="button" className="pmp-confirm-btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className="pmp-confirm-btn pmp-confirm-btn--primary" onClick={onHide}>
            {hideText}
          </button>
          <button type="button" className="pmp-confirm-btn pmp-confirm-btn--danger" onClick={onExit}>
            {exitText}
          </button>
        </div>
      </div>
    </div>
  );
};

