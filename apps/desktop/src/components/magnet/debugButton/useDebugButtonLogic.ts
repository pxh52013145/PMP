/**
 * DebugButton 逻辑层 Hook
 * 负责调试窗口打开/关闭逻辑
 */

export interface DebugButtonLogic {
  toggleDebugWindow: (isOpen: boolean, setIsOpen: (value: boolean) => void) => Promise<void>;
  getButtonTitle: (isOpen: boolean) => string;
  getButtonIcon: () => string;
}

/**
 * DebugButton的逻辑层
 */
export function useDebugButtonLogic(): DebugButtonLogic {
  const toggleDebugWindow = async (isOpen: boolean, setIsOpen: (value: boolean) => void) => {
    try {
      if (isOpen) {
        // 关闭窗口
        const { closeEditorWindow } = await import('../../../utils/editorWindows');
        await closeEditorWindow('debug');
        setIsOpen(false);
      } else {
        // 打开窗口
        const { openEditorWindow, calculateWindowPosition } = await import(
          '../../../utils/editorWindows'
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

  const getButtonTitle = (isOpen: boolean): string => {
    return isOpen ? '关闭调试面板' : '打开调试面板';
  };

  const getButtonIcon = (): string => {
    return '🛠️';
  };

  return {
    toggleDebugWindow,
    getButtonTitle,
    getButtonIcon,
  };
}
