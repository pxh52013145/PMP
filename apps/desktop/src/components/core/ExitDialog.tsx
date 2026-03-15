import React from 'react';
import { PmpButton, PmpDialog } from '../primitives';
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

  return (
    <PmpDialog
      open={open}
      title={title}
      overlaySurfaceId="overlay.modal"
      dialogSurfaceId="primitive.dialog.default"
      overlayClassName="pmp-confirm-overlay"
      className="pmp-confirm-modal"
      headerClassName="pmp-confirm-header"
      titleClassName="pmp-confirm-title"
      bodyClassName="pmp-confirm-body"
      footerClassName="pmp-confirm-footer"
      onClose={onCancel}
      footer={
        <>
          <PmpButton type="button" className="pmp-confirm-btn" variant="ghost" onClick={onCancel}>
            {cancelText}
          </PmpButton>
          <PmpButton type="button" className="pmp-confirm-btn pmp-confirm-btn--primary" variant="primary" onClick={onHide}>
            {hideText}
          </PmpButton>
          <PmpButton type="button" className="pmp-confirm-btn pmp-confirm-btn--danger" variant="danger" onClick={onExit}>
            {exitText}
          </PmpButton>
        </>
      }
    >
      <pre className="pmp-confirm-message">{message}</pre>
    </PmpDialog>
  );
};
