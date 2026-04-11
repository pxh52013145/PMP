import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export type NativeHostFileOpenPayload = {
  paths: string[];
  source: string;
  action?: string | null;
  receivedAtMs: number;
};

export async function consumePendingHostFileOpens(): Promise<NativeHostFileOpenPayload[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  return await invokeWithTelemetry<NativeHostFileOpenPayload[]>(
    'app_consume_pending_host_file_opens',
    undefined,
    {
      moduleId: 'startup',
      component: 'HostFileOpen',
      event: 'tauri.invoke.host-file-open.consume',
      includeResultSize: true,
    }
  );
}
