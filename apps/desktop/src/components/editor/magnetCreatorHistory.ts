import type { Magnet } from '../../types/pixel';
import { readJson, writeJson } from '../../modules/storage';

export interface MagnetHistoryItem {
  id: string;
  timestamp: number;
  magnet: Magnet;
  description: string;
}

const HISTORY_STORAGE_KEY = 'magnet-creator-history';
const MAX_HISTORY_ITEMS = 20;

export function loadMagnetHistory(magnetId: string): MagnetHistoryItem[] {
  try {
    return readJson<MagnetHistoryItem[]>(`${HISTORY_STORAGE_KEY}-${magnetId}`, []);
  } catch {
    return [];
  }
}

export function saveMagnetHistory(magnetId: string, history: MagnetHistoryItem[]) {
  try {
    writeJson(`${HISTORY_STORAGE_KEY}-${magnetId}`, history);
  } catch (error) {
    console.error('Failed to save magnet history:', error);
  }
}

export function appendMagnetHistory(
  magnet: Magnet,
  description = 'editor.magnet-creator.history.manualSave'
) {
  const history = loadMagnetHistory(magnet.id);
  const nextHistory: MagnetHistoryItem[] = [
    {
      id: `${magnet.id}-${Date.now()}`,
      timestamp: Date.now(),
      magnet: JSON.parse(JSON.stringify(magnet)) as Magnet,
      description,
    },
    ...history,
  ].slice(0, MAX_HISTORY_ITEMS);

  saveMagnetHistory(magnet.id, nextHistory);
  return nextHistory;
}
