import { getAll } from '@tauri-apps/api/window';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { isTauriRuntime } from './tauriRuntime';
import {
  persistWindowPinState,
  readWindowPinRuntimeOverrides,
  resolveWindowPinPolicy,
  type WindowPinPolicy,
  type WindowPinOverride,
} from './windowPinState';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from './windowCommunication';

const telemetry = getTelemetryLogger('windowing', 'windowPinRuntime');
const pinOverrides = new Map<string, WindowPinOverride>();
let applyRevision = 0;

function syncRuntimeOverridesFromStorage(): void {
  pinOverrides.clear();
  const stored = readWindowPinRuntimeOverrides();
  for (const [source, override] of Object.entries(stored)) {
    pinOverrides.set(source, override);
  }
}

async function persistRuntimeOverrides(): Promise<void> {
  await broadcastDataUpdate(
    STORAGE_KEYS.WINDOW_PIN_RUNTIME_OVERRIDES,
    Object.fromEntries(pinOverrides.entries()),
    TAURI_EVENTS.WINDOW_PIN_STATE_UPDATED
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PinTargetGroup = 'main' | 'editor';

function isEditorPinWindow(label: string): boolean {
  return label.startsWith('editor-');
}

async function setAlwaysOnTopSafe(
  window: { label: string; setAlwaysOnTop: (value: boolean) => Promise<void> },
  value: boolean,
  targetGroup: PinTargetGroup
): Promise<void> {
  try {
    await window.setAlwaysOnTop(value);
  } catch (error) {
    telemetry.warn('window.pin-policy.apply.failed', {
      message: getErrorMessage(error),
      fields: {
        targetWindow: window.label,
        targetGroup,
        value,
      },
    });
  }
}

export function getEffectiveWindowPinPolicy(): WindowPinPolicy {
  syncRuntimeOverridesFromStorage();
  return resolveWindowPinPolicy(undefined, Array.from(pinOverrides.values()));
}

export async function applyWindowPinPolicy(policy = getEffectiveWindowPinPolicy()): Promise<void> {
  if (!isTauriRuntime()) return;

  const revision = ++applyRevision;

  const allWindows = getAll();
  const mainWindow = allWindows.find((window) => window.label === 'main');
  const editorWindows = allWindows.filter((window) => isEditorPinWindow(window.label));

  if (mainWindow) {
    if (revision !== applyRevision) return;
    await setAlwaysOnTopSafe(mainWindow, policy.mainWindowPinned, 'main');
  }
  for (const window of editorWindows) {
    if (revision !== applyRevision) return;
    await setAlwaysOnTopSafe(window, policy.editorWindowsPinned, 'editor');
  }
}

export async function acquireWindowPinOverride(
  source: string,
  override: WindowPinOverride
): Promise<WindowPinPolicy> {
  syncRuntimeOverridesFromStorage();
  pinOverrides.set(source, override);
  await persistRuntimeOverrides();
  const policy = getEffectiveWindowPinPolicy();
  await applyWindowPinPolicy(policy);
  return policy;
}

export async function releaseWindowPinOverride(source: string): Promise<WindowPinPolicy> {
  syncRuntimeOverridesFromStorage();
  pinOverrides.delete(source);
  await persistRuntimeOverrides();
  const policy = getEffectiveWindowPinPolicy();
  await applyWindowPinPolicy(policy);
  return policy;
}

export async function updateWindowPinPreference(value: boolean): Promise<WindowPinPolicy> {
  syncRuntimeOverridesFromStorage();
  await persistWindowPinState(value);
  const policy = resolveWindowPinPolicy(value, Array.from(pinOverrides.values()));
  await applyWindowPinPolicy(policy);
  return policy;
}
