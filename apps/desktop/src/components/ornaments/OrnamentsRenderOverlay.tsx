import { memo } from 'react';
import { ornamentMediaUrl, useOrnamentsConfig } from '../../modules/ornaments-v2/store';
import { ornamentRect, sortedOrnaments } from './ornamentLayout';
import './OrnamentsRenderOverlay.css';

const EDIT_MARGIN = 240;

export const OrnamentsRenderOverlay = memo(function OrnamentsRenderOverlay() {
  const [config] = useOrnamentsConfig();
  const width = Math.max(1, window.innerWidth - EDIT_MARGIN * 2);
  const height = Math.max(1, window.innerHeight - EDIT_MARGIN * 2);
  const plane = window.location.hash.includes('/behind') ? -1 : 1;

  return (
    <div className="ornaments-render-overlay">
      {sortedOrnaments(config.items).filter((item) => item.layer.plane === plane).map((item) => {
        const rect = ornamentRect(item, width, height);
        return (
          <img
            key={item.id}
            className="ornaments-render-overlay__item"
            src={ornamentMediaUrl(item)}
            alt=""
            draggable={false}
            style={{
              left: rect.left + EDIT_MARGIN,
              top: rect.top + EDIT_MARGIN,
              width: rect.width,
              height: rect.height,
              zIndex: item.layer.order,
            }}
          />
        );
      })}
    </div>
  );
});
