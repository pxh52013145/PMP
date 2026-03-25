import { useEffect, useMemo, useRef, useState } from 'react';

import type { MagnetChromeOverrideMode } from '../../modules/magnets';
import type { MagnetBounds } from '../../modules/magnets/geometry';
import { buildAdaptiveMagnetLayout, type MagnetJoinEdges } from '../../modules/magnets/layoutAdaptive';
import { useTheme } from '../../themes/contexts/ThemeContextWithSync';
import { resolveThemeMotionScene } from '../../themes/motion';
import type { ThemeMotionChannelSpec } from '../../themes/types/theme';
import type { Magnet } from '../../types/pixel';
import { MagnetComponent } from './Magnet';
import {
  buildMagnetSceneAnimations,
  buildMagnetSceneLayoutChannels,
  type MagnetSceneAnimation,
} from './magnetSceneRuntime';

interface MagnetLayerProps {
  magnets: Magnet[];
  pixelPositions: Map<string, { x: number; y: number }>;
  activeSpaceId: string;
  chromeOverrideMode?: MagnetChromeOverrideMode;
}

interface ExitingMagnetEntry {
  key: string;
  magnet: Magnet;
  layoutBoundsOverride?: MagnetBounds;
  joinEdges?: MagnetJoinEdges;
  sceneAnimation?: MagnetSceneAnimation;
}

type MagnetSnapshot = {
  activeSpaceId: string;
  magnetsById: Record<string, Magnet>;
  layoutBoundsByMagnetId: Record<string, MagnetBounds | undefined>;
  joinsByMagnetId: Record<string, MagnetJoinEdges | undefined>;
};

function readViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function toMagnetMap(magnets: Magnet[]): Record<string, Magnet> {
  return Object.fromEntries(magnets.map((magnet) => [magnet.id, magnet]));
}

function removeKeys<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (keys.length === 0) {
    return record;
  }

  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function MagnetLayer({ magnets, pixelPositions, activeSpaceId, chromeOverrideMode }: MagnetLayerProps) {
  const { theme } = useTheme();
  const [viewportSize, setViewportSize] = useState(readViewportSize);
  const [sceneAnimationsById, setSceneAnimationsById] = useState<Record<string, MagnetSceneAnimation>>({});
  const [layoutChannelsById, setLayoutChannelsById] = useState<Record<string, ThemeMotionChannelSpec>>({});
  const [exitingEntries, setExitingEntries] = useState<ExitingMagnetEntry[]>([]);
  const sceneAnimationTimerRef = useRef<number | null>(null);
  const layoutChannelTimerRef = useRef<number | null>(null);
  const exitBatchTimersRef = useRef<number[]>([]);
  const prevSnapshotRef = useRef<MagnetSnapshot | null>(null);
  const appBootPlayedRef = useRef(false);
  const exitBatchIdRef = useRef(0);

  const clearSceneAnimationTimer = () => {
    if (sceneAnimationTimerRef.current === null) {
      return;
    }

    window.clearTimeout(sceneAnimationTimerRef.current);
    sceneAnimationTimerRef.current = null;
  };

  const clearLayoutChannelTimer = () => {
    if (layoutChannelTimerRef.current === null) {
      return;
    }

    window.clearTimeout(layoutChannelTimerRef.current);
    layoutChannelTimerRef.current = null;
  };

  useEffect(() => {
    let resizeRaf: number | null = null;

    const handleResize = () => {
      if (resizeRaf !== null) return;
      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        setViewportSize(readViewportSize());
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeRaf !== null) {
        window.cancelAnimationFrame(resizeRaf);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSceneAnimationTimer();
      clearLayoutChannelTimer();
      exitBatchTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      exitBatchTimersRef.current = [];
    };
  }, []);

  const adaptiveLayout = useMemo(
    () => buildAdaptiveMagnetLayout(magnets, pixelPositions, viewportSize),
    [magnets, pixelPositions, viewportSize]
  );
  const appBootScene = useMemo(() => resolveThemeMotionScene(theme, 'appBoot'), [theme]);
  const spaceSwitchScene = useMemo(() => resolveThemeMotionScene(theme, 'spaceSwitch'), [theme]);

  useEffect(() => {
    if (appBootPlayedRef.current || magnets.length === 0) {
      return;
    }

    appBootPlayedRef.current = true;
    if (!appBootScene?.enter) {
      return;
    }

    clearSceneAnimationTimer();
    const ids = magnets.map((magnet) => magnet.id);
    const { animationsById, maxTotalMs } = buildMagnetSceneAnimations({
      sceneId: 'appBoot',
      phase: 'enter',
      spec: appBootScene.enter,
      ids,
      boundsByMagnetId: adaptiveLayout.layoutBoundsByMagnetId,
      stagger: appBootScene.stagger,
    });
    if (Object.keys(animationsById).length === 0) {
      return;
    }

    setSceneAnimationsById(animationsById);
    sceneAnimationTimerRef.current = window.setTimeout(() => {
      sceneAnimationTimerRef.current = null;
      setSceneAnimationsById((current) => removeKeys(current, ids));
    }, Math.max(0, maxTotalMs));
  }, [adaptiveLayout.layoutBoundsByMagnetId, appBootScene, magnets]);

  useEffect(() => {
    const nextSnapshot: MagnetSnapshot = {
      activeSpaceId,
      magnetsById: toMagnetMap(magnets),
      layoutBoundsByMagnetId: Object.fromEntries(
        magnets.map((magnet) => [magnet.id, adaptiveLayout.layoutBoundsByMagnetId[magnet.id]])
      ),
      joinsByMagnetId: Object.fromEntries(
        magnets.map((magnet) => [magnet.id, adaptiveLayout.joinsByMagnetId[magnet.id]])
      ),
    };

    const previousSnapshot = prevSnapshotRef.current;
    prevSnapshotRef.current = nextSnapshot;
    if (!previousSnapshot || previousSnapshot.activeSpaceId === activeSpaceId) {
      return;
    }

    const nextIds = magnets.map((magnet) => magnet.id);
    const nextIdSet = new Set(nextIds);
    const previousIds = Object.keys(previousSnapshot.magnetsById);
    const enteringIds = nextIds.filter((id) => !previousSnapshot.magnetsById[id]);
    const persistentIds = nextIds.filter((id) => Boolean(previousSnapshot.magnetsById[id]));
    const exitingIds = previousIds.filter((id) => !nextIdSet.has(id));

    clearSceneAnimationTimer();
    clearLayoutChannelTimer();
    setSceneAnimationsById({});
    setLayoutChannelsById({});

    if (spaceSwitchScene?.enter) {
      const { animationsById, maxTotalMs: enterMaxTotalMs } = buildMagnetSceneAnimations({
        sceneId: 'spaceSwitch',
        phase: 'enter',
        spec: spaceSwitchScene.enter,
        ids: enteringIds,
        boundsByMagnetId: nextSnapshot.layoutBoundsByMagnetId,
        stagger: spaceSwitchScene.stagger,
      });
      if (Object.keys(animationsById).length > 0) {
        setSceneAnimationsById(animationsById);
        sceneAnimationTimerRef.current = window.setTimeout(() => {
          sceneAnimationTimerRef.current = null;
          setSceneAnimationsById((current) => removeKeys(current, Object.keys(animationsById)));
        }, Math.max(0, enterMaxTotalMs));
      }

      const { channelsById, maxTotalMs: layoutMaxTotalMs } = buildMagnetSceneLayoutChannels({
        spec: spaceSwitchScene.enter,
        ids: persistentIds,
        boundsByMagnetId: nextSnapshot.layoutBoundsByMagnetId,
        stagger: spaceSwitchScene.stagger,
      });
      if (Object.keys(channelsById).length > 0) {
        setLayoutChannelsById(channelsById);
        layoutChannelTimerRef.current = window.setTimeout(() => {
          layoutChannelTimerRef.current = null;
          setLayoutChannelsById((current) => removeKeys(current, Object.keys(channelsById)));
        }, Math.max(0, layoutMaxTotalMs));
      }
    }

    if (spaceSwitchScene?.exit) {
      const { animationsById, maxTotalMs } = buildMagnetSceneAnimations({
        sceneId: 'spaceSwitch',
        phase: 'exit',
        spec: spaceSwitchScene.exit,
        ids: exitingIds,
        boundsByMagnetId: previousSnapshot.layoutBoundsByMagnetId,
        stagger: spaceSwitchScene.stagger,
      });

      const entries = exitingIds
        .map<ExitingMagnetEntry | null>((id) => {
          const magnet = previousSnapshot.magnetsById[id];
          if (!magnet) {
            return null;
          }

          return {
            key: `exit-${++exitBatchIdRef.current}-${id}`,
            magnet,
            layoutBoundsOverride: previousSnapshot.layoutBoundsByMagnetId[id],
            joinEdges: previousSnapshot.joinsByMagnetId[id],
            sceneAnimation: animationsById[id],
          };
        })
        .filter((entry): entry is ExitingMagnetEntry => entry !== null);

      if (entries.length > 0) {
        setExitingEntries((current) => [...current, ...entries]);
        const entryKeys = entries.map((entry) => entry.key);
        const timer = window.setTimeout(() => {
          setExitingEntries((current) => current.filter((entry) => !entryKeys.includes(entry.key)));
          exitBatchTimersRef.current = exitBatchTimersRef.current.filter((currentTimer) => currentTimer !== timer);
        }, Math.max(0, maxTotalMs));
        exitBatchTimersRef.current = [...exitBatchTimersRef.current, timer];
      }
    }
  }, [
    activeSpaceId,
    adaptiveLayout.layoutBoundsByMagnetId,
    adaptiveLayout.joinsByMagnetId,
    magnets,
    spaceSwitchScene,
  ]);

  return (
    <div
      className="magnet-layer"
      data-layout-mode={adaptiveLayout.mode}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {magnets.map((magnet) => (
        <div key={magnet.id} style={{ pointerEvents: 'auto' }}>
          <MagnetComponent
            magnet={magnet}
            pixelPositions={pixelPositions}
            chromeOverrideMode={chromeOverrideMode}
            layoutBoundsOverride={adaptiveLayout.layoutBoundsByMagnetId[magnet.id]}
            layoutMode={adaptiveLayout.mode}
            joinEdges={adaptiveLayout.joinsByMagnetId[magnet.id]}
            sceneAnimation={sceneAnimationsById[magnet.id]}
            layoutMotionChannel={layoutChannelsById[magnet.id]}
          />
        </div>
      ))}
      {exitingEntries.map((entry) => (
        <div key={entry.key} style={{ pointerEvents: 'none' }}>
          <MagnetComponent
            magnet={entry.magnet}
            pixelPositions={pixelPositions}
            chromeOverrideMode={chromeOverrideMode}
            layoutBoundsOverride={entry.layoutBoundsOverride}
            layoutMode={adaptiveLayout.mode}
            joinEdges={entry.joinEdges}
            sceneAnimation={entry.sceneAnimation}
          />
        </div>
      ))}
    </div>
  );
}
