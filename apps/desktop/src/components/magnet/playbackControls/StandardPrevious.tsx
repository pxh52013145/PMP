import React, { useMemo } from 'react';
import { useT } from '../../../i18n';
import { PlaybackVariantProps } from './PlaybackTypes';
import { parsePlaybackStepSkinProps } from './playbackStepSkin';
import './StandardPlayback.css';

const PreviousIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="playback-step-icon" aria-hidden="true">
    <path
      d="M10.5 7.2v9.6M18 7.8L11 12l7 4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const StandardPrevious: React.FC<PlaybackVariantProps> = ({ data, logic, variantConfig }) => {
  const { hasQueue, queueLength } = data;
  const { playPrevious } = logic;
  const t = useT();
  const skinProps = useMemo(() => parsePlaybackStepSkinProps(variantConfig), [variantConfig]);

  return (
    <button
      className="playback-btn previous-btn"
      onClick={playPrevious}
      disabled={!hasQueue}
      title={t('commands.audio.previous-track.description')}
      aria-label={t('commands.audio.previous-track.description')}
    >
      <PreviousIcon />
      {skinProps.showLabel ? <span className="playback-step-label">Prev</span> : null}
      {skinProps.showQueueCount && queueLength > 0 ? (
        <span className="playback-step-count" aria-hidden="true">
          {queueLength}
        </span>
      ) : null}
    </button>
  );
};
