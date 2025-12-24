import { getInstalledPmpmPlugin, readPmpmPluginEntryCode } from './pmpm';

export type PmpmPluginRuntime = {
  mount: (container: HTMLElement, api: unknown) => void | (() => void);
  unmount?: (container: HTMLElement) => void;
  mountSettings?: (container: HTMLElement, api: unknown, panelId?: string) => void | (() => void);
  unmountSettings?: (container: HTMLElement, panelId?: string) => void;
  mountPage?: (container: HTMLElement, api: unknown, pageId: string) => void | (() => void);
  unmountPage?: (container: HTMLElement, pageId: string) => void;
  mountVisualizer?: (container: HTMLElement, api: unknown, visualizerId: string) => void | (() => void);
  unmountVisualizer?: (container: HTMLElement, visualizerId: string) => void;
  mountWindow?: (container: HTMLElement, api: unknown, windowId: string) => void | (() => void);
  unmountWindow?: (container: HTMLElement, windowId: string) => void;
  runCommand?: (api: unknown, commandId: string, args?: unknown) => void | Promise<void>;
};

type CachedRuntime = {
  entrySha256?: string;
  promise: Promise<PmpmPluginRuntime>;
};

const runtimeCache = new Map<string, CachedRuntime>();

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256HexFromString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

export async function readVerifiedPmpmPluginEntryCode(pluginId: string): Promise<string> {
  const installed = getInstalledPmpmPlugin(pluginId);
  if (!installed) {
    throw new Error(`Plugin not installed: ${pluginId}`);
  }

  const entryCode = (await readPmpmPluginEntryCode(pluginId)) ?? installed.entryCode ?? null;
  if (!entryCode) {
    throw new Error(`Plugin entryCode missing: ${pluginId}`);
  }

  if (installed.entrySha256) {
    const computed = await sha256HexFromString(entryCode);
    if (computed !== installed.entrySha256) {
      throw new Error(
        `Plugin integrity check failed (entrySha256 mismatch). Please reinstall: ${pluginId}`
      );
    }
  }

  return entryCode;
}

async function loadPluginRuntime(pluginId: string): Promise<PmpmPluginRuntime> {
  const entryCode = await readVerifiedPmpmPluginEntryCode(pluginId);

  const blob = new Blob([entryCode], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);

  try {
    const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;

    const defaultExport = mod.default as Record<string, unknown> | undefined;

    const mount =
      (mod.mount as PmpmPluginRuntime['mount'] | undefined) ??
      (defaultExport?.mount as PmpmPluginRuntime['mount'] | undefined);
    const unmount =
      (mod.unmount as PmpmPluginRuntime['unmount'] | undefined) ??
      (defaultExport?.unmount as PmpmPluginRuntime['unmount'] | undefined);
    const mountSettings =
      (mod.mountSettings as PmpmPluginRuntime['mountSettings'] | undefined) ??
      (defaultExport?.mountSettings as PmpmPluginRuntime['mountSettings'] | undefined);
    const unmountSettings =
      (mod.unmountSettings as PmpmPluginRuntime['unmountSettings'] | undefined) ??
      (defaultExport?.unmountSettings as PmpmPluginRuntime['unmountSettings'] | undefined);
    const mountPage =
      (mod.mountPage as PmpmPluginRuntime['mountPage'] | undefined) ??
      (defaultExport?.mountPage as PmpmPluginRuntime['mountPage'] | undefined);
    const unmountPage =
      (mod.unmountPage as PmpmPluginRuntime['unmountPage'] | undefined) ??
      (defaultExport?.unmountPage as PmpmPluginRuntime['unmountPage'] | undefined);
    const mountWindow =
      (mod.mountWindow as PmpmPluginRuntime['mountWindow'] | undefined) ??
      (defaultExport?.mountWindow as PmpmPluginRuntime['mountWindow'] | undefined);
    const unmountWindow =
      (mod.unmountWindow as PmpmPluginRuntime['unmountWindow'] | undefined) ??
      (defaultExport?.unmountWindow as PmpmPluginRuntime['unmountWindow'] | undefined);
    const mountVisualizer =
      (mod.mountVisualizer as PmpmPluginRuntime['mountVisualizer'] | undefined) ??
      (defaultExport?.mountVisualizer as PmpmPluginRuntime['mountVisualizer'] | undefined);
    const unmountVisualizer =
      (mod.unmountVisualizer as PmpmPluginRuntime['unmountVisualizer'] | undefined) ??
      (defaultExport?.unmountVisualizer as PmpmPluginRuntime['unmountVisualizer'] | undefined);
    const runCommand =
      (mod.runCommand as PmpmPluginRuntime['runCommand'] | undefined) ??
      (defaultExport?.runCommand as PmpmPluginRuntime['runCommand'] | undefined);

    if (typeof mount !== 'function') {
      throw new Error('Plugin entry must export `mount(container, api)`');
    }

    return {
      mount,
      unmount,
      mountSettings,
      unmountSettings,
      mountPage,
      unmountPage,
      mountVisualizer,
      unmountVisualizer,
      mountWindow,
      unmountWindow,
      runCommand,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ensurePmpmPluginRuntime(pluginId: string): Promise<PmpmPluginRuntime> {
  const installed = getInstalledPmpmPlugin(pluginId);
  const entrySha256 = installed?.entrySha256;

  const existing = runtimeCache.get(pluginId);
  if (existing && existing.entrySha256 === entrySha256) {
    return existing.promise;
  }

  const promise = loadPluginRuntime(pluginId).catch((err) => {
    const cached = runtimeCache.get(pluginId);
    if (cached?.promise === promise) {
      runtimeCache.delete(pluginId);
    }
    throw err;
  });

  runtimeCache.set(pluginId, { entrySha256, promise });
  return promise;
}

export function clearPmpmPluginRuntimeCache(pluginId?: string): void {
  if (pluginId) {
    runtimeCache.delete(pluginId);
    return;
  }
  runtimeCache.clear();
}
