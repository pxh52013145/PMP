import { readJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { disablePmpmPluginByPolicy, getInstalledPmpmPlugin, readPmpmPluginEntryCode } from './pmpm';
import { isPmpmSigningKeyTrusted } from './pmpmTrust';

export type PmpmPluginRuntime = {
  mount: (container: HTMLElement, api: unknown, context?: unknown) => void | (() => void);
  unmount?: (container: HTMLElement) => void;
  mountSettings?: (container: HTMLElement, api: unknown, panelId?: string) => void | (() => void);
  unmountSettings?: (container: HTMLElement, panelId?: string) => void;
  mountPage?: (container: HTMLElement, api: unknown, pageId: string) => void | (() => void);
  unmountPage?: (container: HTMLElement, pageId: string) => void;
  mountVisualizer?: (container: HTMLElement, api: unknown, visualizerId: string) => void | (() => void);
  unmountVisualizer?: (container: HTMLElement, visualizerId: string) => void;
  mountWindow?: (container: HTMLElement, api: unknown, windowId: string) => void | (() => void);
  unmountWindow?: (container: HTMLElement, windowId: string) => void;
  mountOverlay?: (container: HTMLElement, api: unknown, surfaceId: string) => void | (() => void);
  unmountOverlay?: (container: HTMLElement, surfaceId: string) => void;
  mountDesktopWidget?: (
    container: HTMLElement,
    api: unknown,
    surfaceId: string
  ) => void | (() => void);
  unmountDesktopWidget?: (container: HTMLElement, surfaceId: string) => void;
  runCommand?: (api: unknown, commandId: string, args?: unknown) => void | Promise<void>;
};

type CachedRuntime = {
  entrySha256?: string;
  promise: Promise<PmpmPluginRuntime>;
};

const runtimeCache = new Map<string, CachedRuntime>();
const UTF8_BOM = String.fromCharCode(0xfeff);

async function sha256Hex(data: Uint8Array): Promise<string> {
  const normalized = new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', normalized);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256HexFromString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text));
}

function normalizeLineEndingsToLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function buildEntryIntegrityCandidates(entryCode: string): string[] {
  const candidateTexts = new Set<string>();
  candidateTexts.add(entryCode);

  if (entryCode.startsWith(UTF8_BOM)) {
    candidateTexts.add(entryCode.slice(1));
  } else {
    candidateTexts.add(`${UTF8_BOM}${entryCode}`);
  }

  const normalizedCandidates = new Set<string>();
  for (const text of candidateTexts) {
    normalizedCandidates.add(text);
    const withoutBom = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
    const lf = normalizeLineEndingsToLf(withoutBom);
    const crlf = lf.replace(/\n/g, '\r\n');

    normalizedCandidates.add(lf);
    normalizedCandidates.add(crlf);
    normalizedCandidates.add(`${UTF8_BOM}${lf}`);
    normalizedCandidates.add(`${UTF8_BOM}${crlf}`);
  }

  return Array.from(normalizedCandidates);
}

export async function readVerifiedPmpmPluginEntryCode(pluginId: string): Promise<string> {
  const installed = getInstalledPmpmPlugin(pluginId);
  if (!installed) {
    throw new Error(`Plugin not installed: ${pluginId}`);
  }

  const requireTrustedSignatures = Boolean(readJson(STORAGE_KEYS.PMPM_REQUIRE_TRUSTED_SIGNATURES, false));
  const allowUnsigned = Boolean(readJson(STORAGE_KEYS.PMPM_ALLOW_UNSIGNED_PLUGINS, true));

  if (requireTrustedSignatures) {
    if (!installed.signature) {
      const message = `Plugin signature is required (trusted signatures required): ${pluginId}`;
      disablePmpmPluginByPolicy(pluginId, message);
      throw new Error(message);
    }

    const keyId = installed.signature.keyId;
    if (!isPmpmSigningKeyTrusted(keyId)) {
      const message = `Plugin signature key is not trusted: ${pluginId} (keyId=${keyId})`;
      disablePmpmPluginByPolicy(pluginId, message);
      throw new Error(message);
    }
  } else if (!allowUnsigned && !installed.signature) {
    const message = `Plugin signature is required (unsigned): ${pluginId}`;
    disablePmpmPluginByPolicy(pluginId, message);
    throw new Error(message);
  }

  const entryCode = (await readPmpmPluginEntryCode(pluginId)) ?? installed.entryCode ?? null;
  if (!entryCode) {
    throw new Error(`Plugin entryCode missing: ${pluginId}`);
  }

  if (installed.entrySha256) {
    const expected = installed.entrySha256.toLowerCase();
    const candidateHashes = new Set<string>();
    const candidateTexts = buildEntryIntegrityCandidates(entryCode);
    for (const candidate of candidateTexts) {
      candidateHashes.add(await sha256HexFromString(candidate));
    }

    if (!candidateHashes.has(expected)) {
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
    const mountOverlay =
      (mod.mountOverlay as PmpmPluginRuntime['mountOverlay'] | undefined) ??
      (defaultExport?.mountOverlay as PmpmPluginRuntime['mountOverlay'] | undefined);
    const unmountOverlay =
      (mod.unmountOverlay as PmpmPluginRuntime['unmountOverlay'] | undefined) ??
      (defaultExport?.unmountOverlay as PmpmPluginRuntime['unmountOverlay'] | undefined);
    const mountDesktopWidget =
      (mod.mountDesktopWidget as PmpmPluginRuntime['mountDesktopWidget'] | undefined) ??
      (defaultExport?.mountDesktopWidget as PmpmPluginRuntime['mountDesktopWidget'] | undefined);
    const unmountDesktopWidget =
      (mod.unmountDesktopWidget as PmpmPluginRuntime['unmountDesktopWidget'] | undefined) ??
      (defaultExport?.unmountDesktopWidget as PmpmPluginRuntime['unmountDesktopWidget'] | undefined);
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
      mountOverlay,
      unmountOverlay,
      mountDesktopWidget,
      unmountDesktopWidget,
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
