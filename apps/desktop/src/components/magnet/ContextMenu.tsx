/**
 * 右键菜单组件
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // 调整菜单位置，避免超出屏幕
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      // 估算菜单尺寸（如果还没渲染）
      const menuWidth = rect.width || 200;
      const menuHeight = rect.height || items.length * 40;

      const MARGIN = 15; // 边距

      // 水平方向调整
      // 右侧超出 - 显示在鼠标左侧
      if (x + menuWidth > windowWidth - MARGIN) {
        adjustedX = Math.max(MARGIN, x - menuWidth);
      }

      // 左侧超出
      if (adjustedX < MARGIN) {
        adjustedX = MARGIN;
      }

      // 垂直方向调整（优化）
      // 底部超出 - 显示在鼠标上方
      if (y + menuHeight > windowHeight - MARGIN) {
        // 优先显示在鼠标上方
        adjustedY = y - menuHeight;

        // 如果上方也放不下，则居中显示
        if (adjustedY < MARGIN) {
          adjustedY = Math.max(MARGIN, (windowHeight - menuHeight) / 2);
        }
      }

      // 顶部超出
      if (adjustedY < MARGIN) {
        adjustedY = MARGIN;
      }

      // 确保菜单不超出底部
      if (adjustedY + menuHeight > windowHeight - MARGIN) {
        adjustedY = windowHeight - menuHeight - MARGIN;
      }

      setPosition({ x: adjustedX, y: adjustedY });
    }
  }, [x, y, items.length]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      onClose();
    }
  };

  return createPortal(
    <div className="context-menu-overlay" onClick={onClose}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: position.x, top: position.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((item, index) => (
          <React.Fragment key={index}>
            {item.divider ? (
              <div className="context-menu-divider" />
            ) : (
              <div
                className={`context-menu-item ${item.disabled ? 'disabled' : ''} ${item.danger ? 'danger' : ''}`}
                onClick={() => handleItemClick(item)}
              >
                {item.icon && <span className="context-menu-icon">{item.icon}</span>}
                <span className="context-menu-label">{item.label}</span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>,
    document.body
  );
};
