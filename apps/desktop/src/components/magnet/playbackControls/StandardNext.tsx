import React, { useMemo } from 'react';
import { useT } from '../../../i18n';
import { PlaybackVariantProps } from './PlaybackTypes';
import { parsePlaybackStepSkinProps } from './playbackStepSkin';
import './StandardPlayback.css';

const NextIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="playback-step-icon" aria-hidden="true">
    <path
      d="M13.5 7.2v9.6M6 7.8L13 12l-7 4.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const StandardNext: React.FC<PlaybackVariantProps> = ({ data, logic, skinProps: rawSkinProps }) => {
  const { hasQueue, queueLength } = data;
  const { playNext } = logic;
  const t = useT();
  const skinProps = useMemo(() => parsePlaybackStepSkinProps(rawSkinProps), [rawSkinProps]);

  return (
    <button
      className="playback-btn next-btn"
      onClick={playNext}
      disabled={!hasQueue}
      title={t('commands.audio.next-track.description')}
      aria-label={t('commands.audio.next-track.description')}
    >
      <NextIcon />
      {skinProps.showLabel ? <span className="playback-step-label">Next</span> : null}
      {skinProps.showQueueCount && queueLength > 0 ? (
        <span className="playback-step-count" aria-hidden="true">
          {queueLength}
        </span>
      ) : null}
    </button>
  );
};

