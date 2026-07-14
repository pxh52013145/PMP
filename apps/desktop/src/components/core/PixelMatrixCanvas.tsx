import { useEffect, useMemo, useRef } from 'react';
import { PixelMatrixRenderer } from '../../pixelEngine/PixelMatrixRenderer';
import './PixelMatrixCanvas.css';
import { STORAGE_KEYS, TAURI_EVENTS, setupTauriListener } from '../../utils/windowCommunication';
import { useKernel } from '../../contexts/KernelApiContext';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { useQuality } from '../../contexts/QualityContext';
import type {
  RuntimeCapsuleState,
  RuntimeLifecycleParticipant,
} from '../../contracts/runtimeCapsule';
import { readString } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../../services/runtime-capsules';
import {
  recordStartupMemoryCheckpoint,
  setStartupMemoryTraceFlag,
} from '../../modules/startup/startupMemoryTrace';

interface PixelMatrixCanvasProps {
  onPixelPositionsUpdate?: (positions: Map<string, { x: number; y: number }>) => void;
}

const telemetry = getTelemetryLogger('visualizer', 'PixelMatrixCanvas');

export default function PixelMatrixCanvas({ onPixelPositionsUpdate }: PixelMatrixCanvasProps) {
  const kernel = useKernel();
  const runtimeCapsuleManager = useMemo(
    () =>
      kernel.services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null,
    [kernel]
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PixelMatrixRenderer | null>(null);
  const onPixelPositionsUpdateRef = useRef(onPixelPositionsUpdate);
  const { isActive, renderMode } = useWindowActivity();
  const { effective } = useQuality();
  const qualityRef = useRef(effective);
  const renderModeRef = useRef(renderMode);
  const isActiveRef = useRef(isActive);
  const participantStateRef = useRef<RuntimeCapsuleState>('cold');
  const shouldRetainRenderLease = renderMode !== 'pause';

  useEffect(() => {
    onPixelPositionsUpdateRef.current = onPixelPositionsUpdate;
  }, [onPixelPositionsUpdate]);

  useEffect(() => {
    qualityRef.current = effective;
  }, [effective]);

  useEffect(() => {
    renderModeRef.current = renderMode;
  }, [renderMode]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!runtimeCapsuleManager) return;

    const participant: RuntimeLifecycleParticipant = {
      id: 'pixel-matrix-canvas',
      capsuleId: 'visual.canvas.pixi',
      onWarm: () => {
        participantStateRef.current = 'active';
        rendererRef.current?.setInteractionEnabled(isActiveRef.current);
        rendererRef.current?.setRenderMode(renderModeRef.current);
      },
      onSuspend: () => {
        participantStateRef.current = 'suspended';
        rendererRef.current?.setInteractionEnabled(false);
        rendererRef.current?.setRenderMode('pause');
      },
      onFreeze: () => {
        participantStateRef.current = 'frozen';
        rendererRef.current?.setInteractionEnabled(false);
        rendererRef.current?.setRenderMode('pause');
      },
      onHibernate: () => {
        participantStateRef.current = 'hibernated';
        rendererRef.current?.setInteractionEnabled(false);
        rendererRef.current?.setRenderMode('pause');
      },
      onTeardown: () => {
        participantStateRef.current = 'cold';
        rendererRef.current?.setInteractionEnabled(false);
        rendererRef.current?.setRenderMode('pause');
      },
      collectSnapshot: () => ({
        id: 'pixel-matrix-canvas',
        capsuleId: 'visual.canvas.pixi',
        state: participantStateRef.current,
        detail: {
          rendererMounted: rendererRef.current !== null,
          renderMode: renderModeRef.current,
          interactionActive: isActiveRef.current,
        },
      }),
    };

    return runtimeCapsuleManager.registerParticipant('visual.canvas.pixi', participant);
  }, [runtimeCapsuleManager]);

  useEffect(() => {
    if (!runtimeCapsuleManager || !shouldRetainRenderLease) return;

    const lease = runtimeCapsuleManager.acquireLease({
      capabilityId: 'visual.canvas.pixi',
      ownerKind: 'window',
      ownerId: 'pixel-matrix-canvas',
      reason: {
        routeId: 'main',
        detail: 'pixi matrix canvas mounted',
      },
    });

    return () => {
      if (!lease) return;
      runtimeCapsuleManager.releaseLease(lease.id, {
        kind: 'shutdown',
        detail: 'pixi matrix canvas unmounted',
      });
    };
  }, [runtimeCapsuleManager, shouldRetainRenderLease]);

  useEffect(() => {
    if (!containerRef.current) return;

    const quality = qualityRef.current;
    telemetry.info('visualizer.pixel-matrix.renderer.init', {
      fields: {
        renderScale: quality.renderScale,
        fpsForeground: quality.fpsForeground,
        fpsBackground: quality.fpsBackground,
      },
    });
    const renderer = new PixelMatrixRenderer(window.innerWidth, window.innerHeight, {
      renderScale: quality.renderScale,
      fpsCapFull: quality.fpsForeground,
      fpsCapThrottle: quality.fpsBackground,
    });
    setStartupMemoryTraceFlag('pixelRendererCreated');
    containerRef.current.appendChild(renderer.getView());
    rendererRef.current = renderer;

    renderer.updateLayout(window.innerWidth, window.innerHeight);

    const savedShape = readString(STORAGE_KEYS.PIXEL_SHAPE);
    if (savedShape) {
      renderer.updatePixelShape(savedShape);
    }

    const savedSize = readString(STORAGE_KEYS.PIXEL_SIZE);
    if (savedSize) {
      renderer.updatePixelSize(parseFloat(savedSize));
    }

    const savedOpacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
    if (savedOpacity) {
      renderer.updatePixelOpacity(parseFloat(savedOpacity));
    }

    onPixelPositionsUpdateRef.current?.(renderer.getAllPixelPositions());
    recordStartupMemoryCheckpoint('pixel.renderer.created', {
      fields: {
        renderScale: quality.renderScale,
        fpsForeground: quality.fpsForeground,
        fpsBackground: quality.fpsBackground,
      },
    });

    let resizeRaf: number | null = null;
    const handleResize = () => {
      if (!rendererRef.current) return;
      if (resizeRaf !== null) return;

      resizeRaf = window.requestAnimationFrame(() => {
        resizeRaf = null;
        const rendererInstance = rendererRef.current;
        if (!rendererInstance) return;

        rendererInstance.updateLayout(window.innerWidth, window.innerHeight);
        onPixelPositionsUpdateRef.current?.(rendererInstance.getAllPixelPositions());
      });
    };

    const setupPixelListeners = async () => {
      const unlisteners: (() => void)[] = [];

      const unlistenShape = await setupTauriListener(TAURI_EVENTS.PIXEL_SHAPE_UPDATED, () => {
        if (!rendererRef.current) return;
        const shape = readString(STORAGE_KEYS.PIXEL_SHAPE);
        if (shape) rendererRef.current.updatePixelShape(shape);
      });
      unlisteners.push(unlistenShape);

      const unlistenSize = await setupTauriListener(TAURI_EVENTS.PIXEL_SIZE_UPDATED, () => {
        if (!rendererRef.current) return;
        const size = readString(STORAGE_KEYS.PIXEL_SIZE);
        if (size) rendererRef.current.updatePixelSize(parseFloat(size));
      });
      unlisteners.push(unlistenSize);

      const unlistenOpacity = await setupTauriListener(TAURI_EVENTS.PIXEL_OPACITY_UPDATED, () => {
        if (!rendererRef.current) return;
        const opacity = readString(STORAGE_KEYS.PIXEL_OPACITY);
        if (opacity) rendererRef.current.updatePixelOpacity(parseFloat(opacity));
      });
      unlisteners.push(unlistenOpacity);

      return () => {
        unlisteners.forEach((unlisten) => unlisten());
      };
    };

    window.addEventListener('resize', handleResize);
    const cleanupPromise = setupPixelListeners();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeRaf !== null) window.cancelAnimationFrame(resizeRaf);
      cleanupPromise.then((cleanup) => cleanup());
      telemetry.info('visualizer.pixel-matrix.renderer.destroy');
      rendererRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (
      runtimeCapsuleManager &&
      (participantStateRef.current === 'hibernated' || participantStateRef.current === 'cold')
    ) {
      rendererRef.current?.setInteractionEnabled(false);
      return;
    }
    rendererRef.current?.setInteractionEnabled(isActive);
  }, [isActive, runtimeCapsuleManager]);

  useEffect(() => {
    if (
      runtimeCapsuleManager &&
      renderMode !== 'pause' &&
      (participantStateRef.current === 'hibernated' || participantStateRef.current === 'cold')
    ) {
      return;
    }
    rendererRef.current?.setRenderMode(renderMode);
    telemetry.info('visualizer.pixel-matrix.render-mode.changed', {
      fields: {
        renderMode,
      },
    });
  }, [renderMode, runtimeCapsuleManager]);

  useEffect(() => {
    rendererRef.current?.setQuality({
      renderScale: effective.renderScale,
      fpsCapFull: effective.fpsForeground,
      fpsCapThrottle: effective.fpsBackground,
    });
    telemetry.debug('visualizer.pixel-matrix.quality.updated', {
      fields: {
        renderScale: effective.renderScale,
        fpsForeground: effective.fpsForeground,
        fpsBackground: effective.fpsBackground,
      },
    });
  }, [effective.fpsBackground, effective.fpsForeground, effective.renderScale]);

  return (
    <div
      ref={containerRef}
      className="pixel-matrix-canvas"
      style={{
        width: '100vw',
        height: '100vh',
      }}
    />
  );
}
