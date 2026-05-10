import type { Magnet } from '../../types/pixel';
import { readJson, writeJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export interface MagnetHistoryItem {
  id: string;
  timestamp: number;
  magnet: Magnet;
  description: string;
}

const HISTORY_STORAGE_KEY = STORAGE_KEYS.MAGNET_EDITOR_HISTORY_PREFIX;
const MAX_HISTORY_ITEMS = 20;
const telemetry = getTelemetryLogger('editor', 'magnetCreatorHistory');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
    telemetry.error('editor.magnet.history.save.failed', {
      message: getErrorMessage(error),
      fields: {
        magnetId,
      },
    });
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
