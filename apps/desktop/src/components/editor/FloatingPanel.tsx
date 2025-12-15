import React, { useRef, useState, useCallback, useEffect } from 'react';
import './FloatingPanel.css';

interface FloatingPanelProps {
  title: string;
  children: React.ReactNode;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  isCollapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  onClose?: () => void;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  disableClose?: boolean; // 新增：禁用关闭按钮
}

export function FloatingPanel({
  title,
  children,
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 300, height: 400 },
  isCollapsed: externalIsCollapsed,
  onCollapse,
  onClose,
  minWidth = 200,
  minHeight = 100,
  maxWidth = 800,
  maxHeight = 600,
  disableClose = false,
}: FloatingPanelProps) {
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState(initialSize);
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const panelRef = useRef<HTMLDivElement>(null);

  // 使用外部控制的 collapsed 状态，或者内部状态
  const isCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;

  // 处理标题栏拖动
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('.panel-button')) return; // 忽略按钮点击
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      });
    },
    [position]
  );

  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      // 限制在窗口范围内
      const maxX = window.innerWidth - 100; // 至少保留 100px 可见
      const maxY = window.innerHeight - 40; // 至少保留标题栏可见

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    },
    [isDragging, dragStart]
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 处理窗口缩放
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    setDragStart({ x: e.clientX, y: e.clientY });
  }, []);

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !resizeDirection) return;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      let newWidth = size.width;
      let newHeight = size.height;
      let newX = position.x;
      let newY = position.y;

      if (resizeDirection.includes('e')) {
        newWidth = Math.max(minWidth, Math.min(maxWidth, size.width + deltaX));
      }
      if (resizeDirection.includes('s')) {
        newHeight = Math.max(minHeight, Math.min(maxHeight, size.height + deltaY));
      }
      if (resizeDirection.includes('w')) {
        const candidateWidth = size.width - deltaX;
        if (candidateWidth >= minWidth && candidateWidth <= maxWidth) {
          newWidth = candidateWidth;
          newX = position.x + deltaX;
        }
      }
      if (resizeDirection.includes('n')) {
        const candidateHeight = size.height - deltaY;
        if (candidateHeight >= minHeight && candidateHeight <= maxHeight) {
          newHeight = candidateHeight;
          newY = position.y + deltaY;
        }
      }

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
      setDragStart({ x: e.clientX, y: e.clientY });
    },
    [
      isResizing,
      resizeDirection,
      dragStart,
      size,
      position,
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
    ]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    setResizeDirection(null);
  }, []);

  // 处理折叠/展开
  const handleToggleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed;
    if (onCollapse) {
      onCollapse(newCollapsed);
    } else {
      setInternalIsCollapsed(newCollapsed);
    }
  }, [isCollapsed, onCollapse]);

  // 全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleDrag);
      document.addEventListener('mouseup', handleDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [isDragging, handleDrag, handleDragEnd]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  return (
    <div
      ref={panelRef}
      className={`floating-panel ${isCollapsed ? 'collapsed' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: isCollapsed ? 'auto' : size.height,
      }}
    >
      {/* 标题栏 */}
      <div className="floating-panel-header" onMouseDown={handleDragStart}>
        <span className="floating-panel-title">{title}</span>
        <div className="floating-panel-buttons">
          <button
            className="panel-button collapse-button"
            onClick={handleToggleCollapse}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed ? '▼' : '▲'}
          </button>
          {onClose && !disableClose && (
            <button className="panel-button close-button" onClick={onClose} title="关闭">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      {!isCollapsed && (
        <>
          <div className="floating-panel-content">{children}</div>

          {/* 缩放手柄 */}
          <div className="resize-handle resize-e" onMouseDown={(e) => handleResizeStart(e, 'e')} />
          <div className="resize-handle resize-s" onMouseDown={(e) => handleResizeStart(e, 's')} />
          <div className="resize-handle resize-w" onMouseDown={(e) => handleResizeStart(e, 'w')} />
          <div className="resize-handle resize-n" onMouseDown={(e) => handleResizeStart(e, 'n')} />
          <div
            className="resize-handle resize-se"
            onMouseDown={(e) => handleResizeStart(e, 'se')}
          />
          <div
            className="resize-handle resize-sw"
            onMouseDown={(e) => handleResizeStart(e, 'sw')}
          />
          <div
            className="resize-handle resize-ne"
            onMouseDown={(e) => handleResizeStart(e, 'ne')}
          />
          <div
            className="resize-handle resize-nw"
            onMouseDown={(e) => handleResizeStart(e, 'nw')}
          />
        </>
      )}
    </div>
  );
}
