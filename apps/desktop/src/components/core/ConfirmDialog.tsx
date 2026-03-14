import React from 'react';
import './ConfirmDialog.css';
import { useT } from '../../i18n';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';

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
  const surfaceTheme = useSkinSurface('overlay.confirm-dialog');
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
      className={['pmp-confirm-overlay', surfaceTheme.classNameOverride?.overlay].filter(Boolean).join(' ')}
      data-surface-id="overlay.confirm-dialog"
      data-surface-variant={surfaceTheme.variant}
      role="dialog"
      aria-modal="true"
      style={surfaceTheme.styleOverride?.overlay}
      onClick={onCancel}
    >
      <div
        className={['pmp-confirm-modal', surfaceTheme.classNameOverride?.container].filter(Boolean).join(' ')}
        style={surfaceTheme.styleOverride?.container}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={['pmp-confirm-header', surfaceTheme.classNameOverride?.header].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.header}
        >
          <div
            className={['pmp-confirm-title', surfaceTheme.classNameOverride?.title].filter(Boolean).join(' ')}
            style={surfaceTheme.styleOverride?.title}
          >
            {title}
          </div>
        </div>
        <div
          className={['pmp-confirm-body', surfaceTheme.classNameOverride?.body].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.body}
        >
          <pre
            className={['pmp-confirm-message', surfaceTheme.classNameOverride?.message].filter(Boolean).join(' ')}
            style={surfaceTheme.styleOverride?.message}
          >
            {message}
          </pre>
        </div>
        <div
          className={['pmp-confirm-footer', surfaceTheme.classNameOverride?.footer].filter(Boolean).join(' ')}
          style={surfaceTheme.styleOverride?.footer}
        >
          <button
            type="button"
            className={[
              'pmp-confirm-btn',
              surfaceTheme.classNameOverride?.button,
              surfaceTheme.classNameOverride?.cancelButton,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ ...surfaceTheme.styleOverride?.button, ...surfaceTheme.styleOverride?.cancelButton }}
            onClick={onCancel}
          >
            {resolvedCancelText}
          </button>
          <button
            type="button"
            className={[
              'pmp-confirm-btn',
              danger ? 'pmp-confirm-btn--danger' : 'pmp-confirm-btn--primary',
              surfaceTheme.classNameOverride?.button,
              surfaceTheme.classNameOverride?.confirmButton,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ ...surfaceTheme.styleOverride?.button, ...surfaceTheme.styleOverride?.confirmButton }}
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
