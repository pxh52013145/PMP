import { useNavigation } from '../../../contexts/NavigationContext';
import { useT } from '../../../i18n';

export interface DebugButtonLogic {
  toggleDebugWindow: (isOpen: boolean, setIsOpen: (value: boolean) => void) => Promise<void>;
  getButtonTitle: (isOpen: boolean) => string;
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

  return {
    toggleDebugWindow,
    getButtonTitle,
  };
}
