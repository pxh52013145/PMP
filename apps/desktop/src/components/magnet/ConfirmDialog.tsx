import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonStyle?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  confirmButtonStyle = 'primary',
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const surfaceTheme = useSkinSurface('overlay.confirm-dialog');

  if (!isOpen) return null;

  const resolvedTitle = title ?? t('common.dialog.confirmTitle');
  const resolvedConfirmText = confirmText === undefined ? t('common.action.confirm') : confirmText;
  const resolvedCancelText = cancelText === undefined ? t('common.action.cancel') : cancelText;

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    onConfirm();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

  return createPortal(
    <div
      className={['confirm-dialog-overlay', surfaceTheme.classNameOverride?.overlay].filter(Boolean).join(' ')}
      data-surface-id="overlay.confirm-dialog"
      data-surface-variant={surfaceTheme.variant}
      style={surfaceTheme.styleOverride?.overlay}
      onClick={handleCancel}
    >
      <div
        className={['confirm-dialog', surfaceTheme.classNameOverride?.container].filter(Boolean).join(' ')}
        style={surfaceTheme.styleOverride?.container}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={['confirm-dialog-header', surfaceTheme.classNameOverride?.header].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.header}
        >
          <h3
            className={['confirm-dialog-title', surfaceTheme.classNameOverride?.title].filter(Boolean).join(' ')}
            style={surfaceTheme.styleOverride?.title}
          >
            {resolvedTitle}
          </h3>
        </div>
        <div
          className={['confirm-dialog-body', surfaceTheme.classNameOverride?.body].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.body}
        >
          <p
            className={['confirm-dialog-message', surfaceTheme.classNameOverride?.message].filter(Boolean).join(' ')}
            style={surfaceTheme.styleOverride?.message}
          >
            {message}
          </p>
        </div>
        <div
          className={['confirm-dialog-footer', surfaceTheme.classNameOverride?.footer].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.footer}
        >
          {resolvedCancelText && (
            <button
              className={[
                'confirm-dialog-btn',
                'confirm-dialog-btn-cancel',
                surfaceTheme.classNameOverride?.button,
                surfaceTheme.classNameOverride?.cancelButton,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ ...surfaceTheme.styleOverride?.button, ...surfaceTheme.styleOverride?.cancelButton }}
              onClick={handleCancel}
            >
              {resolvedCancelText}
            </button>
          )}
          <button
            className={[
              'confirm-dialog-btn',
              'confirm-dialog-btn-confirm',
              `confirm-dialog-btn-${confirmButtonStyle}`,
              surfaceTheme.classNameOverride?.button,
              surfaceTheme.classNameOverride?.confirmButton,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ ...surfaceTheme.styleOverride?.button, ...surfaceTheme.styleOverride?.confirmButton }}
            onClick={handleConfirm}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
