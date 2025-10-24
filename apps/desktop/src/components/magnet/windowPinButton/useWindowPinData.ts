/**
 * WindowPin 数据层
 * 负责管理窗口置顶状态
 */

import { useState, useEffect } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { WindowPinData } from './WindowPinTypes';

export function useWindowPinData(): WindowPinData {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    // 初始化时获取窗口置顶状态
    const initPinState = async () => {
      try {
        const alwaysOnTop = await appWindow.isAlwaysOnTop?.();
        if (alwaysOnTop !== undefined) {
          setIsPinned(alwaysOnTop);
        }
      } catch (error) {
        console.error('Failed to get window pin state:', error);
      }
    };

    initPinState();
  }, []);

  return {
    isPinned,
  };
}

export function useWindowPinDataWithSetter(): [WindowPinData, React.Dispatch<React.SetStateAction<boolean>>] {
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    const initPinState = async () => {
      try {
        const alwaysOnTop = await appWindow.isAlwaysOnTop?.();
        if (alwaysOnTop !== undefined) {
          setIsPinned(alwaysOnTop);
        }
      } catch (error) {
        console.error('Failed to get window pin state:', error);
      }
    };

    initPinState();
  }, []);

  return [{ isPinned }, setIsPinned];
}
