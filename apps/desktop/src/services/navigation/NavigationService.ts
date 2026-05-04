import type { ScopedEventBus } from '../../kernel';
import { createServiceToken } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import type { NavigationPageData, NavigationPageType } from '../../contracts/navigation';
import { parseNavigationParams } from '../../contracts/navigationParams';
import { getTelemetryLogger } from '../telemetry/TelemetryService';

export type NavigationSnapshot = {
  currentPage: NavigationPageData;
  history: NavigationPageData[];
  currentIndex: number;
};

export interface NavigationService {
  getSnapshot(): NavigationSnapshot;
  navigateTo(type: NavigationPageType, params?: Record<string, unknown>): void;
  goBack(): void;
}

export const NAVIGATION_SERVICE_TOKEN = createServiceToken<NavigationService>('service.navigation');

export class InMemoryNavigationService implements NavigationService {
  private static readonly MAX_HISTORY_LENGTH = 50;

  private history: NavigationPageData[];
  private currentIndex = 0;
  private readonly telemetry = getTelemetryLogger('navigation', 'NavigationService');

  constructor(
    private readonly events: ScopedEventBus<AppEvents>,
    initialPage: NavigationPageData = { type: 'home' }
  ) {
    this.history = [initialPage];
  }

  getSnapshot(): NavigationSnapshot {
    const currentPage = this.history[this.currentIndex] ?? { type: 'home' };
    return {
      currentPage,
      history: [...this.history],
      currentIndex: this.currentIndex,
    };
  }

  navigateTo(type: NavigationPageType, params?: Record<string, unknown>): void {
    const currentPage = this.history[this.currentIndex] ?? { type: 'home' };
    const validated = parseNavigationParams(type, params);
    const nextPage: NavigationPageData = validated === undefined ? { type } : { type, params: validated };

    if (currentPage.type === type) {
      if (!nextPage.params && !currentPage.params) return;

      let paramsEqual = false;
      try {
        paramsEqual =
          JSON.stringify(nextPage.params ?? {}) ===
          JSON.stringify((currentPage.params as unknown) ?? {});
      } catch {
        paramsEqual = false;
      }

      if (paramsEqual) return;

      const nextHistory = [...this.history];
      nextHistory[this.currentIndex] = nextPage;
      this.history = nextHistory;
      this.telemetry.info('navigation.replace-current', {
        fields: {
          fromPage: currentPage.type,
          toPage: nextPage.type,
          historyLength: nextHistory.length,
          currentIndex: this.currentIndex,
        },
      });
      this.emitChanged();
      return;
    }

    const nextHistory = this.history.slice(0, this.currentIndex + 1);
    nextHistory.push(nextPage);

    const overflow = nextHistory.length - InMemoryNavigationService.MAX_HISTORY_LENGTH;
    if (overflow > 0) {
      nextHistory.splice(0, overflow);
    }

    this.history = nextHistory;
    this.currentIndex = nextHistory.length - 1;
    this.telemetry.info('navigation.navigate', {
      fields: {
        fromPage: currentPage.type,
        toPage: nextPage.type,
        historyLength: nextHistory.length,
        currentIndex: this.currentIndex,
      },
    });
    this.emitChanged();
  }

  goBack(): void {
    if (this.currentIndex <= 0) return;
    const previousPage = this.history[this.currentIndex] ?? { type: 'home' };
    this.currentIndex -= 1;
    const nextPage = this.history[this.currentIndex] ?? { type: 'home' };
    this.telemetry.info('navigation.back', {
      fields: {
        fromPage: previousPage.type,
        toPage: nextPage.type,
        historyLength: this.history.length,
        currentIndex: this.currentIndex,
      },
    });
    this.emitChanged();
  }

  private emitChanged(): void {
    const snapshot = this.getSnapshot();
    this.events.emit('navigation/changed', snapshot);
  }
}
