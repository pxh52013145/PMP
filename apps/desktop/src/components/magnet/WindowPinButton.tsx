import { useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import './WindowPinButton.css';

export function WindowPinButton() {
  const [isPinned, setIsPinned] = useState(false);

  const handleTogglePin = async (e: React.MouseEvent) => {
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

  return (
    <button
      className={`window-pin-button ${isPinned ? 'pinned' : ''}`}
      onClick={handleTogglePin}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title={isPinned ? '取消置顶' : '置顶窗口'}
    >
      📌
    </button>
  );
}
