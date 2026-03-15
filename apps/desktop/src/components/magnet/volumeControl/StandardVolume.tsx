import React, { useMemo } from 'react';
import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import { VolumeVariantProps } from './VolumeTypes';
import { parseVolumeSkinProps } from './volumeSkin';
import './StandardVolume.css';

export const StandardVolume: React.FC<VolumeVariantProps> = ({ data, logic, variantConfig }) => {
  const { volume, muted } = data;
  const {
    popupState,
    containerRef,
    popupRef,
    togglePopup,
    setVolume,
    toggleMute,
    getVolumeIcon,
    formatVolumePercent,
  } = logic;
  const skinProps = useMemo(() => parseVolumeSkinProps(variantConfig), [variantConfig]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVolume = parseFloat(e.target.value);
    setVolume(nextVolume);
  };

  return (
    <>
      <div className="volume-control-container" ref={containerRef}>
        <button className="volume-btn" onClick={togglePopup} title={formatVolumePercent(volume)}>
          {getVolumeIcon(volume, muted)}
        </button>
      </div>

      <CollisionAwarePopup
        ref={popupRef}
        open={popupState.show}
        anchorRef={containerRef}
        placement={skinProps.popupPlacement}
        offset={6}
        viewportPadding={8}
        className={`volume-slider-popup volume-slider-popup-portal ${
          !skinProps.showValue ? 'volume-slider-popup-no-value' : ''
        } ${!skinProps.showMuteToggle ? 'volume-slider-popup-no-mute' : ''}`}
        role="dialog"
      >
        {skinProps.showValue ? <span className="volume-value">{formatVolumePercent(volume)}</span> : null}
        <div className="volume-slider-container">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolumeChange}
            className="volume-slider"
            disabled={muted}
          />
        </div>
        {skinProps.showMuteToggle ? (
          <button className="volume-mute-btn" onClick={toggleMute}>
            {muted ? 'M' : 'U'}
          </button>
        ) : null}
      </CollisionAwarePopup>
    </>
  );
};
