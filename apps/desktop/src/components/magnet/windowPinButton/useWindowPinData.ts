/**
 * WindowPin 数据层
 * 负责管理窗口置顶状态
 */

import { useState, useEffect } from 'react';
import { WindowPinData } from './WindowPinTypes';
import { readString, writeString } from '../../../modules/storage';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';

function readStoredPinState(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = readString(STORAGE_KEYS.WINDOW_PIN_STATE);
  return stored === 'true';
}

function persistPinState(value: boolean) {
  if (typeof window === 'undefined') return;
  writeString(STORAGE_KEYS.WINDOW_PIN_STATE, value ? 'true' : 'false');
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
    persistPinState(isPinned);
  }, [isPinned]);

  return [{ isPinned }, setIsPinned];
}
