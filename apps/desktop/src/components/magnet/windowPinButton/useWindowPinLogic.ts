import { useT } from '../../../i18n';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { updateWindowPinPreference } from '../../../utils/windowPinRuntime';
import { WindowPinLogic } from './WindowPinTypes';

const telemetry = getTelemetryLogger('windowing', 'useWindowPinLogic');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
      await updateWindowPinPreference(nextPinned);
    } catch (error) {
      setIsPinned(isPinned);
      telemetry.error('window_pin.toggle.failed', {
        message: readErrorMessage(error),
        fields: {
          nextPinned,
        },
      });
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
