import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { readString } from '../storage';

type BackgroundMode = 'maximized' | 'windowed';

type BackgroundConfig = {
  type: 'color' | 'image' | 'video' | 'gradient' | 'html';
  image?: { url: string };
  video?: { url: string };
};

type BackgroundSettings = Record<BackgroundMode, BackgroundConfig>;
type HistoryItem = { id: string; config: BackgroundConfig; timestamp: number };

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isTauriLocalhostHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

function tryGetManagedMediaRelPath(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('data:')) return null;
  if ((url.startsWith('http://') || url.startsWith('https://')) && !isTauriLocalhostHttpUrl(url)) {
    return null;
  }

  const candidates = [url];
  try {
    candidates.push(decodeURIComponent(url));
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    const normalized = candidate.split('\\').join('/');

    let markerIndex = normalized.lastIndexOf('/background-media/');
    let markerLength = '/background-media/'.length;

    if (markerIndex === -1 && normalized.startsWith('background-media/')) {
      markerIndex = 0;
      markerLength = 'background-media/'.length;
    }

    if (markerIndex === -1) continue;

    const tail = normalized.slice(markerIndex + markerLength);
    const fileName = tail.split('?')[0].split('#')[0].split('/')[0];
    if (!fileName || !fileName.startsWith('background-')) continue;
    return `background-media/${fileName}`;
  }

  return null;
}

function getConfigMediaRelPath(config: BackgroundConfig): string | null {
  if (config.type === 'image') return tryGetManagedMediaRelPath(config.image?.url);
  if (config.type === 'video') return tryGetManagedMediaRelPath(config.video?.url);
  return null;
}

export function collectReferencedBackgroundMedia(): Set<string> {
  const referenced = new Set<string>();

  const settings = safeParseJson<BackgroundSettings>(readString(STORAGE_KEYS.BACKGROUND_SETTINGS));
  if (settings) {
    const maxRel = getConfigMediaRelPath(settings.maximized);
    if (maxRel) referenced.add(maxRel);
    const winRel = getConfigMediaRelPath(settings.windowed);
    if (winRel) referenced.add(winRel);
  }

  const history = safeParseJson<HistoryItem[]>(readString(STORAGE_KEYS.BACKGROUND_HISTORY)) || [];
  for (const item of history) {
    const rel = getConfigMediaRelPath(item.config);
    if (rel) referenced.add(rel);
  }

  return referenced;
}

export async function gcOrphanBackgroundMedia(): Promise<{ scanned: number; removed: number }> {
  const fs = await import('@tauri-apps/api/fs');

  // Safety: only delete files when we have a stable view of background storage.
  // In Tauri startup we may restore settings/history from AppData snapshots asynchronously.
  // If we GC before that restore finishes, we'd treat everything as "orphan" and delete user media.
  const hasSettings = Boolean(readString(STORAGE_KEYS.BACKGROUND_SETTINGS));
  const hasHistory = Boolean(readString(STORAGE_KEYS.BACKGROUND_HISTORY));

  const referenced = collectReferencedBackgroundMedia();
  const allowDelete = hasSettings && hasHistory && referenced.size > 0;
  let entries: Array<import('@tauri-apps/api/fs').FileEntry> = [];
  try {
    entries = await fs.readDir('background-media', {
      dir: fs.BaseDirectory.AppData,
      recursive: false,
    });
  } catch {
    return { scanned: 0, removed: 0 };
  }

  let scanned = 0;
  let removed = 0;
  for (const entry of entries) {
    const normalized = entry.path.split('\\').join('/');
    const name = normalized.split('/').pop() || '';
    if (!name) continue;
    scanned += 1;
    if (!allowDelete) continue;
    const rel = `background-media/${name}`;
    if (referenced.has(rel)) continue;
    try {
      await fs.removeFile(rel, { dir: fs.BaseDirectory.AppData });
      removed += 1;
    } catch {
      // best-effort
    }
  }

  return { scanned, removed };
}
