const BACKGROUND_SETTINGS_KEY = 'pixel-matrix-background-settings';
const BACKGROUND_HISTORY_KEY = 'pixel-matrix-background-history';

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
  if (options.storageKey === BACKGROUND_SETTINGS_KEY) {
    await tryWriteSnapshot(SETTINGS_FILE, options.json);
  }
  if (options.storageKey === BACKGROUND_HISTORY_KEY) {
    await tryWriteSnapshot(HISTORY_FILE, options.json);
  }
}

export async function restoreBackgroundSnapshots(): Promise<{
  restoredSettings: boolean;
  restoredHistory: boolean;
}> {
  let restoredSettings = false;
  let restoredHistory = false;

  if (!localStorage.getItem(BACKGROUND_SETTINGS_KEY)) {
    const settings = await tryReadSnapshot<unknown>(SETTINGS_FILE);
    if (settings) {
      try {
        localStorage.setItem(BACKGROUND_SETTINGS_KEY, JSON.stringify(settings));
        restoredSettings = true;
      } catch {
        // ignore
      }
    }
  }

  if (!localStorage.getItem(BACKGROUND_HISTORY_KEY)) {
    const history = await tryReadSnapshot<unknown>(HISTORY_FILE);
    if (history) {
      try {
        localStorage.setItem(BACKGROUND_HISTORY_KEY, JSON.stringify(history));
        restoredHistory = true;
      } catch {
        // ignore
      }
    }
  }

  return { restoredSettings, restoredHistory };
}
