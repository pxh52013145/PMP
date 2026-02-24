import React from 'react';
import { PlaybackVariantProps } from './PlaybackTypes';
import { buildCoverGradient } from '../shared/useDynamicColor';
import './CyberPlayback.css';

export const CyberPlayPause: React.FC<PlaybackVariantProps> = ({
  data,
  logic,
  dynamicColors,
  dynamicColorConfig,
}) => {
  const { playbackState } = data;
  const { togglePlayPause, getPlayPauseIcon, getPlayPauseTitle, isPlayPauseDisabled } = logic;
  const effect = dynamicColorConfig?.effect ?? 'tone';
  const gradientAngle =
    typeof dynamicColorConfig?.gradientAngle === 'number' && isFinite(dynamicColorConfig.gradientAngle)
      ? dynamicColorConfig.gradientAngle
      : 120;
  const dynamicSpeed =
    typeof dynamicColorConfig?.dynamicSpeed === 'number' && isFinite(dynamicColorConfig.dynamicSpeed)
      ? dynamicColorConfig.dynamicSpeed
      : 6;

  const playPauseStyle = dynamicColors
    ? ({
        '--playback-accent-color': dynamicColors.accentColor,
        '--playback-text-color': dynamicColors.textColor,
        '--playback-surface-bg':
          effect === 'tone'
            ? `radial-gradient(circle, color-mix(in srgb, ${dynamicColors.accentColor} 35%, transparent) 0%, transparent 72%)`
            : buildCoverGradient(dynamicColors, gradientAngle),
        '--playback-hover-surface-bg':
          effect === 'tone'
            ? `radial-gradient(circle, color-mix(in srgb, ${dynamicColors.accentColor} 65%, transparent) 0%, transparent 72%)`
            : buildCoverGradient(dynamicColors, gradientAngle + 28),
        '--playback-animation-duration': `${dynamicSpeed}s`,
      } as React.CSSProperties)
    : undefined;

  return (
    <button
      className={`cyber-playback-btn cyber-play-pause-btn${playbackState === 'playing' ? ' playing' : ''}${dynamicColors ? ' cover-color-active' : ''}${effect === 'gradient' ? ' cover-color-gradient' : ''}${effect === 'dynamic' ? ' cover-color-dynamic' : ''}`}
      onClick={togglePlayPause}
      disabled={isPlayPauseDisabled(playbackState)}
      title={getPlayPauseTitle(playbackState)}
      style={playPauseStyle}
    >
      {getPlayPauseIcon(playbackState)}
    </button>
  );
};

