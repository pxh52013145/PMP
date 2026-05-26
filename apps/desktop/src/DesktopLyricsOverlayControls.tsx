import {
  AArrowDown,
  AArrowUp,
  Droplet,
  DropletOff,
  FastForward,
  MousePointer2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import React from 'react';
import { useDesktopLyricsOverlayT } from './desktopLyricsOverlayRuntime';

type AudioControlAction = 'previous' | 'toggle-play-pause' | 'next';

interface DesktopLyricsOverlayControlsProps {
  isPlaying: boolean;
  clickThrough: boolean;
  lyricOffsetMs: number;
  onAudioControl: (action: AudioControlAction) => void | Promise<void>;
  onToggleClickThrough: () => void | Promise<void>;
  onDecreaseFontSize: () => void | Promise<void>;
  onIncreaseFontSize: () => void | Promise<void>;
  onDecreaseOpacity: () => void | Promise<void>;
  onIncreaseOpacity: () => void | Promise<void>;
  onSlowLyrics: () => void | Promise<void>;
  onResetLyricOffset: () => void | Promise<void>;
  onFastLyrics: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
}

function stopChromePointerEvent(event: React.MouseEvent | React.PointerEvent) {
  event.stopPropagation();
}

function DesktopLyricsOverlayControls({
  isPlaying,
  clickThrough,
  lyricOffsetMs,
  onAudioControl,
  onToggleClickThrough,
  onDecreaseFontSize,
  onIncreaseFontSize,
  onDecreaseOpacity,
  onIncreaseOpacity,
  onSlowLyrics,
  onResetLyricOffset,
  onFastLyrics,
  onClose,
}: DesktopLyricsOverlayControlsProps) {
  const t = useDesktopLyricsOverlayT();
  const previousTrackTitle = t('commands.audio.previous-track.title');
  const playPauseTitle = t('commands.audio.toggle-play-pause.title');
  const nextTrackTitle = t('commands.audio.next-track.title');
  const clickThroughTitle = clickThrough
    ? t('magnet.desktopLyricsButton.contextMenu.clickThrough.disable')
    : t('magnet.desktopLyricsButton.contextMenu.clickThrough.enable');
  const smallerFontTitle = t('magnet.desktopLyricsButton.contextMenu.fontSize.small');
  const largerFontTitle = t('magnet.desktopLyricsButton.contextMenu.fontSize.large');
  const lowerOpacityTitle = t('magnet.desktopLyricsButton.contextMenu.opacity.p60');
  const higherOpacityTitle = t('magnet.desktopLyricsButton.contextMenu.opacity.p100');
  const slowerLyricTitle = t('magnet.desktopLyricsButton.contextMenu.lyricOffset.slower');
  const resetLyricOffsetTitle = t('magnet.desktopLyricsButton.contextMenu.lyricOffset.reset');
  const fasterLyricTitle = t('magnet.desktopLyricsButton.contextMenu.lyricOffset.faster');
  const closeTitle = t('magnet.desktopLyricsButton.title.disable');

  return (
    <>
      <div
        className="desktop-lyrics-overlay__audio-controls"
        onMouseDown={stopChromePointerEvent}
        onPointerDown={stopChromePointerEvent}
      >
        <button
          type="button"
          title={previousTrackTitle}
          aria-label={previousTrackTitle}
          onClick={() => void onAudioControl('previous')}
        >
          <SkipBack size={14} />
        </button>
        <button
          type="button"
          className={isPlaying ? 'is-active' : ''}
          title={playPauseTitle}
          aria-label={playPauseTitle}
          onClick={() => void onAudioControl('toggle-play-pause')}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          type="button"
          title={nextTrackTitle}
          aria-label={nextTrackTitle}
          onClick={() => void onAudioControl('next')}
        >
          <SkipForward size={14} />
        </button>
      </div>

      <div
        className="desktop-lyrics-overlay__toolbar"
        onMouseDown={stopChromePointerEvent}
        onPointerDown={stopChromePointerEvent}
      >
        <button
          type="button"
          className={clickThrough ? 'is-active' : ''}
          title={clickThroughTitle}
          aria-label={clickThroughTitle}
          onClick={() => void onToggleClickThrough()}
        >
          <MousePointer2 size={14} />
        </button>
        <button
          type="button"
          title={smallerFontTitle}
          aria-label={smallerFontTitle}
          onClick={() => void onDecreaseFontSize()}
        >
          <AArrowDown size={15} />
        </button>
        <button
          type="button"
          title={largerFontTitle}
          aria-label={largerFontTitle}
          onClick={() => void onIncreaseFontSize()}
        >
          <AArrowUp size={15} />
        </button>
        <button
          type="button"
          title={lowerOpacityTitle}
          aria-label={lowerOpacityTitle}
          onClick={() => void onDecreaseOpacity()}
        >
          <DropletOff size={14} />
        </button>
        <button
          type="button"
          title={higherOpacityTitle}
          aria-label={higherOpacityTitle}
          onClick={() => void onIncreaseOpacity()}
        >
          <Droplet size={14} />
        </button>
        <button
          type="button"
          title={slowerLyricTitle}
          aria-label={slowerLyricTitle}
          onClick={() => void onSlowLyrics()}
        >
          <Rewind size={14} />
        </button>
        <button
          type="button"
          className={lyricOffsetMs === 0 ? '' : 'is-active'}
          title={resetLyricOffsetTitle}
          aria-label={resetLyricOffsetTitle}
          onClick={() => void onResetLyricOffset()}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          title={fasterLyricTitle}
          aria-label={fasterLyricTitle}
          onClick={() => void onFastLyrics()}
        >
          <FastForward size={14} />
        </button>
        <button type="button" title={closeTitle} aria-label={closeTitle} onClick={() => void onClose()}>
          <X size={14} />
        </button>
      </div>
    </>
  );
}

export default React.memo(DesktopLyricsOverlayControls);
