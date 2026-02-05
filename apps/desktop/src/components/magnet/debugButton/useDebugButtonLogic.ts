/**
 * DebugButton 逻辑层 Hook
 * 历史为调试按钮（id: btn-debug），现用于 Settings 页面切换
 */

import { useNavigation } from '../../../contexts/NavigationContext';
import { useT } from '../../../i18n';

export interface DebugButtonLogic {
  toggleDebugWindow: (isOpen: boolean, setIsOpen: (value: boolean) => void) => Promise<void>;
  getButtonTitle: (isOpen: boolean) => string;
  getButtonIcon: () => string;
}

export function useDebugButtonLogic(): DebugButtonLogic {
  const navigation = useNavigation();
  const t = useT();

  const toggleDebugWindow = async (isOpen: boolean, setIsOpen: (value: boolean) => void) => {
    try {
      if (isOpen) {
        navigation.goBack();
        setIsOpen(false);
        return;
      }

      navigation.navigateTo('settings');
      setIsOpen(true);
    } catch (error) {
      console.error('Failed to toggle settings:', error);
      setIsOpen(false);
    }
  };

  const getButtonTitle = (isOpen: boolean): string => {
    return isOpen ? t('magnet.settingsButton.title.back') : t('magnet.settingsButton.title.open');
  };

  const getButtonIcon = (): string => {
    return 'SET';
  };

  return {
    toggleDebugWindow,
    getButtonTitle,
    getButtonIcon,
  };
}

