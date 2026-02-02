import { MagnetComponent } from './Magnet';
import { Magnet } from '../../types/pixel';
import type { MagnetChromeOverrideMode } from '../../modules/magnets';

interface MagnetLayerProps {
  magnets: Magnet[];
  pixelPositions: Map<string, { x: number; y: number }>;
  chromeOverrideMode?: MagnetChromeOverrideMode;
}

/**
 * Magnet 层
 * 负责渲染所有的 Magnet 组件
 */
export function MagnetLayer({ magnets, pixelPositions, chromeOverrideMode }: MagnetLayerProps) {
  return (
    <div
      className="magnet-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {magnets.map((magnet) => (
        <div key={magnet.id} style={{ pointerEvents: 'auto' }}>
          <MagnetComponent magnet={magnet} pixelPositions={pixelPositions} chromeOverrideMode={chromeOverrideMode} />
        </div>
      ))}
    </div>
  );
}
