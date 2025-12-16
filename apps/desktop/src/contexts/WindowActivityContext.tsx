import { createContext, useContext } from 'react';

export interface WindowActivityState {
  isVisible: boolean;
  isActive: boolean;
}

const WindowActivityContext = createContext<WindowActivityState>({
  isVisible: true,
  isActive: true,
});

export function useWindowActivity(): WindowActivityState {
  return useContext(WindowActivityContext);
}

export const WindowActivityProvider = WindowActivityContext.Provider;

