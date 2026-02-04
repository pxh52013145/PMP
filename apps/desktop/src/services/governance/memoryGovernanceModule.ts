import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { APP_LIFECYCLE_SERVICE_TOKEN, type AppLifecycleService } from '../lifecycle';
import { NAVIGATION_SERVICE_TOKEN } from '../navigation';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED,
  MEMORY_GOVERNANCE_INTERVAL_MS,
  type MemoryGovernanceReason,
} from '../../contracts/memoryGovernance';
import { readJson } from '../../modules/storage';
import { PMP_STORAGE_CHANGE_EVENT, type PmpStorageChangeDetail } from '../../modules/storage/localStorage';
import {
  DefaultMemoryGovernanceService,
  MEMORY_GOVERNANCE_SERVICE_TOKEN,
  type MemoryGovernanceService,
} from './MemoryGovernanceService';

function readEnabledSetting(): boolean {
  try {
    return readJson<boolean>(STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED, DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED);
  } catch {
    return DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED;
  }
}

export function createMemoryGovernanceModule(): KernelModule<AppEvents> {
  return {
    id: 'memory-governance',
    activate: ({ services, events }) => {
      const navigation = services.get(NAVIGATION_SERVICE_TOKEN);
      const lifecycle = services.get(APP_LIFECYCLE_SERVICE_TOKEN) as AppLifecycleService;

      const service: MemoryGovernanceService = new DefaultMemoryGovernanceService(navigation, events);
      const unregister = services.register(MEMORY_GOVERNANCE_SERVICE_TOKEN, service);

      if (typeof window === 'undefined') {
        return () => unregister();
      }

      let enabled = readEnabledSetting();
      let timer: number | null = null;

      const start = () => {
        if (timer !== null) return;
        timer = window.setInterval(() => {
          void service.runOnce('interval');
        }, MEMORY_GOVERNANCE_INTERVAL_MS);
      };

      const stop = () => {
        if (timer === null) return;
        window.clearInterval(timer);
        timer = null;
      };

      const syncEnabled = (next: boolean, reason: MemoryGovernanceReason) => {
        enabled = next;
        if (enabled) {
          start();
          void service.runOnce(reason);
        } else {
          stop();
        }
      };

      if (enabled) start();

      const unregisterFlush = lifecycle.registerFlushHandler((reason) => {
        if (!enabled) return;
        if (
          reason === 'beforeunload' ||
          reason === 'pagehide' ||
          reason === 'visibility-hidden' ||
          reason === 'tauri-window-hidden'
        ) {
          void service.runOnce(reason);
        }
      });

      const onStorageChange = (event: Event) => {
        const detail = (event as CustomEvent<PmpStorageChangeDetail>).detail;
        if (!detail || detail.key !== STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED) return;
        syncEnabled(readEnabledSetting(), 'manual');
      };
      window.addEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);

      return () => {
        stop();
        try {
          unregisterFlush();
        } catch {
          // ignore
        }
        window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, onStorageChange as EventListener);
        unregister();
      };
    },
  };
}

