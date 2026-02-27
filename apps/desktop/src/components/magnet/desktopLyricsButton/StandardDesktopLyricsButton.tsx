import React from 'react';
import { DesktopLyricsButtonVariantProps } from './DesktopLyricsButtonTypes';
import './StandardDesktopLyricsButton.css';

export const StandardDesktopLyricsButton: React.FC<DesktopLyricsButtonVariantProps> = ({
  data,
  logic,
}) => {
  const {
    enabled,
    setEnabled,
    clickThrough,
    setClickThrough,
    fontSize,
    opacityPercent,
    positionPreset,
    positionOffsetX,
    positionOffsetY,
    regionWidth,
    regionHeight,
    lyricOffsetMs,
  } = data;
  const { toggleDesktopLyrics, getButtonTitle } = logic;
  const title = getButtonTitle(enabled);

  return (
    <button
      className={`desktop-lyrics-button ${enabled ? 'active' : ''}`}
      onClick={(event) =>
        void toggleDesktopLyrics(
          {
            enabled,
            clickThrough,
            fontSize,
            opacityPercent,
            positionPreset,
            positionOffsetX,
            positionOffsetY,
            regionWidth,
            regionHeight,
            lyricOffsetMs,
          },
          setEnabled,
          setClickThrough,
          event
        )
      }
      title={title}
      aria-label={title}
      aria-pressed={enabled}
    >
      <span className="desktop-lyrics-button-label">LRC</span>
    </button>
  );
};
