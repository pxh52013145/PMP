import { useCallback, useEffect, useState } from 'react';
import { broadcastDataUpdate, readData, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

export type MagnetChromeOverrideMode = 'maintain' | 'force-on' | 'force-off';

const DEFAULT_MODE: MagnetChromeOverrideMode = 'maintain';

function parseMagnetChromeOverrideMode(raw: unknown): MagnetChromeOverrideMode {
  if (raw === 'maintain' || raw === 'force-on' || raw === 'force-off') return raw;
  return DEFAULT_MODE;
}

export function readMagnetChromeOverrideMode(): MagnetChromeOverrideMode {
  return parseMagnetChromeOverrideMode(readData<unknown>(STORAGE_KEYS.MAGNET_CHROME_OVERRIDE_MODE_V1));
}

export function useMagnetChromeOverrideMode(): MagnetChromeOverrideMode {
  const [mode, setMode] = useState<MagnetChromeOverrideMode>(() => readMagnetChromeOverrideMode());

  const reload = useCallback(() => {
    setMode(readMagnetChromeOverrideMode());
  }, []);

  useEffect(() => {
    const cleanupPromise = setupDualListener(
      [STORAGE_KEYS.MAGNET_CHROME_OVERRIDE_MODE_V1],
      [TAURI_EVENTS.MAGNET_CHROME_OVERRIDE_MODE_UPDATED],
      reload
    );
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [reload]);

  return mode;
}

export async function setMagnetChromeOverrideMode(mode: MagnetChromeOverrideMode): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.MAGNET_CHROME_OVERRIDE_MODE_V1,
    mode,
    TAURI_EVENTS.MAGNET_CHROME_OVERRIDE_MODE_UPDATED
  );
}

