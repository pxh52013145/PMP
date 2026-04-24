import { memo } from 'react';
import { ornamentMediaUrl, useOrnamentsConfig } from '../../modules/ornaments-v2/store';
import { ornamentRect, sortedOrnaments } from './ornamentLayout';
import './OrnamentsRenderOverlay.css';

export const OrnamentsRenderOverlay = memo(function OrnamentsRenderOverlay() {
  const [config] = useOrnamentsConfig();
  const width = window.innerWidth;
  const height = window.innerHeight;
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
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              zIndex: item.layer.plane * 100000 + item.layer.order,
            }}
          />
        );
      })}
    </div>
  );
});
