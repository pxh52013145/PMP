import React from 'react';
import { PlayModeVariantProps } from './PlayModeTypes';
import './MinimalPlayMode.css';

const SequenceIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="play-mode-icon" aria-hidden="true">
    <path d="M5 7h7.2" />
    <path d="M5 12h7.2" />
    <path d="M5 17h7.2" />
    <path d="M17.6 6.2v11.6" />
    <path d="M16 16.2l1.6 1.6 1.6-1.6" />
  </svg>
);

const LoopIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="play-mode-icon" aria-hidden="true">
    <path d="M6 9a4.5 4.5 0 0 1 4.5-4.5h4" />
    <path d="M13.6 2.8l2.6 1.7-2.6 1.7" />
    <path d="M18 15a4.5 4.5 0 0 1-4.5 4.5h-4" />
    <path d="M10.4 21.2l-2.6-1.7 2.6-1.7" />
    <circle cx="12" cy="12" r="2.1" />
  </svg>
);

const SingleLoopIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="play-mode-icon" aria-hidden="true">
    <path d="M6 8a4 4 0 0 1 4-4h6" />
    <path d="M14 2l3 2-3 2" />
    <path d="M18 16a4 4 0 0 1-4 4H8" />
    <path d="M10 22l-3-2 3-2" />
    <path d="M12.3 9.5v5.4" />
    <path d="M11.3 10.5l1-1" />
    <path d="M11 14.9h2.6" />
  </svg>
);

const ShuffleIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="play-mode-icon" aria-hidden="true">
    <path d="M16 4h4v4" />
    <path d="M4 20L20 4" />
    <path d="M20 16v4h-4" />
    <path d="M4 4l6 6" />
    <path d="M14 14l6 6" />
  </svg>
);

function getModeMeta(mode: string): { icon: React.ReactNode; text: string } {
  if (mode === 'shuffle') {
    return { icon: <ShuffleIcon />, text: '随机播放' };
  }
  if (mode === 'single-loop') {
    return { icon: <SingleLoopIcon />, text: '单曲循环' };
  }
  if (mode === 'loop') {
    return { icon: <LoopIcon />, text: '列表循环' };
  }
  return { icon: <SequenceIcon />, text: '顺序播放' };
}

export const MinimalPlayMode: React.FC<PlayModeVariantProps> = ({ data, logic }) => {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const triggerPulse = () => {
    const button = buttonRef.current;
    if (!button) return;
    button.classList.remove('click-pulse');
    void button.offsetWidth;
    button.classList.add('click-pulse');
    window.setTimeout(() => {
      button.classList.remove('click-pulse');
    }, 1200);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerPulse();
    logic.cyclePlayMode(data.playMode);
  };

  const meta = getModeMeta(data.playMode);

  return (
    <button
      ref={buttonRef}
      className={`minimal-play-mode-btn mode-${data.playMode}`}
      onClick={handleClick}
      title={meta.text}
      aria-label={meta.text}
    >
      {meta.icon}
    </button>
  );
};
