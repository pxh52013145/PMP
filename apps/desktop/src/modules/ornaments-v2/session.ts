import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { broadcastSignal, TAURI_EVENTS } from '../../utils/windowCommunication';
import { acquireWindowPinOverride, applyWindowPinPolicy, releaseWindowPinOverride } from '../../utils/windowPinRuntime';

const ORNAMENTS_EDIT_PIN_OVERRIDE_SOURCE = 'ornaments-edit';

export async function startOrnamentsEditSession(): Promise<void> {
  await acquireWindowPinOverride(ORNAMENTS_EDIT_PIN_OVERRIDE_SOURCE, {
    mainWindowPinned: false,
    editorWindowsPinned: true,
  });

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
