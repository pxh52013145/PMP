import { useEffect, useRef } from 'react';
import { PixelMatrixRenderer } from '../../pixelEngine/PixelMatrixRenderer';
import './PixelMatrixCanvas.css';
import { STORAGE_KEYS, TAURI_EVENTS, setupTauriListener } from '../../utils/windowCommunication';
import { useWindowActivity } from '../../contexts/WindowActivityContext';

interface PixelMatrixCanvasProps {
  onPixelPositionsUpdate?: (positions: Map<string, { x: number; y: number }>) => void;
}

export default function PixelMatrixCanvas({ onPixelPositionsUpdate }: PixelMatrixCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixelMatrixRenderer | null>(null);
  const { isActive } = useWindowActivity();

  useEffect(() => {
    if (!containerRef.current) return;

    // 初始化渲染器
    const renderer = new PixelMatrixRenderer(window.innerWidth, window.innerHeight);
    containerRef.current.appendChild(renderer.getView());
    rendererRef.current = renderer;

    // 初始布局
    renderer.updateLayout(window.innerWidth, window.innerHeight);

    // 应用已保存的形状设置
    const savedShape = localStorage.getItem(STORAGE_KEYS.PIXEL_SHAPE);
    if (savedShape) {
      renderer.updatePixelShape(savedShape);
    }

    // 应用已保存的尺寸设置
    const savedSize = localStorage.getItem(STORAGE_KEYS.PIXEL_SIZE);
    if (savedSize) {
      renderer.updatePixelSize(parseFloat(savedSize));
    }

    // 应用已保存的透明度设置
    const savedOpacity = localStorage.getItem(STORAGE_KEYS.PIXEL_OPACITY);
    if (savedOpacity) {
      renderer.updatePixelOpacity(parseFloat(savedOpacity));
    }

    // 通知父组件 Pixel 位置已更新
    if (onPixelPositionsUpdate) {
      const positions = renderer.getAllPixelPositions();
      onPixelPositionsUpdate(positions);
    }

    // 监听窗口尺寸变化
    const handleResize = () => {
      if (rendererRef.current) {
        rendererRef.current.updateLayout(window.innerWidth, window.innerHeight);

        // 窗口缩放后，通知父组件 Pixel 位置已更新
        if (onPixelPositionsUpdate) {
          const positions = rendererRef.current.getAllPixelPositions();
          onPixelPositionsUpdate(positions);
        }
      }
    };

    // 监听 Pixel 形状和尺寸变化（使用 Tauri 事件）
    const setupPixelListeners = async () => {
      const unlisteners: (() => void)[] = [];

      // 监听形状变化
      const unlistenShape = await setupTauriListener(TAURI_EVENTS.PIXEL_SHAPE_UPDATED, () => {
        if (rendererRef.current) {
          const shape = localStorage.getItem(STORAGE_KEYS.PIXEL_SHAPE);
          if (shape) {
            rendererRef.current.updatePixelShape(shape);
          }
        }
      });
      unlisteners.push(unlistenShape);

      // 监听尺寸变化
      const unlistenSize = await setupTauriListener(TAURI_EVENTS.PIXEL_SIZE_UPDATED, () => {
        if (rendererRef.current) {
          const size = localStorage.getItem(STORAGE_KEYS.PIXEL_SIZE);
          if (size) {
            rendererRef.current.updatePixelSize(parseFloat(size));
          }
        }
      });
      unlisteners.push(unlistenSize);

      // 监听透明度变化
      const unlistenOpacity = await setupTauriListener(TAURI_EVENTS.PIXEL_OPACITY_UPDATED, () => {
        if (rendererRef.current) {
          const opacity = localStorage.getItem(STORAGE_KEYS.PIXEL_OPACITY);
          if (opacity) {
            rendererRef.current.updatePixelOpacity(parseFloat(opacity));
          }
        }
      });
      unlisteners.push(unlistenOpacity);

      return () => {
        unlisteners.forEach((unlisten) => unlisten());
      };
    };

    window.addEventListener('resize', handleResize);
    let cleanupPromise = setupPixelListeners();

    // 清理函数
    return () => {
      window.removeEventListener('resize', handleResize);
      cleanupPromise.then((cleanup) => cleanup());
      if (rendererRef.current) {
        rendererRef.current.destroy();
      }
    };
  }, [onPixelPositionsUpdate]);

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
