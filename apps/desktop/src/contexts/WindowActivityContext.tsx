import { createContext, useContext } from 'react';
import type { RenderMode } from '../contracts/performance';

export interface WindowActivityState {
  isVisible: boolean;
  isActive: boolean;
  renderMode: RenderMode;
}

const WindowActivityContext = createContext<WindowActivityState>({
  isVisible: true,
  isActive: true,
  renderMode: 'full',
});

export function useWindowActivity(): WindowActivityState {
  return useContext(WindowActivityContext);
}

export const WindowActivityProvider = WindowActivityContext.Provider;
