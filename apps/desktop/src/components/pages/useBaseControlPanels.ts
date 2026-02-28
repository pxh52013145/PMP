import { useCallback, useEffect, useState, type RefObject } from 'react';

type MusicLibraryBaseControlPanel = 'sort' | 'filter' | 'properties';

interface UseBaseControlPanelsOptions {
  enabled: boolean;
  toolbarRegionRef: RefObject<HTMLElement | null>;
}

interface UseBaseControlPanelsResult {
  showBaseSortPanel: boolean;
  showBaseFilterPanel: boolean;
  showColumnSettings: boolean;
  toggleBaseControlPanel: (panel: MusicLibraryBaseControlPanel) => void;
}

export function useBaseControlPanels({
  enabled,
  toolbarRegionRef,
}: UseBaseControlPanelsOptions): UseBaseControlPanelsResult {
  const [openPanel, setOpenPanel] = useState<MusicLibraryBaseControlPanel | null>(null);

  const closeBaseControlPanels = useCallback(() => {
    setOpenPanel(null);
  }, []);

  const toggleBaseControlPanel = useCallback((panel: MusicLibraryBaseControlPanel) => {
    setOpenPanel((previous) => (previous === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (enabled) return;
    setOpenPanel(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || openPanel === null) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRegionRef.current?.contains(target)) return;
      closeBaseControlPanels();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeBaseControlPanels();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeBaseControlPanels, enabled, openPanel, toolbarRegionRef]);

  const showBaseSortPanel = openPanel === 'sort';
  const showBaseFilterPanel = openPanel === 'filter';
  const showColumnSettings = openPanel === 'properties';

  return {
    showBaseSortPanel,
    showBaseFilterPanel,
    showColumnSettings,
    toggleBaseControlPanel,
  };
}
