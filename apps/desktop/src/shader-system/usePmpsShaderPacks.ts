import { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, TAURI_EVENTS, setupConfigSync } from '../utils/windowCommunication';
import {
  loadInstalledPmpsShaderPacks,
  resolveInstalledPmpsShaderPack,
  type InstalledPmpsShaderPack,
  type ResolvedPmpsShaderPack,
} from './pmps';

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

export function useInstalledPmpsShaderPack(
  shaderId: string | null | undefined
): ResolvedPmpsShaderPack | null {
  const packs = useInstalledPmpsShaderPacks();

  const [resolved, setResolved] = useState<ResolvedPmpsShaderPack | null>(null);

  const packExists = useMemo(() => {
    if (!shaderId) return false;
    return packs.some((pack) => pack.manifest.metadata.id === shaderId);
  }, [packs, shaderId]);

  useEffect(() => {
    if (!shaderId || !packExists) {
      setResolved(null);
      return;
    }

    let cancelled = false;
    void resolveInstalledPmpsShaderPack(shaderId)
      .then((next) => {
        if (cancelled) return;
        setResolved(next);
      })
      .catch(() => {
        if (cancelled) return;
        setResolved(null);
      });

    return () => {
      cancelled = true;
    };
  }, [packExists, shaderId]);

  return resolved;
}
