import { readString, writeString } from '../modules/storage';
import { STORAGE_KEYS } from './windowCommunication';

export function readWindowPinState(): boolean | undefined {
  const stored = readString(STORAGE_KEYS.WINDOW_PIN_STATE);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return undefined;
}

export function writeWindowPinState(value: boolean): void {
  writeString(STORAGE_KEYS.WINDOW_PIN_STATE, value ? 'true' : 'false');
}
