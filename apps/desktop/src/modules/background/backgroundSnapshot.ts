import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { readString, writeString } from '../storage';

const SETTINGS_FILE = 'pixel-matrix-background-settings.snapshot.json';
const HISTORY_FILE = 'pixel-matrix-background-history.snapshot.json';

async function tryWriteSnapshot(fileName: string, json: string): Promise<void> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    await fs.writeFile({ path: fileName, contents: json }, { dir: fs.BaseDirectory.AppData });
  } catch {
    // best-effort
  }
}

async function tryReadSnapshot<T>(fileName: string): Promise<T | null> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    const contents = await fs.readTextFile(fileName, { dir: fs.BaseDirectory.AppData });
    return JSON.parse(contents) as T;
  } catch {
    return null;
  }
}

export async function persistBackgroundSnapshots(options: {
  storageKey: string;
  json: string;
}): Promise<void> {
  if (options.storageKey === STORAGE_KEYS.BACKGROUND_SETTINGS) {
    await tryWriteSnapshot(SETTINGS_FILE, options.json);
  }
  if (options.storageKey === STORAGE_KEYS.BACKGROUND_HISTORY) {
    await tryWriteSnapshot(HISTORY_FILE, options.json);
  }
}

export async function restoreBackgroundSnapshots(): Promise<{
  restoredSettings: boolean;
  restoredHistory: boolean;
}> {
  let restoredSettings = false;
  let restoredHistory = false;

  if (!readString(STORAGE_KEYS.BACKGROUND_SETTINGS)) {
    const settings = await tryReadSnapshot<unknown>(SETTINGS_FILE);
    if (settings) {
      writeString(STORAGE_KEYS.BACKGROUND_SETTINGS, JSON.stringify(settings));
      restoredSettings = true;
    }
  }

  if (!readString(STORAGE_KEYS.BACKGROUND_HISTORY)) {
    const history = await tryReadSnapshot<unknown>(HISTORY_FILE);
    if (history) {
      writeString(STORAGE_KEYS.BACKGROUND_HISTORY, JSON.stringify(history));
      restoredHistory = true;
    }
  }

  return { restoredSettings, restoredHistory };
}
