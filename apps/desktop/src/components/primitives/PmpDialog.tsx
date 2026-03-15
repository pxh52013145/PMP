import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import type { ThemeBindingId, ThemeSurfaceId } from '../../themes/types/theme';

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
  const { theme, getSurfaceTheme } = useTheme();
  const overlayTheme = getSurfaceTheme(overlaySurfaceId);
  const dialogBaseTheme = getSurfaceTheme('primitive.dialog');
  const dialogVariantTheme = getSurfaceTheme(dialogSurfaceId);
  const dialogTheme = useMemo(
    () => mergeComponentThemes(dialogBaseTheme, dialogVariantTheme),
    [dialogBaseTheme, dialogVariantTheme]
  );
  const overlaySurface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, overlaySurfaceId, overlayTheme),
    [theme, overlaySurfaceId, overlayTheme]
  );
  const dialogSurface = useMemo(
    () => createResolvedSkinSurfaceModel(theme, dialogSurfaceId, dialogTheme),
    [theme, dialogSurfaceId, dialogTheme]
  );

  if (!open) {
    return null;
  }

  const handleBackdropClick = () => {
    if (!closeOnBackdrop) return;
    onClose?.();
  };

  return createPortal(
    <div
      {...overlaySurface.getElementProps({
        part: 'overlay',
        bindingId: overlaySurfaceId as ThemeBindingId,
        className: overlayClassName,
        style: overlayStyle,
      })}
      data-surface-id={overlaySurfaceId}
      data-surface-variant={overlayTheme.variant}
      onClick={handleBackdropClick}
    >
      <div
        {...dialogSurface.getElementProps({
          bindingId: dialogSurfaceId as ThemeBindingId,
          className,
          style: {
            ...overlaySurface.getPart('root', { includeSurfaceTokens: false }).style,
            ...style,
          },
        })}
        data-surface-id-dialog={dialogSurfaceId}
        data-surface-variant-dialog={dialogTheme.variant}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
      >
        {(title || headerActions) && (
          <div
            {...dialogSurface.getElementProps({
              part: 'header',
              className: headerClassName,
              style: headerStyle,
              includeSurfaceTokens: false,
            })}
          >
            {title ? (
              <div
                {...dialogSurface.getElementProps({
                  part: 'title',
                  className: titleClassName,
                  style: titleStyle,
                  includeSurfaceTokens: false,
                })}
              >
                {title}
              </div>
            ) : null}
            {headerActions}
          </div>
        )}
        <div
          {...dialogSurface.getElementProps({
            part: 'body',
            className: bodyClassName,
            style: bodyStyle,
            includeSurfaceTokens: false,
          })}
        >
          {children}
        </div>
        {footer ? (
          <div
            {...dialogSurface.getElementProps({
              part: 'footer',
              className: footerClassName,
              style: footerStyle,
              includeSurfaceTokens: false,
            })}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
