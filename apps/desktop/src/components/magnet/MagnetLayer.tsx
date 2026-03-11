import { useEffect, useMemo, useState } from 'react';
import { MagnetComponent } from './Magnet';
import type { Magnet } from '../../types/pixel';
import type { MagnetChromeOverrideMode } from '../../modules/magnets';
import { buildAdaptiveMagnetLayout } from '../../modules/magnets/layoutAdaptive';

interface MagnetLayerProps {
  magnets: Magnet[];
  pixelPositions: Map<string, { x: number; y: number }>;
  chromeOverrideMode?: MagnetChromeOverrideMode;
}

function readViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function MagnetLayer({ magnets, pixelPositions, chromeOverrideMode }: MagnetLayerProps) {
  const [viewportSize, setViewportSize] = useState(readViewportSize);

  useEffect(() => {
    let resizeRaf: number | null = null;

    const handleResize = () => {
      if (resizeRaf !== null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        setViewportSize(readViewportSize());
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeRaf !== null) {
        window.cancelAnimationFrame(resizeRaf);
      }
    };
  }, []);

  const adaptiveLayout = useMemo(
    () => buildAdaptiveMagnetLayout(magnets, pixelPositions, viewportSize),
    [magnets, pixelPositions, viewportSize]
  );

  return (
    <div
      className="magnet-layer"
      data-layout-mode={adaptiveLayout.mode}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {magnets.map((magnet) => (
        <div key={magnet.id} style={{ pointerEvents: 'auto' }}>
          <MagnetComponent
            magnet={magnet}
            pixelPositions={pixelPositions}
            chromeOverrideMode={chromeOverrideMode}
            boundsOverride={adaptiveLayout.boundsByMagnetId[magnet.id]}
            layoutMode={adaptiveLayout.mode}
            joinEdges={adaptiveLayout.joinsByMagnetId[magnet.id]}
          />
        </div>
      ))}
    </div>
  );
}
