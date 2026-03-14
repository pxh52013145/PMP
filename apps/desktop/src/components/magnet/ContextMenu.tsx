import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSkinSurface } from '../../themes/contexts/ThemeContextWithSync';
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
  const surfaceTheme = useSkinSurface('overlay.context-menu');

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
        return (
          <div
            className={['context-menu-divider', surfaceTheme.classNameOverride?.divider].filter(Boolean).join(' ')}
            key={`${nested ? 'sub' : 'root'}-divider-${index}`}
            style={surfaceTheme.styleOverride?.divider}
          />
        );
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
            surfaceTheme.classNameOverride?.item,
          ]
            .filter(Boolean)
            .join(' ')}
          data-surface-role="item"
          data-surface-variant={surfaceTheme.variant}
          style={{
            ...surfaceTheme.styleOverride?.item,
            ...(item.disabled ? surfaceTheme.styleOverride?.disabled : undefined),
            ...(item.danger ? surfaceTheme.styleOverride?.danger : undefined),
          }}
          onClick={() => handleItemClick(item)}
        >
          {item.icon ? (
            <span className="context-menu-icon" style={surfaceTheme.styleOverride?.icon}>
              {item.icon}
            </span>
          ) : null}
          <span className="context-menu-label" style={surfaceTheme.styleOverride?.label}>
            {item.label ?? ''}
          </span>
          {hasChildren ? (
            <span className="context-menu-submenu-arrow" style={surfaceTheme.styleOverride?.arrow}>
              {'>'}
            </span>
          ) : null}
          {hasChildren ? (
            <div
              className={['context-submenu', surfaceTheme.classNameOverride?.submenu].filter(Boolean).join(' ')}
              style={surfaceTheme.styleOverride?.submenu}
            >
              {renderItems(item.children ?? [], true)}
            </div>
          ) : null}
        </div>
      );
    });
  };

  return createPortal(
    <div
      className={['context-menu-overlay', surfaceTheme.classNameOverride?.overlay].filter(Boolean).join(' ')}
      data-surface-id="overlay.context-menu"
      data-surface-variant={surfaceTheme.variant}
      style={surfaceTheme.styleOverride?.overlay}
      onClick={onClose}
    >
      <div
        ref={menuRef}
        className={['context-menu', surfaceTheme.classNameOverride?.container].filter(Boolean).join(' ')}
        style={{ left: position.x, top: position.y, ...surfaceTheme.styleOverride?.container }}
        onClick={(event) => event.stopPropagation()}
      >
        {renderItems(items)}
      </div>
    </div>,
    document.body
  );
};
