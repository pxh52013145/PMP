import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type PopupVerticalPlacement = 'top' | 'bottom';
type PopupHorizontalPlacement = 'start' | 'center' | 'end';
export type PopupPlacement = `${PopupVerticalPlacement}-${PopupHorizontalPlacement}`;

interface CollisionAwarePopupProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  role?: string;
  placement?: PopupPlacement;
  offset?: number;
  viewportPadding?: number;
  children: React.ReactNode;
}

type PopupPosition = {
  left: number;
  top: number;
};

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function computePopupPosition(
  placement: PopupPlacement,
  anchorRect: DOMRect,
  popupRect: DOMRect,
  offset: number
): PopupPosition {
  const [vertical, horizontal] = placement.split('-') as [PopupVerticalPlacement, PopupHorizontalPlacement];

  const top =
    vertical === 'top'
      ? anchorRect.top - popupRect.height - offset
      : anchorRect.bottom + offset;

  let left = anchorRect.left;
  if (horizontal === 'center') {
    left = anchorRect.left + (anchorRect.width - popupRect.width) / 2;
  } else if (horizontal === 'end') {
    left = anchorRect.right - popupRect.width;
  }

  return { top, left };
}

function measureOverflow(
  candidate: PopupPosition,
  popupRect: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
  viewportPadding: number
): number {
  const overflowTop = Math.max(0, viewportPadding - candidate.top);
  const overflowBottom = Math.max(0, candidate.top + popupRect.height + viewportPadding - viewportHeight);
  const overflowLeft = Math.max(0, viewportPadding - candidate.left);
  const overflowRight = Math.max(0, candidate.left + popupRect.width + viewportPadding - viewportWidth);

  return overflowTop + overflowBottom + overflowLeft + overflowRight;
}

function flipVerticalPlacement(placement: PopupPlacement): PopupPlacement {
  const [vertical, horizontal] = placement.split('-') as [PopupVerticalPlacement, PopupHorizontalPlacement];
  const nextVertical: PopupVerticalPlacement = vertical === 'top' ? 'bottom' : 'top';
  return `${nextVertical}-${horizontal}`;
}

export const CollisionAwarePopup = React.forwardRef<HTMLDivElement, CollisionAwarePopupProps>(
  (
    {
      open,
      anchorRef,
      className,
      role,
      placement = 'top-start',
      offset = 8,
      viewportPadding = 8,
      children,
    },
    forwardedRef
  ) => {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [style, setStyle] = useState<React.CSSProperties>({
      position: 'fixed',
      left: 0,
      top: 0,
      visibility: 'hidden',
      zIndex: 1000,
    });

    const setPopupNode = useCallback(
      (node: HTMLDivElement | null) => {
        popupRef.current = node;

        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
          return;
        }

        if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef]
    );

    const updatePosition = useCallback(() => {
      if (!open) return;

      const anchorNode = anchorRef.current;
      const popupNode = popupRef.current;
      if (!anchorNode || !popupNode) return;

      const anchorRect = anchorNode.getBoundingClientRect();
      const popupRect = popupNode.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const preferredCandidate = computePopupPosition(placement, anchorRect, popupRect, offset);
      const flippedPlacement = flipVerticalPlacement(placement);
      const flippedCandidate = computePopupPosition(flippedPlacement, anchorRect, popupRect, offset);

      const preferredOverflow = measureOverflow(
        preferredCandidate,
        popupRect,
        viewportWidth,
        viewportHeight,
        viewportPadding
      );
      const flippedOverflow = measureOverflow(
        flippedCandidate,
        popupRect,
        viewportWidth,
        viewportHeight,
        viewportPadding
      );

      const bestCandidate = flippedOverflow < preferredOverflow ? flippedCandidate : preferredCandidate;

      const maxLeft = Math.max(viewportPadding, viewportWidth - popupRect.width - viewportPadding);
      const maxTop = Math.max(viewportPadding, viewportHeight - popupRect.height - viewportPadding);
      const left = clamp(bestCandidate.left, viewportPadding, maxLeft);
      const top = clamp(bestCandidate.top, viewportPadding, maxTop);

      setStyle({
        position: 'fixed',
        left: Math.round(left),
        top: Math.round(top),
        visibility: 'visible',
        zIndex: 1000,
      });
    }, [anchorRef, offset, open, placement, viewportPadding]);

    useLayoutEffect(() => {
      if (!open) return;

      updatePosition();
      const rafId = window.requestAnimationFrame(updatePosition);
      return () => window.cancelAnimationFrame(rafId);
    }, [open, updatePosition]);

    useEffect(() => {
      if (!open) return;

      const handleRelayout = () => {
        updatePosition();
      };

      window.addEventListener('resize', handleRelayout);
      window.addEventListener('scroll', handleRelayout, true);

      const resizeObserver =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => handleRelayout()) : null;
      if (resizeObserver) {
        if (anchorRef.current) resizeObserver.observe(anchorRef.current);
        if (popupRef.current) resizeObserver.observe(popupRef.current);
      }

      return () => {
        window.removeEventListener('resize', handleRelayout);
        window.removeEventListener('scroll', handleRelayout, true);
        resizeObserver?.disconnect();
      };
    }, [anchorRef, open, updatePosition]);

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    return createPortal(
      <div ref={setPopupNode} className={className} style={style} role={role}>
        {children}
      </div>,
      document.body
    );
  }
);

CollisionAwarePopup.displayName = 'CollisionAwarePopup';
