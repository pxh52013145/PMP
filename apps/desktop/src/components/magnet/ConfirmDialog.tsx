import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { useSkinSurfaceModel } from '../../themes/skinSurface';
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
  const surface = useSkinSurfaceModel('overlay.confirm-dialog');

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
      {...surface.getElementProps({
        part: 'overlay',
        bindingId: 'overlay.confirm-dialog',
        className: 'confirm-dialog-overlay',
        includeSurfaceTokens: true,
      })}
      data-surface-id="overlay.confirm-dialog"
      data-surface-variant={surface.variant}
      onClick={handleCancel}
    >
      <div
        {...surface.getElementProps({
          part: 'container',
          className: 'confirm-dialog',
          includeSurfaceTokens: false,
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          {...surface.getElementProps({
            part: 'header',
            className: 'confirm-dialog-header',
            includeSurfaceTokens: false,
          })}
        >
          <h3
            {...surface.getElementProps({
              part: 'title',
              className: 'confirm-dialog-title',
              includeSurfaceTokens: false,
            })}
          >
            {resolvedTitle}
          </h3>
        </div>
        <div
          {...surface.getElementProps({
            part: 'body',
            className: 'confirm-dialog-body',
            includeSurfaceTokens: false,
          })}
        >
          <p
            {...surface.getElementProps({
              part: 'message',
              className: 'confirm-dialog-message',
              includeSurfaceTokens: false,
            })}
          >
            {message}
          </p>
        </div>
        <div
          {...surface.getElementProps({
            part: 'footer',
            className: 'confirm-dialog-footer',
            includeSurfaceTokens: false,
          })}
        >
          {resolvedCancelText && (
            <button
              {...surface.getElementProps({
                part: 'cancelButton',
                className: ['confirm-dialog-btn', 'confirm-dialog-btn-cancel'].join(' '),
                includeSurfaceTokens: false,
              })}
              onClick={handleCancel}
            >
              {resolvedCancelText}
            </button>
          )}
          <button
            {...surface.getElementProps({
              part: 'confirmButton',
              state: confirmButtonStyle,
              className: ['confirm-dialog-btn', 'confirm-dialog-btn-confirm', `confirm-dialog-btn-${confirmButtonStyle}`]
                .filter(Boolean)
                .join(' '),
              includeSurfaceTokens: false,
            })}
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
