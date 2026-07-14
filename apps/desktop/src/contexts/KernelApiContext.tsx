import { createContext, useContext } from 'react';
import type { AppEvents } from '../contracts/events';
import type { Kernel } from '../kernel';

export type DesktopKernel = Kernel<AppEvents>;

export const KernelContext = createContext<DesktopKernel | undefined>(undefined);

let editorKernelDisposer: ((windowType: string) => boolean) | null = null;

export function registerEditorKernelDisposer(
  disposer: (windowType: string) => boolean
): () => void {
  editorKernelDisposer = disposer;
  return () => {
    if (editorKernelDisposer === disposer) editorKernelDisposer = null;
  };
}

export function disposeKernelRuntimeForEditorWindow(windowType: string): boolean {
  return editorKernelDisposer?.(windowType) ?? false;
}

export function useKernel(): DesktopKernel {
  const kernel = useContext(KernelContext);
  if (!kernel) {
    throw new Error('useKernel must be used within a kernel provider');
  }
  return kernel;
}
