import { ReactNode, useCallback, useMemo } from 'react';
import type { Magnet } from '../../types/pixel';
import { useAudioService } from '../../contexts/AudioEngineContext';
import { PmpsShaderLayer } from '../../shader-system/PmpsShaderLayer';
import { parseMagnetShaderConfig } from '../../shader-system/magnetShaderConfig';
import { resolvePmpsUniformValues } from '../../shader-system/pmpsMagnetUniforms';
import { recordPmpsShaderError } from '../../shader-system/pmpsShaderFuse';
import { usePmpsMagnetShaderBinding } from '../../shader-system/usePmpsMagnetShaderBinding';
import { usePmpsMagnetUniformOverrides } from '../../shader-system/usePmpsMagnetUniformOverrides';
import { usePmpsShaderFuse } from '../../shader-system/usePmpsShaderFuse';
import { useInstalledPmpsShaderPack } from '../../shader-system/usePmpsShaderPacks';

export type MagnetFrameProps = {
  magnet: Magnet;
  bounds: { width: number; height: number };
  children: ReactNode;
};

export function MagnetFrame({ magnet, bounds, children }: MagnetFrameProps) {
  const audioService = useAudioService();
  const binding = usePmpsMagnetShaderBinding(magnet.id);
  const parsedShaderConfig = useMemo(() => parseMagnetShaderConfig(magnet.variantConfig), [magnet.variantConfig]);

  const effectiveShaderId = binding ? binding.shaderId : parsedShaderConfig?.shaderId ?? null;
  const enabled = binding ? binding.enabled !== false : parsedShaderConfig?.enabled === true;
  const getFrequencyData = useCallback(() => audioService.getFrequencyData?.() ?? null, [audioService]);

  const shaderPack = useInstalledPmpsShaderPack(effectiveShaderId);
  const fuse = usePmpsShaderFuse(magnet.id, effectiveShaderId);

  const uniformOverrides = usePmpsMagnetUniformOverrides(magnet.id, effectiveShaderId);
  const uniformValues = useMemo(() => {
    if (!shaderPack) return {};
    return resolvePmpsUniformValues(shaderPack.manifest, uniformOverrides);
  }, [shaderPack, uniformOverrides]);

  const fpsLimit = (binding?.fpsLimit ?? parsedShaderConfig?.fpsLimit) ?? shaderPack?.manifest.render?.fpsLimit;
  const resolutionScale =
    (binding?.resolutionScale ?? parsedShaderConfig?.resolutionScale) ?? shaderPack?.manifest.render?.resolutionScale;
  const entryPoint = (binding?.entryPoint ?? parsedShaderConfig?.entryPoint) ?? shaderPack?.manifest.entry.entryPoint;

  if (!enabled || !effectiveShaderId || !shaderPack || fuse.isFused) {
    return <>{children}</>;
  }

  return (
    <>
      <PmpsShaderLayer
        shaderId={effectiveShaderId}
        fragmentCode={shaderPack.fragmentCode}
        entryPoint={entryPoint}
        width={bounds.width}
        height={bounds.height}
        fpsLimit={fpsLimit}
        resolutionScale={resolutionScale}
        getFrequencyData={getFrequencyData}
        uniformValues={uniformValues}
        onError={(error) => recordPmpsShaderError(magnet.id, effectiveShaderId, error)}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: -1,
          borderRadius: 'inherit',
        }}
      />
      {children}
    </>
  );
}
