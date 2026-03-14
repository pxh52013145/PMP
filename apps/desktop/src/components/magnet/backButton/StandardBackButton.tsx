import React from 'react';
import { BackButtonVariantProps } from './BackButtonTypes';
import './StandardBackButton.css';

const BackIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="back-button-icon" aria-hidden="true">
    <path
      className="back-button-icon-base"
      d="M15.83 4.89a1.35 1.35 0 0 1 0 1.92L10.52 12l5.31 5.2a1.35 1.35 0 1 1-1.89 1.92L7.7 13a1.4 1.4 0 0 1 0-1.98l6.24-6.13a1.35 1.35 0 0 1 1.89 0Z"
    />
    <path
      className="back-button-icon-highlight"
      d="M14.42 6.07a.78.78 0 0 1 0 1.1L10.6 11l3.82 3.82a.78.78 0 1 1-1.1 1.1L8.95 11.55a.78.78 0 0 1 0-1.1l4.38-4.38a.78.78 0 0 1 1.1 0Z"
    />
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
