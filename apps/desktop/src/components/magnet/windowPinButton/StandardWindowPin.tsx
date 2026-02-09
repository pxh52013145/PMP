import React from 'react';
import { WindowPinVariantProps } from './WindowPinTypes';
import './StandardWindowPin.css';

const PinIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="window-pin-icon" aria-hidden="true">
    <path d="M8 4a1 1 0 1 0 0 2h1v3.17l-2.59 2.58A1 1 0 0 0 7.12 13H11v7a1 1 0 1 0 2 0v-7h3.88a1 1 0 0 0 .71-1.7L15 9.17V6h1a1 1 0 1 0 0-2H8Z" />
  </svg>
);

export const StandardWindowPin: React.FC<WindowPinVariantProps> = ({ data, logic }) => {
  return (
    <button
      className={`window-pin-button ${data.isPinned ? 'pinned' : 'unpinned'}`}
      onClick={logic.togglePin}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title={logic.getButtonTitle(data.isPinned)}
      aria-pressed={data.isPinned}
    >
      <PinIcon />
    </button>
  );
};
