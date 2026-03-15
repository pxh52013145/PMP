import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { mergeComponentThemes } from '../../themes/mergeComponentTheme';
import { createResolvedSkinSurfaceModel } from '../../themes/skinSurface';
import {
  buildThemePresenceAnimationStyle,
  getThemeMotionTotalMs,
  pickThemeMotionChannel,
  useThemePresenceState,
} from '../../themes/surfaceMotion';
import type { ThemeBindingId, ThemeMotionChannelSpec, ThemeSurfaceId } from '../../themes/types/theme';

const DEFAULT_OVERLAY_ENTER_MOTION: ThemeMotionChannelSpec = {
  preset: 'fade',
  duration: 120,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

const DEFAULT_OVERLAY_EXIT_MOTION: ThemeMotionChannelSpec = {
  preset: 'fade',
  duration: 120,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

const DEFAULT_DIALOG_ENTER_MOTION: ThemeMotionChannelSpec = {
  preset: 'scale-in',
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

const DEFAULT_DIALOG_EXIT_MOTION: ThemeMotionChannelSpec = {
  preset: 'fade-up',
  duration: 140,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
};

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
  const overlayPart = useMemo(
    () => overlaySurface.getPart('overlay', { includeSurfaceTokens: false }),
    [overlaySurface]
  );
  const overlayEnterMotion = useMemo(
    () => pickThemeMotionChannel(overlayPart.motion, ['enter']),
    [overlayPart.motion]
  );
  const overlayExitMotion = useMemo(
    () => pickThemeMotionChannel(overlayPart.motion, ['exit']),
    [overlayPart.motion]
  );
  const dialogEnterMotion = useMemo(
    () => pickThemeMotionChannel(dialogSurface.root.motion, ['enter']),
    [dialogSurface.root.motion]
  );
  const dialogExitMotion = useMemo(
    () => pickThemeMotionChannel(dialogSurface.root.motion, ['exit']),
    [dialogSurface.root.motion]
  );
  const presence = useThemePresenceState({
    open,
    enterDurationMs: Math.max(
      getThemeMotionTotalMs(overlayEnterMotion?.spec ?? DEFAULT_OVERLAY_ENTER_MOTION),
      getThemeMotionTotalMs(dialogEnterMotion?.spec ?? DEFAULT_DIALOG_ENTER_MOTION)
    ),
    exitDurationMs: Math.max(
      getThemeMotionTotalMs(overlayExitMotion?.spec ?? DEFAULT_OVERLAY_EXIT_MOTION),
      getThemeMotionTotalMs(dialogExitMotion?.spec ?? DEFAULT_DIALOG_EXIT_MOTION)
    ),
  });
  const [backdropCloseArmed, setBackdropCloseArmed] = useState(false);

  useEffect(() => {
    if (!open || !presence.rendered) {
      setBackdropCloseArmed(false);
      return;
    }

    setBackdropCloseArmed(false);
    const timer = window.setTimeout(() => {
      setBackdropCloseArmed(true);
    }, 80);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, presence.rendered]);

  if (!presence.rendered) {
    return null;
  }

  const handleBackdropClick = () => {
    if (!closeOnBackdrop || !backdropCloseArmed) return;
    onClose?.();
  };
  const overlayActiveMotion = presence.phase === 'enter' ? overlayEnterMotion : presence.phase === 'exit' ? overlayExitMotion : undefined;
  const dialogActiveMotion = presence.phase === 'enter' ? dialogEnterMotion : presence.phase === 'exit' ? dialogExitMotion : undefined;
  const overlayMotionStyle =
    presence.phase === 'enter' || presence.phase === 'exit'
      ? buildThemePresenceAnimationStyle(
          overlayActiveMotion?.spec ??
            (presence.phase === 'enter' ? DEFAULT_OVERLAY_ENTER_MOTION : DEFAULT_OVERLAY_EXIT_MOTION),
          presence.phase
        )
      : undefined;
  const dialogMotionStyle =
    presence.phase === 'enter' || presence.phase === 'exit'
      ? buildThemePresenceAnimationStyle(
          dialogActiveMotion?.spec ??
            (presence.phase === 'enter' ? DEFAULT_DIALOG_ENTER_MOTION : DEFAULT_DIALOG_EXIT_MOTION),
          presence.phase
        )
      : undefined;

  return createPortal(
    <div
      {...overlaySurface.getElementProps({
        part: 'overlay',
        bindingId: overlaySurfaceId as ThemeBindingId,
        className: overlayClassName,
        style: {
          ...overlayStyle,
          ...overlayMotionStyle,
        },
      })}
      data-surface-id={overlaySurfaceId}
      data-surface-variant={overlayTheme.variant}
      data-open={open ? 'true' : 'false'}
      data-pmp-motion-phase={presence.phase}
      {...(overlayActiveMotion?.name ? { 'data-pmp-motion-channel': overlayActiveMotion.name } : {})}
      {...(overlayActiveMotion?.spec.preset ? { 'data-pmp-motion-preset': overlayActiveMotion.spec.preset } : {})}
      onClick={handleBackdropClick}
    >
      <div
        {...dialogSurface.getElementProps({
          bindingId: dialogSurfaceId as ThemeBindingId,
          className,
          style: {
            ...overlaySurface.getPart('root', { includeSurfaceTokens: false }).style,
            ...style,
            ...dialogMotionStyle,
          },
        })}
        data-surface-id-dialog={dialogSurfaceId}
        data-surface-variant-dialog={dialogTheme.variant}
        data-open={open ? 'true' : 'false'}
        data-pmp-motion-phase={presence.phase}
        {...(dialogActiveMotion?.name ? { 'data-pmp-motion-channel': dialogActiveMotion.name } : {})}
        {...(dialogActiveMotion?.spec.preset ? { 'data-pmp-motion-preset': dialogActiveMotion.spec.preset } : {})}
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
