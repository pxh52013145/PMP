import { useEffect, useMemo, useState } from 'react';
import { STORAGE_KEYS, TAURI_EVENTS, setupConfigSync } from '../utils/windowCommunication';
import {
  getPmpsShaderFuseRecord,
  type PmpsShaderFuseRecord,
} from './pmpsShaderFuse';

export function usePmpsShaderFuse(
  magnetId: string,
  shaderId: string | null | undefined
): { isFused: boolean; record: PmpsShaderFuseRecord | null } {
  const [record, setRecord] = useState<PmpsShaderFuseRecord | null>(() =>
    shaderId ? getPmpsShaderFuseRecord(magnetId, shaderId) : null
  );

  useEffect(() => {
    if (!shaderId) {
      setRecord(null);
      return;
    }

    setRecord(getPmpsShaderFuseRecord(magnetId, shaderId));

    let cleanup: (() => void) | undefined;

    const setup = async () => {
      cleanup = await setupConfigSync(
        [STORAGE_KEYS.PMPS_SHADER_FUSE],
        [TAURI_EVENTS.PMPS_SHADER_FUSE_UPDATED],
        () => setRecord(getPmpsShaderFuseRecord(magnetId, shaderId))
      );
    };

    void setup();

    return () => cleanup?.();
  }, [magnetId, shaderId]);

  const isFused = useMemo(() => {
    if (!record?.disabledUntil) return false;
    return record.disabledUntil > Date.now();
  }, [record]);

  useEffect(() => {
    if (!record?.disabledUntil) return;
    const delta = record.disabledUntil - Date.now();
    if (delta <= 0) return;

    const timer = window.setTimeout(() => {
      if (shaderId) {
        setRecord(getPmpsShaderFuseRecord(magnetId, shaderId));
      }
    }, delta + 50);

    return () => window.clearTimeout(timer);
  }, [magnetId, record?.disabledUntil, shaderId]);

  return { isFused, record };
}

