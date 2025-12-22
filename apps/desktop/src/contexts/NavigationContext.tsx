import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { NavigationPageData, NavigationPageType } from '../contracts/navigation';
import { NAVIGATION_SERVICE_TOKEN, type NavigationSnapshot } from '../services/navigation';
import { useKernel } from './KernelContext';

export type { NavigationPageData, NavigationPageType, NavigationParamsMap } from '../contracts/navigation';

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

  useEffect(() => {
    setSnapshot(navigationService.getSnapshot());
    return kernel.events.on('navigation/changed', (next) => {
      setSnapshot(next);
    });
  }, [kernel.events, navigationService]);

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
