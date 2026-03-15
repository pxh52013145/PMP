import React, { useMemo } from 'react';
import { useT } from '../../../i18n';
import { DesktopLyricsButtonVariantProps } from './DesktopLyricsButtonTypes';
import { parseDesktopLyricsSkinProps } from './desktopLyricsSkin';
import './StandardDesktopLyricsButton.css';

export const StandardDesktopLyricsButton: React.FC<DesktopLyricsButtonVariantProps> = ({
  data,
  logic,
  variantConfig,
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
  const t = useT();
  const skinProps = useMemo(() => parseDesktopLyricsSkinProps(variantConfig), [variantConfig]);
  const title = getButtonTitle(enabled);
  const buttonLabel =
    skinProps.labelMode === 'full'
      ? t('magnet.desktopLyricsButton.label.full')
      : skinProps.labelMode === 'icon'
        ? null
        : 'LRC';

  return (
    <button
      className={`magnet-control-button desktop-lyrics-button ${enabled ? 'active' : ''}${skinProps.labelMode === 'icon' ? ' icon-only' : ''}${skinProps.showActiveIndicator ? ' has-indicator' : ''}${skinProps.showClickThroughBadge ? ' has-badge' : ''}`}
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
      <span className="desktop-lyrics-button-content">
        {skinProps.labelMode === 'icon' ? (
          <LyricsIcon />
        ) : (
          <span className="desktop-lyrics-button-label">{buttonLabel}</span>
        )}
      </span>
      {skinProps.showActiveIndicator ? (
        <span
          className={`desktop-lyrics-button-indicator ${enabled ? 'enabled' : 'disabled'}`}
          aria-hidden="true"
        />
      ) : null}
      {skinProps.showClickThroughBadge && enabled && clickThrough ? (
        <span className="desktop-lyrics-button-badge" aria-hidden="true">
          CT
        </span>
      ) : null}
    </button>
  );
};

const LyricsIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="desktop-lyrics-button-icon" aria-hidden="true">
    <path
      d="M6 7.5h12M6 12h9M6 16.5h7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);
