import React from 'react';
import { DebugButtonVariantProps } from './DebugButtonTypes';
import './StandardDebugButton.css';

const GearIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="debug-button-icon" aria-hidden="true">
    <path d="M9.7 2.5a1 1 0 0 1 .96.74l.33 1.22a7.8 7.8 0 0 1 2.01 0l.33-1.22a1 1 0 0 1 1.22-.7l1.73.46a1 1 0 0 1 .7 1.22l-.32 1.2c.55.4 1.05.86 1.48 1.37l1.18-.31a1 1 0 0 1 1.22.7l.46 1.72a1 1 0 0 1-.7 1.23l-1.19.32c.06.66.06 1.33 0 1.99l1.19.32a1 1 0 0 1 .7 1.23l-.46 1.72a1 1 0 0 1-1.22.7l-1.18-.31c-.43.51-.93.97-1.48 1.37l.32 1.2a1 1 0 0 1-.7 1.22l-1.73.46a1 1 0 0 1-1.22-.7l-.33-1.22a7.8 7.8 0 0 1-2.01 0l-.33 1.22a1 1 0 0 1-1.22.7l-1.73-.46a1 1 0 0 1-.7-1.22l.32-1.2a7.78 7.78 0 0 1-1.48-1.37l-1.18.31a1 1 0 0 1-1.22-.7l-.46-1.72a1 1 0 0 1 .7-1.23l1.19-.32a8.2 8.2 0 0 1 0-1.99l-1.19-.32a1 1 0 0 1-.7-1.23l.46-1.72a1 1 0 0 1 1.22-.7l1.18.31c.43-.51.93-.97 1.48-1.37l-.32-1.2a1 1 0 0 1 .7-1.22l1.73-.46a1 1 0 0 1 .26-.03Zm2.3 6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
  </svg>
);

export const StandardDebugButton: React.FC<DebugButtonVariantProps> = ({ data, logic }) => {
  const { isOpen, setIsOpen } = data;
  const { toggleDebugWindow, getButtonTitle } = logic;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await toggleDebugWindow(isOpen, setIsOpen);
  };

  return (
    <button
      className={`debug-button ${isOpen ? 'active' : ''}`}
      onClick={handleClick}
      title={getButtonTitle(isOpen)}
      aria-label={getButtonTitle(isOpen)}
    >
      <GearIcon />
    </button>
  );
};
