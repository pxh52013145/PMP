import { MagnetComponent } from './Magnet';
import { Magnet } from '../../types/pixel';

interface MagnetLayerProps {
  magnets: Magnet[];
  pixelPositions: Map<string, { x: number; y: number }>;
}

/**
 * Magnet 层
 * 负责渲染所有的 Magnet 组件
 */
export function MagnetLayer({ magnets, pixelPositions }: MagnetLayerProps) {
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
          <MagnetComponent magnet={magnet} pixelPositions={pixelPositions} />
        </div>
      ))}
    </div>
  );
}
