import React, { useMemo } from 'react';
import { useT } from '../../../i18n';
import { PlaybackVariantProps } from './PlaybackTypes';
import { buildCoverGradient } from '../shared/useDynamicColor';
import { parsePlayPauseSkinProps } from './playPauseSkin';
import './CyberPlayback.css';

export const CyberPlayPause: React.FC<PlaybackVariantProps> = ({
  data,
  logic,
  dynamicColors,
  dynamicColorConfig,
  variantConfig,
}) => {
  const { playbackState, queueLength } = data;
  const { togglePlayPause, getPlayPauseIcon, getPlayPauseTitle, isPlayPauseDisabled } = logic;
  const t = useT();
  const skinProps = useMemo(() => parsePlayPauseSkinProps(variantConfig), [variantConfig]);
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
  const stateLabel =
    playbackState === 'loading' || playbackState === 'buffering'
      ? t('common.state.loading')
      : playbackState === 'playing'
        ? t('pages.native-debug.transport.pause')
        : t('common.action.play');
  const pulseClass =
    skinProps.pulseMode === 'always'
      ? 'play-pause-pulse-always'
      : skinProps.pulseMode === 'none'
        ? 'play-pause-pulse-none'
        : 'play-pause-pulse-playing';

  return (
    <button
      className={`cyber-playback-btn cyber-play-pause-btn ${pulseClass}${skinProps.showStateLabel ? ' has-state-label' : ''}${playbackState === 'playing' ? ' playing' : ''}${dynamicColors ? ' cover-color-active' : ''}${effect === 'gradient' ? ' cover-color-gradient' : ''}${effect === 'dynamic' ? ' cover-color-dynamic' : ''}`}
      onClick={togglePlayPause}
      disabled={isPlayPauseDisabled(playbackState)}
      title={getPlayPauseTitle(playbackState)}
      style={playPauseStyle}
    >
      <span className="play-pause-content">
        <span className="play-pause-icon" aria-hidden="true">
          {getPlayPauseIcon(playbackState)}
        </span>
        {skinProps.showStateLabel ? <span className="play-pause-state-label">{stateLabel}</span> : null}
      </span>
      {skinProps.showQueueCount && queueLength > 0 ? (
        <span className="play-pause-queue-count" aria-hidden="true">
          {queueLength}
        </span>
      ) : null}
    </button>
  );
};

