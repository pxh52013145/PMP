import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
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

  useEffect(() => {
    if (!menuRef.current) {
      return;
    }

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const menuWidth = rect.width || 200;
    const menuHeight = rect.height || items.length * 40;
    const margin = 15;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > windowWidth - margin) {
      adjustedX = Math.max(margin, x - menuWidth);
    }
    if (adjustedX < margin) {
      adjustedX = margin;
    }

    if (y + menuHeight > windowHeight - margin) {
      adjustedY = y - menuHeight;
      if (adjustedY < margin) {
        adjustedY = Math.max(margin, (windowHeight - menuHeight) / 2);
      }
    }
    if (adjustedY < margin) {
      adjustedY = margin;
    }
    if (adjustedY + menuHeight > windowHeight - margin) {
      adjustedY = windowHeight - menuHeight - margin;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y, items.length]);

  const handleItemClick = (item: ContextMenuItem) => {
    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    if (item.disabled || hasChildren) {
      return;
    }
    item.onClick?.();
    onClose();
  };

  const renderItems = (menuItems: ContextMenuItem[], nested = false): React.ReactNode => {
    return menuItems.map((item, index) => {
      if (item.divider) {
        return <div className="context-menu-divider" key={`${nested ? 'sub' : 'root'}-divider-${index}`} />;
      }

      const hasChildren = Array.isArray(item.children) && item.children.length > 0;

      return (
        <div
          key={`${nested ? 'sub' : 'root'}-item-${index}`}
          className={[
            'context-menu-item',
            item.disabled ? 'disabled' : '',
            item.danger ? 'danger' : '',
            hasChildren ? 'context-menu-item-has-children' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => handleItemClick(item)}
        >
          {item.icon ? <span className="context-menu-icon">{item.icon}</span> : null}
          <span className="context-menu-label">{item.label ?? ''}</span>
          {hasChildren ? <span className="context-menu-submenu-arrow">›</span> : null}
          {hasChildren ? <div className="context-submenu">{renderItems(item.children ?? [], true)}</div> : null}
        </div>
      );
    });
  };

  return createPortal(
    <div className="context-menu-overlay" onClick={onClose}>
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: position.x, top: position.y }}
        onClick={(event) => event.stopPropagation()}
      >
        {renderItems(items)}
      </div>
    </div>,
    document.body
  );
};

