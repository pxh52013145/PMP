import { useNavigation } from '../../../contexts/NavigationContext';
import { useT } from '../../../i18n';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';

export interface DebugButtonLogic {
  toggleDebugWindow: (isOpen: boolean, setIsOpen: (value: boolean) => void) => Promise<void>;
  getButtonTitle: (isOpen: boolean) => string;
}

const telemetry = getTelemetryLogger('navigation', 'useDebugButtonLogic');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      telemetry.error('debug_button.toggle_settings.failed', {
        message: readErrorMessage(error),
        fields: {
          wasOpen: isOpen,
        },
      });
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
