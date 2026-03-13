import React from 'react';
import { BackButtonVariantProps } from './BackButtonTypes';
import './StandardBackButton.css';

const BackIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="back-button-icon" aria-hidden="true">
    <path d="M14.7 6.3a1 1 0 0 1 0 1.4L11.41 11H19a1 1 0 1 1 0 2h-7.59l3.3 3.3a1 1 0 0 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.41 0Z" />
  </svg>
);

export const StandardBackButton: React.FC<BackButtonVariantProps> = ({ data, logic }) => {
  const { canGoBack } = data;
  const { goBack, getButtonTitle } = logic;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canGoBack) {
      goBack();
    }
  };

  return (
    <button
      className={`magnet-control-button back-button ${!canGoBack ? 'back-button-disabled' : ''}`}
      onClick={handleClick}
      disabled={!canGoBack}
      title={getButtonTitle(canGoBack)}
    >
      <BackIcon />
    </button>
  );
};
