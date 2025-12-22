import { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, TAURI_EVENTS, setupConfigSync } from '../utils/windowCommunication';
import { loadInstalledPmpsShaderPacks, type InstalledPmpsShaderPack } from './pmps';

export function useInstalledPmpsShaderPacks(): InstalledPmpsShaderPack[] {
  const [packs, setPacks] = useState<InstalledPmpsShaderPack[]>(() => loadInstalledPmpsShaderPacks());

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      cleanup = await setupConfigSync(
        [STORAGE_KEYS.PMPS_SHADERS],
        [TAURI_EVENTS.PMPS_SHADERS_UPDATED],
        () => setPacks(loadInstalledPmpsShaderPacks())
      );
    };

    void setup();

    return () => cleanup?.();
  }, []);

  return packs;
}

export function useInstalledPmpsShaderPack(shaderId: string | null | undefined): InstalledPmpsShaderPack | null {
  const packs = useInstalledPmpsShaderPacks();

  return useMemo(() => {
    if (!shaderId) return null;
    return packs.find((pack) => pack.manifest.metadata.id === shaderId) ?? null;
  }, [packs, shaderId]);
}

