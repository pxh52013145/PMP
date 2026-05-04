import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { broadcastSignal, TAURI_EVENTS } from '../../utils/windowCommunication';
import { acquireWindowPinOverride, applyWindowPinPolicy, releaseWindowPinOverride } from '../../utils/windowPinRuntime';

const ORNAMENTS_EDIT_PIN_OVERRIDE_SOURCE = 'ornaments-edit';
const ORNAMENTS_DIALOG_PIN_OVERRIDE_SOURCE = 'ornaments-dialog';

const ORNAMENTS_EDIT_PIN_OVERRIDE = {
  mainWindowPinned: false,
  editorWindowsPinned: true,
} as const;

const ORNAMENTS_DIALOG_PIN_OVERRIDE = {
  mainWindowPinned: false,
  editorWindowsPinned: false,
} as const;

export async function startOrnamentsEditSession(): Promise<void> {
  await acquireWindowPinOverride(ORNAMENTS_EDIT_PIN_OVERRIDE_SOURCE, ORNAMENTS_EDIT_PIN_OVERRIDE);

  if (isTauriRuntime()) {
    await invokeWithTelemetry('ornaments_editor_overlay_open', undefined, {
      moduleId: 'ornaments',
      component: 'session',
      event: 'ornaments.editor-overlay.open',
      successLevel: 'info',
    });
    await applyWindowPinPolicy();
  }

  await broadcastSignal(TAURI_EVENTS.ORNAMENTS_EDIT_SESSION_STARTED);
}

export async function acquireOrnamentsDialogPinOverride(): Promise<void> {
  if (!isTauriRuntime()) return;
  await acquireWindowPinOverride(ORNAMENTS_DIALOG_PIN_OVERRIDE_SOURCE, ORNAMENTS_DIALOG_PIN_OVERRIDE);
}

export async function releaseOrnamentsDialogPinOverride(): Promise<void> {
  if (!isTauriRuntime()) return;
  await releaseWindowPinOverride(ORNAMENTS_DIALOG_PIN_OVERRIDE_SOURCE);
}

export async function endOrnamentsEditSession(): Promise<void> {
  if (isTauriRuntime()) {
    await invokeWithTelemetry('ornaments_editor_overlay_close', undefined, {
      moduleId: 'ornaments',
      component: 'session',
      event: 'ornaments.editor-overlay.close',
      successLevel: 'info',
    });
  }

  await broadcastSignal(TAURI_EVENTS.ORNAMENTS_EDIT_SESSION_ENDED);
  await releaseWindowPinOverride(ORNAMENTS_EDIT_PIN_OVERRIDE_SOURCE);
}
