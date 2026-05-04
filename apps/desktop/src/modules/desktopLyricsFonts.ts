import { useEffect, useMemo, useRef, useState } from 'react';

import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../utils/tauriRuntime';
import { STORAGE_KEYS } from '../utils/windowCommunication';
import { usePersistentSetting } from './storage';

const telemetry = getTelemetryLogger('windowing', 'desktopLyricsFonts');

export const DESKTOP_LYRICS_DEFAULT_FONT_STACK =
  "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";

const DESKTOP_LYRICS_FONT_FAMILY_PREFIX = 'PMPDesktopLyrics_';

export interface DesktopLyricsFontConfig {
  id: string;
  family: string;
  label: string;
  displayName: string;
  fileName: string;
  path: string;
  importedAt: number;
  sourceBytes?: number;
}

export type DesktopLyricsFontStatus = 'idle' | 'loading' | 'loaded' | 'error';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function formatDesktopLyricsFontStack(fontFamily: string | null | undefined): string {
  const normalized = typeof fontFamily === 'string' ? fontFamily.trim() : '';
  if (!normalized) return DESKTOP_LYRICS_DEFAULT_FONT_STACK;
  return `${JSON.stringify(normalized)}, ${DESKTOP_LYRICS_DEFAULT_FONT_STACK}`;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function deriveFileNameLabel(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return 'Desktop lyrics font';
  const withoutPath = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const withoutExt = withoutPath.replace(/\.[^./\\]+$/, '').trim();
  return withoutExt.length > 0 ? withoutExt : withoutPath;
}

function deriveFontId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildFontFamily(id: string): string {
  const normalized = id.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return `${DESKTOP_LYRICS_FONT_FAMILY_PREFIX}${normalized}`;
}

export function createDesktopLyricsFontConfig(options: {
  path: string;
  fileName: string;
  displayName?: string;
  sourceBytes?: number;
}): DesktopLyricsFontConfig {
  const id = deriveFontId();
  const fileName = options.fileName.trim();
  const label = deriveFileNameLabel(fileName);
  const displayName = normalizeNonEmptyString(options.displayName) ?? label;
  return {
    id,
    family: buildFontFamily(id),
    label,
    displayName,
    fileName,
    path: options.path,
    importedAt: Date.now(),
    ...(typeof options.sourceBytes === 'number' && Number.isFinite(options.sourceBytes)
      ? { sourceBytes: Math.max(0, Math.round(options.sourceBytes)) }
      : {}),
  };
}

export function normalizeDesktopLyricsFontConfig(value: unknown): DesktopLyricsFontConfig | null {
  if (!isPlainObject(value)) return null;

  const id = normalizeNonEmptyString(value.id);
  const family = normalizeNonEmptyString(value.family) ?? (id ? buildFontFamily(id) : undefined);
  const label = normalizeNonEmptyString(value.label);
  const displayName = normalizeNonEmptyString(value.displayName) ?? label;
  const fileName = normalizeNonEmptyString(value.fileName);
  const path = normalizeNonEmptyString(value.path);
  const importedAt = readPositiveFiniteNumber(value.importedAt) ?? Date.now();
  const sourceBytes = readPositiveFiniteNumber(value.sourceBytes);

  if (!id || !family || !label || !displayName || !fileName || !path) return null;

  return {
    id,
    family,
    label,
    displayName,
    fileName,
    path,
    importedAt,
    ...(typeof sourceBytes === 'number' ? { sourceBytes: Math.round(sourceBytes) } : {}),
  };
}

export async function removeDesktopLyricsFontFile(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  const resolvedPath = typeof path === 'string' ? path.trim() : '';
  if (!resolvedPath) return;

  try {
    const fs = await import('@tauri-apps/api/fs');
    await fs.removeFile(resolvedPath);
  } catch (error) {
    telemetry.warn('desktop-lyrics.font.remove.failed', {
      message: getErrorMessage(error),
      fields: { path: resolvedPath },
    });
  }
}

export interface DesktopLyricsFontRuntimeState {
  fontConfig: DesktopLyricsFontConfig | null;
  setFontConfig: (next: DesktopLyricsFontConfig | null) => void;
  fontFamily: string;
  fontStatus: DesktopLyricsFontStatus;
  fontError: string | null;
}

export function useDesktopLyricsFontConfig(): DesktopLyricsFontRuntimeState {
  const [fontConfigRaw, setFontConfig] = usePersistentSetting<DesktopLyricsFontConfig | null>(
    STORAGE_KEYS.DESKTOP_LYRICS_FONT_CONFIG,
    null,
    {
      format: 'json',
      listenStorageEvents: true,
    }
  );
  const [fontStatus, setFontStatus] = useState<DesktopLyricsFontStatus>('idle');
  const [fontError, setFontError] = useState<string | null>(null);
  const activeFontFaceRef = useRef<FontFace | null>(null);
  const fontConfig = useMemo(() => normalizeDesktopLyricsFontConfig(fontConfigRaw), [fontConfigRaw]);

  const fontFamily = useMemo(() => {
    return formatDesktopLyricsFontStack(fontConfig?.family);
  }, [fontConfig?.family]);

  useEffect(() => {
    let disposed = false;
    const cleanupActiveFontFace = () => {
      const activeFontFace = activeFontFaceRef.current;
      activeFontFaceRef.current = null;

      if (activeFontFace && typeof document !== 'undefined' && 'fonts' in document) {
        try {
          document.fonts.delete(activeFontFace);
        } catch {
          // best-effort cleanup
        }
      }
    };

    cleanupActiveFontFace();

    if (!fontConfig) {
      setFontStatus('idle');
      setFontError(null);
      return () => {
        disposed = true;
        cleanupActiveFontFace();
      };
    }

    if (!isTauriRuntime() || typeof FontFace === 'undefined' || typeof document === 'undefined' || !('fonts' in document)) {
      setFontStatus('idle');
      setFontError(null);
      return () => {
        disposed = true;
        cleanupActiveFontFace();
      };
    }

    setFontStatus('loading');
    setFontError(null);

    void (async () => {
      try {
        const fs = await import('@tauri-apps/api/fs');
        const bytes = await fs.readBinaryFile(fontConfig.path);
        if (disposed) return;
        if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
          throw new Error('Font file is empty');
        }

        const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const fontFace = new FontFace(fontConfig.family, source);
        await fontFace.load();
        if (disposed) return;

        document.fonts.add(fontFace);
        activeFontFaceRef.current = fontFace;
        setFontStatus('loaded');
      } catch (error) {
        if (disposed) return;
        const message = getErrorMessage(error);
        setFontStatus('error');
        setFontError(message);
        telemetry.warn('desktop-lyrics.font.load.failed', {
          message,
          fields: {
            path: fontConfig.path,
            family: fontConfig.family,
          },
        });
      }
    })();

    return () => {
      disposed = true;
      cleanupActiveFontFace();
    };
  }, [fontConfig]);

  return {
    fontConfig,
    setFontConfig,
    fontFamily,
    fontStatus,
    fontError,
  };
}
