import { broadcastSignal, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
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

async function tryReadSnapshotText(fileName: string): Promise<string | null> {
  try {
    const fs = await import('@tauri-apps/api/fs');
    return await fs.readTextFile(fileName, { dir: fs.BaseDirectory.AppData });
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

export async function restoreBackgroundSnapshots(options: {
  restoreSettings?: boolean;
  restoreHistory?: boolean;
} = {}): Promise<{ restoredSettings: boolean; restoredHistory: boolean }> {
  const restoreSettings = options.restoreSettings ?? true;
  const restoreHistory = options.restoreHistory ?? true;

  let restoredSettings = false;
  let restoredHistory = false;
  let emitted = false;

  if (restoreSettings && !readString(STORAGE_KEYS.BACKGROUND_SETTINGS)) {
    const settingsJson = await tryReadSnapshotText(SETTINGS_FILE);
    if (settingsJson) {
      writeString(STORAGE_KEYS.BACKGROUND_SETTINGS, settingsJson);
      restoredSettings = true;
      emitted = true;
    }
  }

  if (restoreHistory && !readString(STORAGE_KEYS.BACKGROUND_HISTORY)) {
    const historyJson = await tryReadSnapshotText(HISTORY_FILE);
    if (historyJson) {
      writeString(STORAGE_KEYS.BACKGROUND_HISTORY, historyJson);
      restoredHistory = true;
      emitted = true;
    }
  }

  if (emitted) {
    await broadcastSignal(TAURI_EVENTS.BACKGROUND_UPDATED);
  }

  return { restoredSettings, restoredHistory };
}
