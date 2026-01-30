import { useEffect, useMemo, useState } from 'react';
import { readJson } from '../../modules/storage';
import { DEFAULT_ORNAMENTS_CONFIG, normalizeOrnamentsConfig } from '../../modules/ornaments';
import { setupConfigSync, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import type { OrnamentAnchor, OrnamentsConfig } from '../../types/ornaments';
import './OrnamentsLayer.css';

function getAnchorStyle(anchor: OrnamentAnchor): React.CSSProperties {
  switch (anchor) {
    case 'top-left':
      return { top: 0, left: 0 };
    case 'top':
      return { top: 0, left: '50%', transform: 'translateX(-50%)' };
    case 'top-right':
      return { top: 0, right: 0 };
    case 'left':
      return { top: '50%', left: 0, transform: 'translateY(-50%)' };
    case 'center':
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    case 'right':
      return { top: '50%', right: 0, transform: 'translateY(-50%)' };
    case 'bottom-left':
      return { bottom: 0, left: 0 };
    case 'bottom':
      return { bottom: 0, left: '50%', transform: 'translateX(-50%)' };
    case 'bottom-right':
      return { bottom: 0, right: 0 };
  }
}

function loadOrnamentsConfig(): OrnamentsConfig {
  const raw = readJson<unknown>(STORAGE_KEYS.ORNAMENTS_V1, DEFAULT_ORNAMENTS_CONFIG);
  return normalizeOrnamentsConfig(raw);
}

export function OrnamentsLayer() {
  const [config, setConfig] = useState<OrnamentsConfig>(() => loadOrnamentsConfig());

  useEffect(() => {
    const reload = () => setConfig(loadOrnamentsConfig());
    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.ORNAMENTS_V1],
      [TAURI_EVENTS.ORNAMENTS_UPDATED],
      reload
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  const { background, foreground } = useMemo(() => {
    const enabled = config.items.filter((item) => item.enabled);
    return {
      background: enabled.filter((item) => item.transform.layer === 'background'),
      foreground: enabled.filter((item) => item.transform.layer === 'foreground'),
    };
  }, [config.items]);

  if (background.length === 0 && foreground.length === 0) return null;

  return (
    <>
      {background.length > 0 && (
        <div className="ornaments-layer ornaments-layer--background" aria-hidden="true">
          {background.map((item) => (
            <div key={item.id} className="ornament-item" style={getAnchorStyle(item.transform.anchor)}>
              <div
                className="ornament-item__content"
                style={{
                  transform: `translate(${item.transform.offsetX}px, ${item.transform.offsetY}px)`,
                  width: item.transform.width,
                  height: item.transform.height,
                  opacity: item.transform.opacity,
                }}
              >
                <img src={item.media.url} alt="" draggable={false} />
              </div>
            </div>
          ))}
        </div>
      )}

      {foreground.length > 0 && (
        <div className="ornaments-layer ornaments-layer--foreground" aria-hidden="true">
          {foreground.map((item) => (
            <div key={item.id} className="ornament-item" style={getAnchorStyle(item.transform.anchor)}>
              <div
                className="ornament-item__content"
                style={{
                  transform: `translate(${item.transform.offsetX}px, ${item.transform.offsetY}px)`,
                  width: item.transform.width,
                  height: item.transform.height,
                  opacity: item.transform.opacity,
                }}
              >
                <img src={item.media.url} alt="" draggable={false} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
