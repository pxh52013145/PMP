/**
 * WindowPin 数据层
 * 负责管理窗口置顶状态
 */

import { useState, useEffect } from 'react';
import { WindowPinData } from './WindowPinTypes';
import { readWindowPinPreference } from '../../../utils/windowPinState';
import { setupConfigSync, STORAGE_KEYS, TAURI_EVENTS } from '../../../utils/windowCommunication';

function readStoredPinState(): boolean {
  if (typeof window === 'undefined') return false;
  return readWindowPinPreference();
}

export function useWindowPinData(): WindowPinData {
  const [data] = useWindowPinDataWithSetter();
  return data;
}

export function useWindowPinDataWithSetter(): [
  WindowPinData,
  React.Dispatch<React.SetStateAction<boolean>>
] {
  const [isPinned, setIsPinned] = useState<boolean>(() => readStoredPinState());

  useEffect(() => {
    const reload = () => {
      setIsPinned(readStoredPinState());
    };

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.WINDOW_PIN_STATE],
      [TAURI_EVENTS.WINDOW_PIN_STATE_UPDATED],
      reload
    );

    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, []);

  return [{ isPinned }, setIsPinned];
}
