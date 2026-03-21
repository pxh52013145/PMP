import React, { useMemo } from 'react';
import { WindowPinVariantProps } from './WindowPinTypes';
import { parseWindowPinSkinProps } from './windowPinSkin';
import './StandardWindowPin.css';

const PinIcon: React.FC<{ showPinnedAnchor: boolean; showPinnedShadow: boolean }> = ({
  showPinnedAnchor,
  showPinnedShadow,
}) => (
  <svg viewBox="0 0 24 24" className="window-pin-icon" aria-hidden="true">
    {showPinnedShadow ? <ellipse className="window-pin-icon-shadow" cx="12" cy="19.1" rx="4.7" ry="1.5" /> : null}
    {showPinnedAnchor ? <circle className="window-pin-icon-anchor" cx="12" cy="18.55" r="1.2" /> : null}
    <g className="window-pin-icon-assembly">
      <path className="window-pin-icon-head" d="M8.1 4.15a1 1 0 1 0 0 2h7.8a1 1 0 1 0 0-2h-7.8Z" />
      <path
        className="window-pin-icon-body"
        d="M9.15 6.15v2.8l-2.3 2.4a.9.9 0 0 0 .65 1.53h3.6v3.05a.9.9 0 1 0 1.8 0v-3.05h3.6a.9.9 0 0 0 .65-1.53l-2.3-2.4v-2.8h-5.7Z"
      />
      <path className="window-pin-icon-needle" d="M12 12.85v7.05" />
    </g>
  </svg>
);

export const StandardWindowPin: React.FC<WindowPinVariantProps> = ({ data, logic, skinProps: rawSkinProps }) => {
  const skinProps = useMemo(() => parseWindowPinSkinProps(rawSkinProps), [rawSkinProps]);

  return (
    <button
      className={`magnet-control-button window-pin-button window-pin-idle-${skinProps.idlePose} ${
        data.isPinned ? 'pinned' : 'unpinned'
      }`}
      onClick={logic.togglePin}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title={logic.getButtonTitle(data.isPinned)}
      aria-pressed={data.isPinned}
    >
      <PinIcon
        showPinnedAnchor={skinProps.showPinnedAnchor}
        showPinnedShadow={skinProps.showPinnedShadow}
      />
    </button>
  );
};

