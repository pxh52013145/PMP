/**
 * WindowPin 数据层
 * 负责管理窗口置顶状态
 */

import { useState, useEffect } from 'react';
import { WindowPinData } from './WindowPinTypes';
import { readWindowPinState, writeWindowPinState } from '../../../utils/windowPinState';

function readStoredPinState(): boolean {
  if (typeof window === 'undefined') return false;
  return readWindowPinState() ?? false;
}

function persistPinState(value: boolean) {
  if (typeof window === 'undefined') return;
  writeWindowPinState(value);
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
