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

    console.log('窗口置顶按钮被点击，当前状态:', isPinned);

    try {
      const newPinState = !isPinned;
      console.log('正在设置窗口置顶状态为:', newPinState);

      await appWindow.setAlwaysOnTop(newPinState);

      // 更新状态
      setIsPinned(newPinState);
      console.log(`✅ 窗口置顶: ${newPinState ? '已开启' : '已关闭'}`);
    } catch (error) {
      console.error('❌ 切换窗口置顶状态失败:', error);
    }
  };

  return {
    togglePin,
  };
}
