import type { HostAudioService, HostNavigation, PluginMountApi } from './pluginHostApi';
import { createPluginMountApi } from './pluginHostApi';
import { readPmpmPluginConfig, subscribePmpmPluginConfig } from './pluginConfig';
import { getPmpmPluginEffectivePermissions, recordPmpmPermissionDenied, recordPmpmPluginCrash } from './pmpm';
import { recordPmpmAuditEvent } from './pmpmGovernance';
import { readVerifiedPmpmPluginEntryCode } from './pmpmRuntime';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';

type RpcRequest = {
  frameId: string;
  type: 'pmpm:rpc';
  id: string;
  method: string;
  args: unknown[];
};

type PermissionDeniedMessage = {
  frameId: string;
  type: 'pmpm:permission-denied';
  pluginId: string;
  hostLabel: string;
  capability: string;
  action: string;
};

type CommandFinishedMessage = {
  frameId: string;
  type: 'pmpm:command-finished';
  ok: boolean;
};

type FrameMessage =
  | { frameId: string; type: 'pmpm:iframe-ready' }
  | { frameId: string; type: 'pmpm:pong'; pingId: number }
  | { frameId: string; type: 'pmpm:error'; message: string }
  | RpcRequest
  | PermissionDeniedMessage
  | CommandFinishedMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export async function runPmpmSandboxedCommand(options: {
  pluginId: string;
  commandId: string;
  args?: unknown;
  hostLabel?: string;
  audioService: HostAudioService;
  navigation: HostNavigation;
  timeoutMs?: number;
}): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Sandboxed command requires a browser runtime');
  }

  const hostLabel = options.hostLabel ?? 'PluginCommandSandbox';
  const permissions = getPmpmPluginEffectivePermissions(options.pluginId);
  const api: PluginMountApi = createPluginMountApi({
    pluginId: options.pluginId,
    hostLabel,
    permissions,
    audioService: options.audioService,
    navigation: options.navigation,
  });

  const entryCode = await readVerifiedPmpmPluginEntryCode(options.pluginId);
  const initialConfig = readPmpmPluginConfig(options.pluginId);

  const frameId = `${options.pluginId}-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const iframe = document.createElement('iframe');
  iframe.title = `pmpm:${options.pluginId}:command`;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = '0';
  iframe.srcdoc = buildPmpmSandboxSrcDoc(frameId);
  document.body.appendChild(iframe);

  const postToFrame = (message: Record<string, unknown>) => {
    const win = iframe.contentWindow;
    if (!win) return;
    try {
      win.postMessage({ frameId, ...message }, '*');
    } catch {
      // ignore
    }
  };

  const timeoutMs = Number(options.timeoutMs ?? 20_000);
  const pingTimeoutMs = 8_000;

  return await new Promise<void>((resolve, reject) => {
    let settled = false;
    let startedAt = Date.now();
    let lastPongAt = Date.now();
    let pingSeq = 0;

    let unlistenConfig: null | (() => void) = null;
    let pingTimer: number | null = null;
    let totalTimer: number | null = null;
    let bootTimer: number | null = null;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (totalTimer !== null) window.clearTimeout(totalTimer);
      if (bootTimer !== null) window.clearTimeout(bootTimer);
      pingTimer = null;
      totalTimer = null;
      bootTimer = null;
      try {
        unlistenConfig?.();
      } catch {
        // ignore
      }
      unlistenConfig = null;
      try {
        iframe.remove();
      } catch {
        // ignore
      }
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const finishError = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const crashAsUnresponsive = (message: string, timeoutMsForAudit: number) => {
      try {
        recordPmpmAuditEvent({
          type: 'runtime-unresponsive',
          pluginId: options.pluginId,
          surface: 'command',
          timeoutMs: timeoutMsForAudit,
        });
      } catch {
        // ignore
      }
      recordPmpmPluginCrash(options.pluginId, message, 'command');
      finishError(new Error(message));
    };

    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (event.source !== iframe.contentWindow) return;
      if (!isRecord(event.data)) return;
      if (event.data.frameId !== frameId) return;

      const data = event.data as FrameMessage;

      if (data.type === 'pmpm:iframe-ready') {
        if (bootTimer !== null) window.clearTimeout(bootTimer);
        bootTimer = null;

        startedAt = Date.now();
        lastPongAt = Date.now();

        if (permissions.has('storage:local')) {
          unlistenConfig = subscribePmpmPluginConfig(options.pluginId, (config) => {
            postToFrame({ type: 'pmpm:event', name: 'config.changed', payload: config });
          });
        }

        pingTimer = window.setInterval(() => {
          if (settled) return;
          pingSeq += 1;
          postToFrame({ type: 'pmpm:ping', pingId: pingSeq });

          const elapsedSincePong = Date.now() - lastPongAt;
          if (elapsedSincePong < pingTimeoutMs) return;
          crashAsUnresponsive(
            `Plugin runtime unresponsive (${elapsedSincePong}ms)`,
            pingTimeoutMs
          );
        }, 1500);

        totalTimer = window.setTimeout(() => {
          const elapsed = Date.now() - startedAt;
          crashAsUnresponsive(`Plugin command timeout (${elapsed}ms)`, timeoutMs);
        }, timeoutMs);

        postToFrame({
          type: 'pmpm:init',
          pluginId: options.pluginId,
          hostLabel,
          surface: 'command',
          surfaceId: options.commandId,
          commandArgs: options.args,
          permissions: Array.from(permissions),
          entryCode,
          initialAudioState: permissions.has('api:audio-state') ? options.audioService.getState() : null,
          initialConfig,
        });
        return;
      }

      if (data.type === 'pmpm:pong') {
        lastPongAt = Date.now();
        return;
      }

      if (data.type === 'pmpm:permission-denied') {
        recordPmpmPermissionDenied({
          pluginId: options.pluginId,
          hostLabel,
          capability: data.capability,
          action: data.action,
        });
        return;
      }

      if (data.type === 'pmpm:error') {
        recordPmpmPluginCrash(options.pluginId, data.message, 'command');
        finishError(new Error(data.message));
        return;
      }

      if (data.type === 'pmpm:command-finished') {
        finishOk();
        return;
      }

      if (data.type === 'pmpm:rpc') {
        void (async () => {
          const request = data as RpcRequest;
          const respond = (payload: { ok: boolean; result?: unknown; error?: string }) => {
            postToFrame({ type: 'pmpm:rpc-result', id: request.id, ...payload });
          };

          try {
            const args = Array.isArray(request.args) ? request.args : [];
            let result: unknown;
            switch (request.method) {
              case 'audio.play':
                result = await api.audio.play();
                break;
              case 'audio.pause':
                result = await api.audio.pause();
                break;
              case 'audio.stop':
                result = api.audio.stop();
                break;
              case 'audio.seek':
                result = api.audio.seek(args[0] as number);
                break;
              case 'audio.setVolume':
                result = api.audio.setVolume(args[0] as number);
                break;
              case 'audio.toggleMute':
                result = api.audio.toggleMute();
                break;
              case 'navigation.navigateTo':
                result = api.navigation.navigateTo(args[0] as never, args[1] as never);
                break;
              case 'navigation.goBack':
                result = api.navigation.goBack();
                break;
              case 'config.set':
                result = api.config.set(args[0] as never);
                break;
              case 'config.patch':
                result = api.config.patch(args[0] as never);
                break;
              case 'config.reset':
                result = api.config.reset();
                break;
              case 'window.open':
                result = await api.window.open(args[0] as never, args[1] as never);
                break;
              case 'window.close':
                result = await api.window.close(args[0] as never);
                break;
              default:
                throw new Error(`Unsupported RPC method: ${request.method}`);
            }
            respond({ ok: true, result });
          } catch (rpcError) {
            respond({
              ok: false,
              error: rpcError instanceof Error ? rpcError.message : String(rpcError),
            });
          }
        })();
      }
    };

    window.addEventListener('message', onMessage);

    bootTimer = window.setTimeout(() => {
      if (settled) return;
      recordPmpmPluginCrash(options.pluginId, 'Plugin sandbox boot timeout', 'command');
      finishError(new Error('Plugin sandbox boot timeout'));
    }, 3000);
  });
}
