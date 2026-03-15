import React from 'react';
import './ConfirmDialog.css';
import { useT } from '../../i18n';
import { useSkinSurfaceModel } from '../../themes/skinSurface';

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}) => {
  const t = useT();
  const surface = useSkinSurfaceModel('overlay.confirm-dialog');
  const resolvedConfirmText = confirmText === undefined ? t('common.action.confirm') : confirmText;
  const resolvedCancelText = cancelText === undefined ? t('common.action.cancel') : cancelText;

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
    <div
      {...surface.getElementProps({
        part: 'overlay',
        bindingId: 'overlay.confirm-dialog',
        className: 'pmp-confirm-overlay',
        includeSurfaceTokens: true,
      })}
      data-surface-id="overlay.confirm-dialog"
      data-surface-variant={surface.variant}
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        {...surface.getElementProps({
          part: 'container',
          className: 'pmp-confirm-modal',
          includeSurfaceTokens: false,
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          {...surface.getElementProps({ part: 'header', className: 'pmp-confirm-header', includeSurfaceTokens: false })}
        >
          <div
            {...surface.getElementProps({ part: 'title', className: 'pmp-confirm-title', includeSurfaceTokens: false })}
          >
            {title}
          </div>
        </div>
        <div
          {...surface.getElementProps({ part: 'body', className: 'pmp-confirm-body', includeSurfaceTokens: false })}
        >
          <pre
            {...surface.getElementProps({
              part: 'message',
              className: 'pmp-confirm-message',
              includeSurfaceTokens: false,
            })}
          >
            {message}
          </pre>
        </div>
        <div
          {...surface.getElementProps({ part: 'footer', className: 'pmp-confirm-footer', includeSurfaceTokens: false })}
        >
          <button
            type="button"
            {...surface.getElementProps({
              part: 'cancelButton',
              className: 'pmp-confirm-btn',
              includeSurfaceTokens: false,
            })}
            onClick={onCancel}
          >
            {resolvedCancelText}
          </button>
          <button
            type="button"
            {...surface.getElementProps({
              part: 'confirmButton',
              className: ['pmp-confirm-btn', danger ? 'pmp-confirm-btn--danger' : 'pmp-confirm-btn--primary']
                .filter(Boolean)
                .join(' '),
              includeSurfaceTokens: false,
            })}
            onClick={onConfirm}
          >
            {resolvedConfirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export function useConfirmDialog() {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((result: boolean) => void) | null>(null);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(next);
    });
  }, []);

  const close = React.useCallback((result: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolver?.(result);
  }, []);

  const dialog = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title ?? ''}
      message={options?.message ?? ''}
      confirmText={options?.confirmText}
      cancelText={options?.cancelText}
      danger={options?.danger}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  );

  return { confirm, dialog, isOpen: options !== null };
}
