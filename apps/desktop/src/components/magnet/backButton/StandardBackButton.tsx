import React, { useMemo } from 'react';
import { BackButtonVariantProps } from './BackButtonTypes';
import { parseBackButtonSkinProps } from './backButtonSkin';
import './StandardBackButton.css';

const BackIcon: React.FC<{ iconStyle: 'filled' | 'outline' }> = ({ iconStyle }) =>
  iconStyle === 'outline' ? (
    <svg viewBox="0 0 24 24" className="back-button-icon back-button-icon-outline" aria-hidden="true">
      <path
        d="M15.5 5.5L9 12l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
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

export const StandardBackButton: React.FC<BackButtonVariantProps> = ({ data, logic, variantConfig }) => {
  const { canGoBack } = data;
  const { goBack, getButtonTitle } = logic;
  const skinProps = useMemo(() => parseBackButtonSkinProps(variantConfig), [variantConfig]);
  const historyCount = Math.max(0, data.historyLength - 1);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (canGoBack) {
      goBack();
    }
  };

  return (
    <button
      className={`magnet-control-button back-button back-button-${skinProps.iconStyle} ${
        !canGoBack ? 'back-button-disabled' : ''
      }`}
      onClick={handleClick}
      disabled={!canGoBack}
      title={getButtonTitle(canGoBack)}
    >
      <BackIcon iconStyle={skinProps.iconStyle} />
      {skinProps.showHistoryCount && historyCount > 0 ? (
        <span className="back-button-count" aria-hidden="true">
          {historyCount}
        </span>
      ) : null}
    </button>
  );
};
