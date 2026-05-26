import { useEffect, useMemo, useRef, useState } from 'react';

type DesktopLyricsOverlayLocale = 'zh-CN' | 'en-US';

type DesktopLyricsOverlayMessageKey =
  | 'pages.track.lyrics.placeholder'
  | 'commands.audio.previous-track.title'
  | 'commands.audio.next-track.title'
  | 'commands.audio.toggle-play-pause.title'
  | 'magnet.desktopLyricsButton.title.disable'
  | 'magnet.desktopLyricsButton.contextMenu.clickThrough.enable'
  | 'magnet.desktopLyricsButton.contextMenu.clickThrough.disable'
  | 'magnet.desktopLyricsButton.contextMenu.fontSize.small'
  | 'magnet.desktopLyricsButton.contextMenu.fontSize.large'
  | 'magnet.desktopLyricsButton.contextMenu.opacity.p60'
  | 'magnet.desktopLyricsButton.contextMenu.opacity.p100'
  | 'magnet.desktopLyricsButton.contextMenu.lyricOffset.slower'
  | 'magnet.desktopLyricsButton.contextMenu.lyricOffset.faster'
  | 'magnet.desktopLyricsButton.contextMenu.lyricOffset.reset';

type DesktopLyricsOverlayMessages = Record<DesktopLyricsOverlayMessageKey, string>;

interface DesktopLyricsFontConfig {
  family: string;
  path: string;
}

export const DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS = {
  LOCALE: 'pixel-matrix-locale',
  DESKTOP_LYRICS_ENABLED: 'pixel-matrix-desktop-lyrics-enabled',
  DESKTOP_LYRICS_CLICK_THROUGH: 'pixel-matrix-desktop-lyrics-click-through',
  DESKTOP_LYRICS_FONT_SIZE: 'pixel-matrix-desktop-lyrics-font-size',
  DESKTOP_LYRICS_FONT_CONFIG: 'pixel-matrix-desktop-lyrics-font-config',
  DESKTOP_LYRICS_LYRIC_OFFSET_MS: 'pixel-matrix-desktop-lyrics-lyric-offset-ms',
} as const;

const PMP_STORAGE_CHANGE_EVENT = 'pmp-storage-change';

const DEFAULT_LOCALE: DesktopLyricsOverlayLocale = 'zh-CN';

const DESKTOP_LYRICS_OVERLAY_MESSAGES: Record<
  DesktopLyricsOverlayLocale,
  DesktopLyricsOverlayMessages
> = {
  'zh-CN': {
    'pages.track.lyrics.placeholder': '暂无歌词',
    'commands.audio.previous-track.title': '音频：上一首',
    'commands.audio.next-track.title': '音频：下一首',
    'commands.audio.toggle-play-pause.title': '音频：播放/暂停',
    'magnet.desktopLyricsButton.title.disable': '关闭桌面歌词',
    'magnet.desktopLyricsButton.contextMenu.clickThrough.enable': '启用点击穿透',
    'magnet.desktopLyricsButton.contextMenu.clickThrough.disable': '关闭点击穿透',
    'magnet.desktopLyricsButton.contextMenu.fontSize.small': '字体大小：小',
    'magnet.desktopLyricsButton.contextMenu.fontSize.large': '字体大小：大',
    'magnet.desktopLyricsButton.contextMenu.opacity.p60': '透明度：60%',
    'magnet.desktopLyricsButton.contextMenu.opacity.p100': '透明度：100%',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.slower': '歌词慢进 100 毫秒',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.faster': '歌词快进 100 毫秒',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.reset': '重置歌词校准',
  },
  'en-US': {
    'pages.track.lyrics.placeholder': 'No lyrics',
    'commands.audio.previous-track.title': 'Audio: Previous Track',
    'commands.audio.next-track.title': 'Audio: Next Track',
    'commands.audio.toggle-play-pause.title': 'Audio: Toggle Play/Pause',
    'magnet.desktopLyricsButton.title.disable': 'Disable desktop lyrics',
    'magnet.desktopLyricsButton.contextMenu.clickThrough.enable': 'Enable click-through',
    'magnet.desktopLyricsButton.contextMenu.clickThrough.disable': 'Disable click-through',
    'magnet.desktopLyricsButton.contextMenu.fontSize.small': 'Font size: Small',
    'magnet.desktopLyricsButton.contextMenu.fontSize.large': 'Font size: Large',
    'magnet.desktopLyricsButton.contextMenu.opacity.p60': 'Opacity: 60%',
    'magnet.desktopLyricsButton.contextMenu.opacity.p100': 'Opacity: 100%',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.slower': 'Slow lyrics by 100 ms',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.faster': 'Advance lyrics by 100 ms',
    'magnet.desktopLyricsButton.contextMenu.lyricOffset.reset': 'Reset lyrics sync',
  },
};

const DESKTOP_LYRICS_DEFAULT_FONT_STACK =
  "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function emitStorageChange(key: string, value: string | null): void {
  try {
    window.dispatchEvent(new CustomEvent(PMP_STORAGE_CHANGE_EVENT, { detail: { key, value } }));
  } catch {
    // best-effort notification only
  }
}

export function writeDesktopLyricsOverlayJson<T>(key: string, value: T): void {
  try {
    const encoded = JSON.stringify(value);
    localStorage.setItem(key, encoded);
    emitStorageChange(key, encoded);
  } catch {
    // The native command has already applied the runtime state; persistence is best-effort here.
  }
}

function resolveLocale(value: unknown): DesktopLyricsOverlayLocale {
  return value === 'en-US' || value === 'zh-CN' ? value : DEFAULT_LOCALE;
}

function readDesktopLyricsOverlayLocale(): DesktopLyricsOverlayLocale {
  const json = readJson<string | null>(DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.LOCALE, null);
  if (typeof json === 'string') {
    return resolveLocale(json);
  }

  return resolveLocale(readString(DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.LOCALE));
}

function readFontConfig(): DesktopLyricsFontConfig | null {
  const raw = readJson<unknown>(
    DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_FONT_CONFIG,
    null
  );
  if (!isRecord(raw)) return null;

  const family = typeof raw.family === 'string' ? raw.family.trim() : '';
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!family || !path) return null;

  return { family, path };
}

function formatDesktopLyricsFontStack(fontFamily: string | null | undefined): string {
  const normalized = typeof fontFamily === 'string' ? fontFamily.trim() : '';
  if (!normalized) return DESKTOP_LYRICS_DEFAULT_FONT_STACK;
  return `${JSON.stringify(normalized)}, ${DESKTOP_LYRICS_DEFAULT_FONT_STACK}`;
}

export function useDesktopLyricsOverlayT(): (
  key: DesktopLyricsOverlayMessageKey
) => string {
  const [locale, setLocale] = useState<DesktopLyricsOverlayLocale>(() =>
    readDesktopLyricsOverlayLocale()
  );

  useEffect(() => {
    const syncLocale = () => setLocale(readDesktopLyricsOverlayLocale());
    const onStorage = (event: StorageEvent) => {
      if (event.key === DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.LOCALE) {
        syncLocale();
      }
    };
    const onLocalStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.LOCALE) {
        syncLocale();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onLocalStorageChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onLocalStorageChange);
    };
  }, []);

  return useMemo(() => {
    return (key) =>
      DESKTOP_LYRICS_OVERLAY_MESSAGES[locale]?.[key] ??
      DESKTOP_LYRICS_OVERLAY_MESSAGES[DEFAULT_LOCALE][key] ??
      key;
  }, [locale]);
}

export function useDesktopLyricsOverlayFontFamily(): string {
  const [fontConfig, setFontConfig] = useState<DesktopLyricsFontConfig | null>(() =>
    readFontConfig()
  );
  const activeFontFaceRef = useRef<FontFace | null>(null);

  useEffect(() => {
    const syncFontConfig = () => setFontConfig(readFontConfig());
    const onStorage = (event: StorageEvent) => {
      if (event.key === DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_FONT_CONFIG) {
        syncFontConfig();
      }
    };
    const onLocalStorageChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (detail?.key === DESKTOP_LYRICS_OVERLAY_STORAGE_KEYS.DESKTOP_LYRICS_FONT_CONFIG) {
        syncFontConfig();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onLocalStorageChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onLocalStorageChange);
    };
  }, []);

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

    if (!fontConfig || typeof FontFace === 'undefined' || !('fonts' in document)) {
      return () => {
        disposed = true;
        cleanupActiveFontFace();
      };
    }

    void (async () => {
      try {
        const fs = await import('@tauri-apps/api/fs');
        const bytes = await fs.readBinaryFile(fontConfig.path);
        if (disposed || !(bytes instanceof Uint8Array) || bytes.length === 0) return;

        const source = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer;
        const fontFace = new FontFace(fontConfig.family, source);
        await fontFace.load();
        if (disposed) return;

        document.fonts.add(fontFace);
        activeFontFaceRef.current = fontFace;
      } catch {
        // Keep the overlay on the default font stack if the optional custom font fails.
      }
    })();

    return () => {
      disposed = true;
      cleanupActiveFontFace();
    };
  }, [fontConfig]);

  return useMemo(() => formatDesktopLyricsFontStack(fontConfig?.family), [fontConfig?.family]);
}
