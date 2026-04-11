import type { InstalledExtensionRuntimeManager } from './installedExtensionRuntimeManager';

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeInstalledExtensionHostFilePath(filePath: string): string | null {
  const normalized = normalizeNonEmptyString(filePath);
  if (!normalized) {
    return null;
  }

  return normalized.replace(/\\/g, '/');
}

export function listInstalledExtensionHostFileTypes(filePath: string): string[] {
  const normalizedPath = normalizeInstalledExtensionHostFilePath(filePath);
  if (!normalizedPath) {
    return [];
  }

  const fileName = normalizedPath.split('/').pop()?.trim().toLowerCase() ?? '';
  if (!fileName) {
    return [];
  }

  const fileTypes = new Set<string>([fileName]);
  const extensionMatch = /\.([a-z0-9]+)$/i.exec(fileName);
  if (extensionMatch?.[1]) {
    fileTypes.add(extensionMatch[1].toLowerCase());
  }

  return [...fileTypes];
}

export async function activateInstalledExtensionsForHostFile(
  runtimeManager: Pick<InstalledExtensionRuntimeManager, 'activateForFile'>,
  options: {
    filePath: string;
    action?: string;
    hostLabel?: string;
  }
): Promise<void> {
  const normalizedPath = normalizeInstalledExtensionHostFilePath(options.filePath);
  if (!normalizedPath) {
    return;
  }

  const action = normalizeNonEmptyString(options.action) ?? undefined;
  const hostLabel = normalizeNonEmptyString(options.hostLabel) ?? undefined;

  for (const fileType of listInstalledExtensionHostFileTypes(normalizedPath)) {
    await runtimeManager.activateForFile({
      fileType,
      filePath: normalizedPath,
      action,
      hostLabel,
    });
  }
}

export async function activateInstalledExtensionsForHostFiles(
  runtimeManager: Pick<InstalledExtensionRuntimeManager, 'activateForFile'>,
  options: {
    filePaths: readonly string[];
    action?: string;
    hostLabel?: string;
  }
): Promise<void> {
  const seenPaths = new Set<string>();

  for (const filePath of options.filePaths) {
    const normalizedPath = normalizeInstalledExtensionHostFilePath(filePath);
    if (!normalizedPath || seenPaths.has(normalizedPath)) {
      continue;
    }

    seenPaths.add(normalizedPath);
    await activateInstalledExtensionsForHostFile(runtimeManager, {
      filePath: normalizedPath,
      action: options.action,
      hostLabel: options.hostLabel,
    });
  }
}
