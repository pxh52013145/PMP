import { useEffect, useRef } from 'react';
import { PixelMatrixRenderer } from '../../pixelEngine/PixelMatrixRenderer';
import './PixelMatrixCanvas.css';
import { STORAGE_KEYS, TAURI_EVENTS, setupTauriListener } from '../../utils/windowCommunication';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { readString } from '../../modules/storage';

interface PixelMatrixCanvasProps {
  onPixelPositionsUpdate?: (positions: Map<string, { x: number; y: number }>) => void;
}

export default function PixelMatrixCanvas({ onPixelPositionsUpdate }: PixelMatrixCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixelMatrixRenderer | null>(null);
  const onPixelPositionsUpdateRef = useRef(onPixelPositionsUpdate);
  const { isActive } = useWindowActivity();

  useEffect(() => {
    onPixelPositionsUpdateRef.current = onPixelPositionsUpdate;
  }, [onPixelPositionsUpdate]);

  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new PixelMatrixRenderer(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.getView());
    rendererRef.current = renderer;

    renderer.updateLayout(window.innerWidth, window.innerHeight);

    const savedShape = readString(STORAGE_KEYS.PIXEL_SHAPE);
    if (savedShape) {
      renderer.updatePixelShape(savedShape);
    }

    const savedSize = readString(STORAGE_KEYS.PIXEL_SIZE);
    if (savedSize) {
      renderer.updatePixelSize(parseFloat(savedSize));
    }

    const savedOpacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
    if (savedOpacity) {
      renderer.updatePixelOpacity(parseFloat(savedOpacity));
    }

    onPixelPositionsUpdateRef.current?.(renderer.getAllPixelPositions());

    let resizeRaf: number | null = null;
    const handleResize = () => {
      if (!rendererRef.current) return;
      if (resizeRaf !== null) return;

      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        const rendererInstance = rendererRef.current;
        if (!rendererInstance) return;

        rendererInstance.updateLayout(window.innerWidth, window.innerHeight);
        onPixelPositionsUpdateRef.current?.(rendererInstance.getAllPixelPositions());
      });
    };

    const setupPixelListeners = async () => {
      const unlisteners: (() => void)[] = [];

      const unlistenShape = await setupTauriListener(TAURI_EVENTS.PIXEL_SHAPE_UPDATED, () => {
        if (!rendererRef.current) return;
        const shape = readString(STORAGE_KEYS.PIXEL_SHAPE);
        if (shape) rendererRef.current.updatePixelShape(shape);
      });
      unlisteners.push(unlistenShape);

      const unlistenSize = await setupTauriListener(TAURI_EVENTS.PIXEL_SIZE_UPDATED, () => {
        if (!rendererRef.current) return;
        const size = readString(STORAGE_KEYS.PIXEL_SIZE);
        if (size) rendererRef.current.updatePixelSize(parseFloat(size));
      });
      unlisteners.push(unlistenSize);

      const unlistenOpacity = await setupTauriListener(TAURI_EVENTS.PIXEL_OPACITY_UPDATED, () => {
        if (!rendererRef.current) return;
        const opacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
        if (opacity) rendererRef.current.updatePixelOpacity(parseFloat(opacity));
      });
      unlisteners.push(unlistenOpacity);

      return () => {
        unlisteners.forEach((unlisten) => unlisten());
      };
    };

    window.addEventListener('resize', handleResize);
    const cleanupPromise = setupPixelListeners();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeRaf !== null) window.cancelAnimationFrame(resizeRaf);
      cleanupPromise.then((cleanup) => cleanup());
      rendererRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setActive(isActive);
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      className="pixel-matrix-canvas"
      style={{
        width: '100vw',
        height: '100vh',
      }}
    />
  );
}
