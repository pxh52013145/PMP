import type { MagnetAnimation, MagnetStyle } from '../../types/pixel';
import { DEFAULT_MAGNET_CORNER_RADIUS } from './stylePolicy';

interface MagnetChromePresetOptions {
  style?: MagnetStyle;
  hoverStyle?: MagnetStyle;
  activeStyle?: MagnetStyle;
  dragStyle?: MagnetStyle;
  transition?: string;
}

const GEOMETRY_TRANSITION =
  'left 180ms cubic-bezier(0.4, 0, 0.2, 1), top 180ms cubic-bezier(0.4, 0, 0.2, 1), width 180ms cubic-bezier(0.4, 0, 0.2, 1), height 180ms cubic-bezier(0.4, 0, 0.2, 1)';

export const DEFAULT_MAGNET_TRANSITION =
  `${GEOMETRY_TRANSITION}, transform 140ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 180ms ease, color 140ms ease, opacity 140ms ease, filter 180ms ease`;

export const DEFAULT_PANEL_TRANSITION =
  `${GEOMETRY_TRANSITION}, background-color 180ms ease, border-color 180ms ease, box-shadow 220ms ease, opacity 160ms ease, filter 180ms ease`;

export const DEFAULT_DRAG_HANDLE_TRANSITION =
  `${GEOMETRY_TRANSITION}, transform 140ms ease, background-color 160ms ease, border-color 160ms ease, box-shadow 180ms ease, color 140ms ease, opacity 140ms ease`;

const DEFAULT_CONTROL_STYLE: MagnetStyle = {
  width: '36px',
  height: '36px',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: DEFAULT_MAGNET_CORNER_RADIUS,
};

const DEFAULT_CONTROL_HOVER_STYLE: MagnetStyle = {
  transform: 'scale(1.05)',
  backgroundColor: 'rgba(60, 60, 60, 0.9)',
  boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
};

const DEFAULT_CONTROL_ACTIVE_STYLE: MagnetStyle = {
  transform: 'scale(0.95)',
};

const DEFAULT_PANEL_STYLE: MagnetStyle = {
  backgroundColor: 'rgba(0, 0, 0, 0.45)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: DEFAULT_MAGNET_CORNER_RADIUS,
  overflow: 'hidden',
};

const DEFAULT_PANEL_HOVER_STYLE: MagnetStyle = {
  border: '1px solid rgba(255, 255, 255, 0.15)',
};

const DEFAULT_DRAG_HANDLE_STYLE: MagnetStyle = {
  height: '36px',
  backgroundColor: 'rgba(0, 0, 0, 0.72)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: DEFAULT_MAGNET_CORNER_RADIUS,
  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.32)',
  fontSize: '15px',
  fontWeight: '700',
  letterSpacing: '2px',
  color: 'rgba(255, 255, 255, 0.62)',
  cursor: 'grab',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const DEFAULT_DRAG_HANDLE_HOVER_STYLE: MagnetStyle = {
  transform: 'translateY(-1px)',
  backgroundColor: 'rgba(60, 60, 60, 0.9)',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.36)',
  color: 'rgba(255, 255, 255, 0.82)',
};

const DEFAULT_DRAG_HANDLE_ACTIVE_STYLE: MagnetStyle = {
  transform: 'translateY(0)',
  backgroundColor: 'rgba(32, 32, 32, 0.92)',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.28)',
  color: 'rgba(255, 255, 255, 0.92)',
};

const DEFAULT_DRAG_HANDLE_DRAG_STYLE: MagnetStyle = {
  backgroundColor: 'rgba(76, 76, 76, 0.96)',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.42)',
  color: 'rgba(255, 255, 255, 0.96)',
  cursor: 'grabbing',
};

function createAnimation(
  base: { hoverStyle?: MagnetStyle; activeStyle?: MagnetStyle; dragStyle?: MagnetStyle },
  options: MagnetChromePresetOptions,
  fallbackTransition = DEFAULT_MAGNET_TRANSITION
): MagnetAnimation {
  return {
    transition: options.transition ?? fallbackTransition,
    ...(base.hoverStyle || options.hoverStyle
      ? { hoverStyle: { ...(base.hoverStyle ?? {}), ...(options.hoverStyle ?? {}) } }
      : {}),
    ...(base.activeStyle || options.activeStyle
      ? { activeStyle: { ...(base.activeStyle ?? {}), ...(options.activeStyle ?? {}) } }
      : {}),
    ...(base.dragStyle || options.dragStyle
      ? { dragStyle: { ...(base.dragStyle ?? {}), ...(options.dragStyle ?? {}) } }
      : {}),
  };
}

export function createControlChromePreset(options: MagnetChromePresetOptions = {}) {
  return {
    style: {
      ...DEFAULT_CONTROL_STYLE,
      ...(options.style ?? {}),
    },
    animation: createAnimation(
      {
        hoverStyle: DEFAULT_CONTROL_HOVER_STYLE,
        activeStyle: DEFAULT_CONTROL_ACTIVE_STYLE,
      },
      options
    ),
  };
}

export function createPanelChromePreset(options: MagnetChromePresetOptions = {}) {
  return {
    style: {
      ...DEFAULT_PANEL_STYLE,
      ...(options.style ?? {}),
    },
    animation: createAnimation(
      {
        hoverStyle: DEFAULT_PANEL_HOVER_STYLE,
      },
      options,
      DEFAULT_PANEL_TRANSITION
    ),
  };
}

export function createDragHandleChromePreset(options: MagnetChromePresetOptions = {}) {
  return {
    style: {
      ...DEFAULT_DRAG_HANDLE_STYLE,
      ...(options.style ?? {}),
    },
    animation: createAnimation(
      {
        hoverStyle: DEFAULT_DRAG_HANDLE_HOVER_STYLE,
        activeStyle: DEFAULT_DRAG_HANDLE_ACTIVE_STYLE,
        dragStyle: DEFAULT_DRAG_HANDLE_DRAG_STYLE,
      },
      options,
      DEFAULT_DRAG_HANDLE_TRANSITION
    ),
  };
}
