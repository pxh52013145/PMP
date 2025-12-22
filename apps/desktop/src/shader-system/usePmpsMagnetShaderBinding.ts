import { useEffect, useState } from 'react';
import { STORAGE_KEYS, TAURI_EVENTS, setupConfigSync } from '../utils/windowCommunication';
import { getPmpsMagnetShaderBinding, type PmpsMagnetShaderBinding } from './pmpsMagnetShaderBindings';

export function usePmpsMagnetShaderBinding(magnetId: string): PmpsMagnetShaderBinding | null {
  const [binding, setBinding] = useState<PmpsMagnetShaderBinding | null>(() =>
    getPmpsMagnetShaderBinding(magnetId)
  );

  useEffect(() => {
    setBinding(getPmpsMagnetShaderBinding(magnetId));

    let cleanup: (() => void) | undefined;

    const setup = async () => {
      cleanup = await setupConfigSync(
        [STORAGE_KEYS.PMPS_MAGNET_SHADER_BINDINGS],
        [TAURI_EVENTS.PMPS_MAGNET_SHADER_BINDINGS_UPDATED],
        () => setBinding(getPmpsMagnetShaderBinding(magnetId))
      );
    };

    void setup();

    return () => cleanup?.();
  }, [magnetId]);

  return binding;
}

