import { appWindow } from '@tauri-apps/api/window';
import { useT } from '../../../i18n';
import { WindowPinLogic } from './WindowPinTypes';

export function useWindowPinLogic(
  isPinned: boolean,
  setIsPinned: React.Dispatch<React.SetStateAction<boolean>>
): WindowPinLogic {
  const t = useT();

  const togglePin = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextPinned = !isPinned;
    setIsPinned(nextPinned);

    try {
      await appWindow.setAlwaysOnTop(nextPinned);
    } catch (error) {
      setIsPinned(isPinned);
      console.error('Failed to toggle window pin state:', error);
    }
  };

  const getButtonTitle = (pinned: boolean): string => {
    return pinned
      ? t('editor.control-panel.pin.title.unpin')
      : t('editor.control-panel.pin.title.pin');
  };

  return {
    togglePin,
    getButtonTitle,
  };
}
