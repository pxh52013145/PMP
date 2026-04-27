import { LogicalPosition, LogicalSize, appWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import './WindowResizeHandles.css';

type ResizeDirection = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

type ResizeSession = {
  direction: ResizeDirection;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  scaleFactor: number;
};

const MIN_WIDTH = 526;
const MIN_HEIGHT = 400;

const DIRECTIONS: ResizeDirection[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

function isWindowsRuntime(): boolean {
  return document.documentElement.dataset.pmpPlatform === 'windows';
}

function resolveNextGeometry(session: ResizeSession, event: PointerEvent) {
  const deltaX = (event.clientX - session.startClientX) * session.scaleFactor;
  const deltaY = (event.clientY - session.startClientY) * session.scaleFactor;
  const touchesNorth = session.direction.includes('n');
  const touchesSouth = session.direction.includes('s');
  const touchesWest = session.direction.includes('w');
  const touchesEast = session.direction.includes('e');

  let nextX = session.startX;
  let nextY = session.startY;
  let nextWidth = session.startWidth;
  let nextHeight = session.startHeight;

  if (touchesEast) {
    nextWidth = Math.max(MIN_WIDTH, session.startWidth + deltaX);
  }
  if (touchesSouth) {
    nextHeight = Math.max(MIN_HEIGHT, session.startHeight + deltaY);
  }
  if (touchesWest) {
    nextWidth = Math.max(MIN_WIDTH, session.startWidth - deltaX);
    nextX = session.startX + (session.startWidth - nextWidth);
  }
  if (touchesNorth) {
    nextHeight = Math.max(MIN_HEIGHT, session.startHeight - deltaY);
    nextY = session.startY + (session.startHeight - nextHeight);
  }

  return { x: nextX, y: nextY, width: nextWidth, height: nextHeight };
}

async function startFallbackResize(
  event: React.PointerEvent<HTMLDivElement>,
  direction: ResizeDirection
): Promise<void> {
  if (event.button !== 0) return;

  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);

  const [scaleFactor, position, size] = await Promise.all([
    appWindow.scaleFactor(),
    appWindow.outerPosition(),
    appWindow.innerSize(),
  ]);

  const session: ResizeSession = {
    direction,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: position.x,
    startY: position.y,
    startWidth: size.width,
    startHeight: size.height,
    scaleFactor,
  };

  let frame: number | null = null;
  let pendingEvent: PointerEvent | null = null;

  const cleanup = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
    }
    pendingEvent = null;
    window.removeEventListener('pointermove', handleMove, true);
    window.removeEventListener('pointerup', cleanup, true);
    window.removeEventListener('pointercancel', cleanup, true);
    window.removeEventListener('blur', cleanup, true);
    document.removeEventListener('visibilitychange', handleVisibilityChange, true);
    document.body.classList.remove('window-resize-handles--resizing');
  };

  const flushMove = () => {
    frame = null;
    if (!pendingEvent) return;
    const next = resolveNextGeometry(session, pendingEvent);
    pendingEvent = null;
    void appWindow.setPosition(
      new LogicalPosition(next.x / session.scaleFactor, next.y / session.scaleFactor)
    );
    void appWindow.setSize(
      new LogicalSize(next.width / session.scaleFactor, next.height / session.scaleFactor)
    );
  };

  const handleMove = (moveEvent: PointerEvent) => {
    moveEvent.preventDefault();
    pendingEvent = moveEvent;
    if (frame === null) {
      frame = window.requestAnimationFrame(flushMove);
    }
  };

  const handleVisibilityChange = () => {
    if (document.hidden) cleanup();
  };

  document.body.classList.add('window-resize-handles--resizing');
  window.addEventListener('pointermove', handleMove, true);
  window.addEventListener('pointerup', cleanup, true);
  window.addEventListener('pointercancel', cleanup, true);
  window.addEventListener('blur', cleanup, true);
  document.addEventListener('visibilitychange', handleVisibilityChange, true);
}

export default function WindowResizeHandles() {
  if (!isTauriRuntime()) return null;
  if (isWindowsRuntime()) {
    // Windows borderless resizing is handled natively by tao/Tauri hit-testing
    // as long as the main window itself is resizable.
    return null;
  }

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    direction: ResizeDirection
  ) => {
    void startFallbackResize(event, direction);
  };

  return (
    <div className="window-resize-handles" aria-hidden="true">
      {DIRECTIONS.map((direction) => (
        <div
          key={direction}
          className={`window-resize-handles__handle window-resize-handles__handle--${direction}`}
          onPointerDown={(event) => handlePointerDown(event, direction)}
        />
      ))}
    </div>
  );
}
