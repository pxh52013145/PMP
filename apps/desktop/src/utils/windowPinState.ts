import { readJson, readString, writeString } from '../modules/storage';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from './windowCommunication';

export interface WindowPinPolicy {
  preferredPinned: boolean;
  mainWindowPinned: boolean;
  editorWindowsPinned: boolean;
}

export type WindowPinOverride = Partial<Pick<WindowPinPolicy, 'mainWindowPinned' | 'editorWindowsPinned'>>;
export type WindowPinRuntimeOverrides = Record<string, WindowPinOverride>;

function isWindowPinOverride(value: unknown): value is WindowPinOverride {
  if (!value || typeof value !== 'object') return false;
  const override = value as WindowPinOverride;
  return (
    typeof override.mainWindowPinned === 'boolean' ||
    typeof override.editorWindowsPinned === 'boolean'
  );
}

export function readWindowPinState(): boolean | undefined {
  const stored = readString(STORAGE_KEYS.WINDOW_PIN_STATE);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return undefined;
}

export function writeWindowPinState(value: boolean): void {
  writeString(STORAGE_KEYS.WINDOW_PIN_STATE, value ? 'true' : 'false');
}

export async function persistWindowPinState(value: boolean): Promise<void> {
  await broadcastDataUpdate(STORAGE_KEYS.WINDOW_PIN_STATE, value, TAURI_EVENTS.WINDOW_PIN_STATE_UPDATED);
}

export function readWindowPinRuntimeOverrides(): WindowPinRuntimeOverrides {
  const raw = readJson<unknown>(STORAGE_KEYS.WINDOW_PIN_RUNTIME_OVERRIDES, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, WindowPinOverride] =>
      isWindowPinOverride(entry[1])
    )
  );
}

export function readWindowPinPreference(): boolean {
  return readWindowPinState() ?? false;
}

export function resolveWindowPinPolicy(
  preferredPinned = readWindowPinPreference(),
  overrides: ReadonlyArray<WindowPinOverride> = []
): WindowPinPolicy {
  const normalizedPinned = Boolean(preferredPinned);
  const policy: WindowPinPolicy = {
    preferredPinned: normalizedPinned,
    mainWindowPinned: normalizedPinned,
    editorWindowsPinned: normalizedPinned,
  };

  for (const override of overrides) {
    if (typeof override.mainWindowPinned === 'boolean') {
      policy.mainWindowPinned = override.mainWindowPinned;
    }
    if (typeof override.editorWindowsPinned === 'boolean') {
      policy.editorWindowsPinned = override.editorWindowsPinned;
    }
  }

  return policy;
}
