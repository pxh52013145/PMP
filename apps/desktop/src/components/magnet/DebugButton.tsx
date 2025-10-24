import React, { useState } from 'react';
import './DebugButton.css';

/**
 * 调试按钮组件
 * 点击后打开主题系统调试窗口
 */
export const DebugButton: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      if (isOpen) {
        // 关闭窗口
        const { closeEditorWindow } = await import('../../utils/editorWindows');
        await closeEditorWindow('debug');
        setIsOpen(false);
      } else {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import(
          '../../utils/editorWindows'
        );
        const position = await calculateWindowPosition('debug');
        await openEditorWindow({ type: 'debug', ...position });
        setIsOpen(true);
      }
    } catch (error) {
      console.error('Failed to toggle debug window:', error);
      setIsOpen(false);
    }
  };

  return (
    <button
      className={`debug-button ${isOpen ? 'active' : ''}`}
      onClick={handleClick}
      title={isOpen ? '关闭调试面板' : '打开调试面板'}
    >
      🛠️
    </button>
  );
};
