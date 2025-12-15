/**
 * WindowPin 数据层
 * 负责管理窗口置顶状态
 */

import { useState, useEffect } from 'react';
import { WindowPinData } from './WindowPinTypes';

const WINDOW_PIN_STORAGE_KEY = 'pixel-matrix-window-pin-state';

function readStoredPinState(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(WINDOW_PIN_STORAGE_KEY);
  return stored === 'true';
}

function persistPinState(value: boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(WINDOW_PIN_STORAGE_KEY, value ? 'true' : 'false');
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
