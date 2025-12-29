import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import type { NavigationPageData, NavigationPageType } from '../contracts/navigation';
import { NAVIGATION_SERVICE_TOKEN, type NavigationSnapshot } from '../services/navigation';
import { useKernel } from './KernelContext';
import { readData, setupDualListener, STORAGE_KEYS, TAURI_EVENTS } from '../utils/windowCommunication';

export type { NavigationPageData, NavigationPageType, NavigationParamsMap } from '../contracts/navigation';
export type { NavigationParamsFor } from '../contracts/navigation';

interface NavigationContextType {
  currentPage: NavigationPageData;
  navigateTo: (page: NavigationPageType, params?: Record<string, unknown>) => void;
  goBack: () => void;
  history: NavigationPageData[];
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

interface NavigationProviderProps {
  children: ReactNode;
}

export function NavigationProvider({ children }: NavigationProviderProps) {
  const kernel = useKernel();
  const navigationService = kernel.services.get(NAVIGATION_SERVICE_TOKEN);

  const [snapshot, setSnapshot] = useState<NavigationSnapshot>(() => navigationService.getSnapshot());
  const lastExternalRequestId = useRef<string | null>(null);

  useEffect(() => {
    setSnapshot(navigationService.getSnapshot());
    return kernel.events.on('navigation/changed', (next) => {
      setSnapshot(next);
    });
  }, [kernel.events, navigationService]);

  useEffect(() => {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === 'object' && !Array.isArray(value);

    const readString = (value: unknown, key: string): string | null => {
      if (!isRecord(value)) return null;
      const candidate = value[key];
      return typeof candidate === 'string' ? candidate : null;
    };

    const onRequest = () => {
      const payload = readData<unknown>(STORAGE_KEYS.NAVIGATION_REQUEST);
      const requestId = readString(payload, 'requestId') ?? readString(payload, 'id');
      if (!requestId) return;
      if (lastExternalRequestId.current === requestId) return;
      lastExternalRequestId.current = requestId;

      const page = readString(payload, 'page') ?? readString(payload, 'type');
      if (!page) return;
      const params = isRecord(payload) ? payload.params : undefined;

      navigationService.navigateTo(page as NavigationPageType, isRecord(params) ? params : undefined);
    };

    let cleanup: null | (() => void) = null;
    void setupDualListener([STORAGE_KEYS.NAVIGATION_REQUEST], [TAURI_EVENTS.NAVIGATION_REQUESTED], onRequest).then(
      (fn) => {
        cleanup = fn;
      }
    );
    return () => cleanup?.();
  }, [navigationService]);

  const navigateTo = useCallback(
    (page: NavigationPageType, params?: Record<string, unknown>) => {
      navigationService.navigateTo(page, params);
    },
    [navigationService]
  );

  const goBack = useCallback(() => {
    navigationService.goBack();
  }, [navigationService]);

  return (
    <NavigationContext.Provider
      value={{
        currentPage: snapshot.currentPage,
        navigateTo,
        goBack,
        history: snapshot.history,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}
