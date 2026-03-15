import React, { useMemo } from 'react';
import { PlayModeVariantProps } from './PlayModeTypes';
import { parsePlayModeSkinProps } from './playModeSkin';
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

function getModeMeta(mode: string): { icon: React.ReactNode; title: string; badge: string } {
  if (mode === 'shuffle') {
    return { icon: <ShuffleIcon />, title: 'Shuffle', badge: 'RAND' };
  }
  if (mode === 'single-loop') {
    return { icon: <SingleLoopIcon />, title: 'Single Loop', badge: 'ONE' };
  }
  if (mode === 'loop') {
    return { icon: <LoopIcon />, title: 'Loop', badge: 'LOOP' };
  }
  return { icon: <SequenceIcon />, title: 'Sequence', badge: 'SEQ' };
}

export const MinimalPlayMode: React.FC<PlayModeVariantProps> = ({ data, logic, variantConfig }) => {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const skinProps = useMemo(() => parsePlayModeSkinProps(variantConfig), [variantConfig]);

  const triggerPulse = () => {
    if (!skinProps.pulseOnSwitch) return;
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
      className={`minimal-play-mode-btn mode-${data.playMode} play-mode-ring-${skinProps.ringVisibility}`}
      onClick={handleClick}
      title={meta.title}
      aria-label={meta.title}
    >
      {meta.icon}
      {skinProps.showModeBadge ? <span className="play-mode-badge">{meta.badge}</span> : null}
    </button>
  );
};
