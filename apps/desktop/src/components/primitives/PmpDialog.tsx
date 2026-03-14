import React from 'react';
import { createPortal } from 'react-dom';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import type { ThemeSurfaceId } from '../../themes/types/theme';

export interface PmpDialogProps {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  overlaySurfaceId?: ThemeSurfaceId;
  dialogSurfaceId?: ThemeSurfaceId;
  overlayClassName?: string;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  titleClassName?: string;
  overlayStyle?: React.CSSProperties;
  style?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  footerStyle?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  role?: string;
  ariaLabel?: string;
}

export function PmpDialog({
  open,
  title,
  children,
  footer,
  headerActions,
  onClose,
  closeOnBackdrop = true,
  overlaySurfaceId = 'overlay.modal',
  dialogSurfaceId = 'primitive.dialog.default',
  overlayClassName,
  className,
  headerClassName,
  bodyClassName,
  footerClassName,
  titleClassName,
  overlayStyle,
  style,
  headerStyle,
  bodyStyle,
  footerStyle,
  titleStyle,
  role = 'dialog',
  ariaLabel,
}: PmpDialogProps) {
  const overlayTheme = useSkinSurface(overlaySurfaceId);
  const dialogBaseTheme = useSkinSurface('primitive.dialog');
  const dialogVariantTheme = useSkinSurface(dialogSurfaceId);
  const dialogTheme = mergeComponentThemes(dialogBaseTheme, dialogVariantTheme);

  if (!open) {
    return null;
  }

  const handleBackdropClick = () => {
    if (!closeOnBackdrop) return;
    onClose?.();
  };

  return createPortal(
    <div
      className={[overlayClassName, overlayTheme.classNameOverride?.overlay].filter(Boolean).join(' ')}
      data-surface-id={overlaySurfaceId}
      data-surface-variant={overlayTheme.variant}
      onClick={handleBackdropClick}
      style={{ ...overlayTheme.styleOverride?.overlay, ...overlayStyle }}
    >
      <div
        className={[
          className,
          overlayTheme.classNameOverride?.container,
          dialogTheme.classNameOverride?.container,
        ]
          .filter(Boolean)
          .join(' ')}
        data-surface-id-dialog={dialogSurfaceId}
        data-surface-variant-dialog={dialogTheme.variant}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        style={{
          ...overlayTheme.styleOverride?.container,
          ...dialogTheme.styleOverride?.container,
          ...style,
        }}
      >
        {(title || headerActions) && (
          <div
            className={[headerClassName, dialogTheme.classNameOverride?.header].filter(Boolean).join(' ')}
            style={{ ...dialogTheme.styleOverride?.header, ...headerStyle }}
          >
            {title ? (
              <div
                className={[titleClassName, dialogTheme.classNameOverride?.title].filter(Boolean).join(' ')}
                style={{ ...dialogTheme.styleOverride?.title, ...titleStyle }}
              >
                {title}
              </div>
            ) : null}
            {headerActions}
          </div>
        )}
        <div
          className={[bodyClassName, dialogTheme.classNameOverride?.body].filter(Boolean).join(' ')}
          style={{ ...dialogTheme.styleOverride?.body, ...bodyStyle }}
        >
          {children}
        </div>
        {footer ? (
          <div
            className={[footerClassName, dialogTheme.classNameOverride?.footer].filter(Boolean).join(' ')}
            style={{ ...dialogTheme.styleOverride?.footer, ...footerStyle }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
