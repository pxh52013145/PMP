import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { QualitySnapshot } from '../contracts/quality';
import { DEFAULT_QUALITY_SETTINGS_V1, resolveQualityProfile } from '../contracts/quality';
import { useKernel } from './KernelContext';
import { QUALITY_SERVICE_TOKEN, type QualityService } from '../services/quality';
import { useWindowActivity } from './WindowActivityContext';

function buildFallbackSnapshot(): QualitySnapshot {
  const level = DEFAULT_QUALITY_SETTINGS_V1.fixedLevel;
  return {
    settings: DEFAULT_QUALITY_SETTINGS_V1,
    effective: { level, ...resolveQualityProfile(level) },
    updatedAtMs: Date.now(),
  };
}

const QualityContext = createContext<QualitySnapshot>(buildFallbackSnapshot());

export function QualityProvider({ children }: { children: ReactNode }) {
  const kernel = useKernel();
  const quality = kernel.services.get(QUALITY_SERVICE_TOKEN) as QualityService;
  const activity = useWindowActivity();

  const [snapshot, setSnapshot] = useState<QualitySnapshot>(() => quality.getSnapshot());

  useEffect(() => {
    setSnapshot(quality.getSnapshot());
    return kernel.events.on('quality/changed', (next) => {
      setSnapshot(next);
    });
  }, [kernel.events, quality]);

  useEffect(() => {
    quality.setWindowActivity({
      renderMode: activity.renderMode,
      isActive: activity.isActive,
      isVisible: activity.isVisible,
    });
  }, [activity.isActive, activity.isVisible, activity.renderMode, quality]);

  const value = useMemo(() => snapshot, [snapshot]);
  return <QualityContext.Provider value={value}>{children}</QualityContext.Provider>;
}

export function useQuality(): QualitySnapshot {
  return useContext(QualityContext);
}

