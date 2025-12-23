/**
 * WindowPin 逻辑层
 * 负责处理窗口置顶交互
 */

import { appWindow } from '@tauri-apps/api/window';
import { WindowPinLogic } from './WindowPinTypes';
import { useWindowPinDataWithSetter } from './useWindowPinData';

export function useWindowPinLogic(): WindowPinLogic {
  const [{ isPinned }, setIsPinned] = useWindowPinDataWithSetter();

  const togglePin = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      const newPinState = !isPinned;

      await appWindow.setAlwaysOnTop(newPinState);

      // 更新状态
      setIsPinned(newPinState);
    } catch (error) {
      console.error('Failed to toggle window pin state:', error);
    }
  };

  return {
    togglePin,
  };
}
