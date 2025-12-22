import { useEffect, useState } from 'react';
import { STORAGE_KEYS, TAURI_EVENTS, setupConfigSync } from '../utils/windowCommunication';
import {
  getPmpsMagnetUniformOverrides,
  type PmpsUniformValues,
} from './pmpsMagnetUniforms';

export function usePmpsMagnetUniformOverrides(
  magnetId: string,
  shaderId: string | null | undefined
): PmpsUniformValues {
  const [uniforms, setUniforms] = useState<PmpsUniformValues>(() =>
    shaderId ? getPmpsMagnetUniformOverrides(magnetId, shaderId) : {}
  );

  useEffect(() => {
    if (!shaderId) {
      setUniforms({});
      return;
    }

    setUniforms(getPmpsMagnetUniformOverrides(magnetId, shaderId));

    let cleanup: (() => void) | undefined;

    const setup = async () => {
      cleanup = await setupConfigSync(
        [STORAGE_KEYS.PMPS_MAGNET_UNIFORMS],
        [TAURI_EVENTS.PMPS_UNIFORMS_UPDATED],
        () => setUniforms(getPmpsMagnetUniformOverrides(magnetId, shaderId))
      );
    };

    void setup();

    return () => cleanup?.();
  }, [magnetId, shaderId]);

  return uniforms;
}
