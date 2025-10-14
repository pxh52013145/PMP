import { useEffect, useCallback } from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { Magnet } from '../../types/pixel';
import {
  openEditorWindow,
  closeAllEditorWindows,
  calculateWindowPosition,
} from '../../utils/editorWindows';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import './EditorPanel.css';

interface EditorPanelProps {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  builtInMagnetIds: Set<string>;
}

export function EditorPanel({
  magnetLibrary,
  activeMagnetIds,
  builtInMagnetIds,
}: EditorPanelProps) {
  const { editorState } = useEditor();

  // 同步数据到 localStorage（供编辑器窗口初始化时读取）
  const syncDataToStorage = useCallback(() => {
    // 使用 requestIdleCallback 在空闲时写入，避免阻塞主线程
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        localStorage.setItem(STORAGE_KEYS.MAGNET_LIBRARY, JSON.stringify(magnetLibrary));
        localStorage.setItem(STORAGE_KEYS.ACTIVE_MAGNETS, JSON.stringify([...activeMagnetIds]));
        localStorage.setItem(STORAGE_KEYS.BUILTIN_MAGNETS, JSON.stringify([...builtInMagnetIds]));
      });
    } else {
      setTimeout(() => {
        localStorage.setItem(STORAGE_KEYS.MAGNET_LIBRARY, JSON.stringify(magnetLibrary));
        localStorage.setItem(STORAGE_KEYS.ACTIVE_MAGNETS, JSON.stringify([...activeMagnetIds]));
        localStorage.setItem(STORAGE_KEYS.BUILTIN_MAGNETS, JSON.stringify([...builtInMagnetIds]));
      }, 0);
    }
  }, [magnetLibrary, activeMagnetIds, builtInMagnetIds]);

  // 当进入编辑模式时，打开控制窗口
  useEffect(() => {
    if (editorState.isEditing) {
      // 优化：异步写入数据
      syncDataToStorage();

      // 先计算精确位置，再打开窗口
      const openControlWindow = async () => {
        try {
          // 先计算编辑器按钮附近的精确位置
          const position = await calculateWindowPosition('control');

          // 使用精确位置打开窗口
          await openEditorWindow({
            type: 'control',
            ...position,
          });
        } catch (error) {
          console.error('Failed to open control window:', error);
        }
      };

      openControlWindow();
    } else {
      // 退出编辑模式时，关闭所有窗口
      closeAllEditorWindows().catch((error) => {
        console.error('Failed to close editor windows:', error);
      });
    }
  }, [editorState.isEditing, syncDataToStorage]);

  // 实时同步数据到 localStorage（供编辑器窗口读取）
  useEffect(() => {
    if (editorState.isEditing) {
      syncDataToStorage();
    }
  }, [magnetLibrary, activeMagnetIds, builtInMagnetIds, editorState.isEditing, syncDataToStorage]);

  return null; // 不再渲染浮动面板，所有内容都在独立窗口中
}
