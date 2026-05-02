import { useEffect, useState, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, getAll } from '@tauri-apps/api/window';
import {
  setupConfigSync,
  TAURI_EVENTS,
  STORAGE_KEYS,
  setupTauriListener,
} from './utils/windowCommunication';
import { WindowActivityProvider } from './contexts/WindowActivityContext';
import { useAdaptiveRenderMode } from './contexts/useAdaptiveRenderMode';
import { useKernel } from './contexts/KernelContext';
import { QualityProvider } from './contexts/QualityContext';
import { CommandPalette } from './components/commands/CommandPalette';
import { EditorProvider, useEditor } from './contexts/EditorContext';
import { NavigationProvider, useNavigation } from './contexts/NavigationContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { MATRIX_CONFIG } from './constants/config';
import { Magnet } from './types/pixel';
import {
  createDefaultMagnetLibrary,
  createInitialMagnetState,
  MagnetLibraryProvider,
} from './modules/magnets';
import {
  hasFocusedVisibleEditorWindow,
  shouldPollEditorAuxWindowFocus,
} from './utils/editorWindowFocus';
import { APP_LIFECYCLE_SERVICE_TOKEN } from './services/lifecycle';
import { isTauriRuntime } from './utils/tauriRuntime';
import { WindowCloseProvider } from './contexts/WindowCloseContext';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from './services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from './services/keybindings';
import {
  SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN,
  type SpaceRuntimeGovernanceService,
} from './services/governance';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from './services/runtime-capsules';
import { getDebugConfig, setDebugConfig } from './modules/debug';
import { INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN } from './magnet-system/plugins/installedExtensionRuntimeManager';
import {
  activateInstalledExtensionsForNativeHostFileOpens,
  activateInstalledExtensionsForHostFiles,
} from './magnet-system/plugins/installedExtensionHostFileActivation';
import { consumePendingHostFileOpens } from './modules/startup/hostFileOpen';
import {
  shouldRunDurableStorageMigrations,
  shouldRunPmpsDurableMigration,
} from './modules/startup/durableMigrationGuards';
import { onStartupIdle } from './modules/startup/startupReady';
import { readOrnamentsConfig } from './modules/ornaments-v2/store';
import { usePerformanceControlSettings } from './contexts/usePerformanceControlSettings';
import { applyWindowPinPolicy } from './utils/windowPinRuntime';
import { readWindowPinState, writeWindowPinState } from './utils/windowPinState';
import { MatrixWorkbench } from './workbenches/matrix/MatrixWorkbench';
import { getTelemetryLogger } from './services/telemetry/TelemetryService';
import { invokeWithTelemetry } from './services/telemetry/tauriInvokeTelemetry';
import {
  recordStartupMemoryCheckpoint,
  setStartupMemoryTraceFlag,
} from './modules/startup/startupMemoryTrace';
import './App.css';

let coverDecodeReporter: ((src: string, width: number, height: number) => void) | null = null;
let coverDecodeReporterLoading: Promise<void> | null = null;

const ORNAMENTS_RENDER_OVERLAY_STARTUP_DELAY_MS = 6_000;

type OrnamentsRenderPlan = {
  enabledCount: number;
  behind: boolean;
  above: boolean;
  animatedCount: number;
  totalPlacementAreaPx: number;
  totalSourcePixels: number;
};

function readOrnamentsRenderPlan(): OrnamentsRenderPlan {
  const enabledItems = readOrnamentsConfig().items.filter((item) => item.enabled);
  return enabledItems.reduce<OrnamentsRenderPlan>(
    (plan, item) => {
      if (item.layer.plane === -1) {
        plan.behind = true;
      } else {
        plan.above = true;
      }
      plan.enabledCount += 1;
      if (item.media.animated) plan.animatedCount += 1;
      plan.totalPlacementAreaPx += Math.max(0, item.placement.width * item.placement.height);
      plan.totalSourcePixels += Math.max(0, item.media.sourceWidth * item.media.sourceHeight);
      return plan;
    },
    {
      enabledCount: 0,
      behind: false,
      above: false,
      animatedCount: 0,
      totalPlacementAreaPx: 0,
      totalSourcePixels: 0,
    }
  );
}

function reportCoverDecoded(src: string, width: number, height: number): void {
  if (coverDecodeReporter) {
    coverDecodeReporter(src, width, height);
    return;
  }

  if (!coverDecodeReporterLoading) {
    coverDecodeReporterLoading = import('./services/audio/MusicLibraryService')
      .then(({ musicLibraryService }) => {
        coverDecodeReporter = (reportSrc, reportWidth, reportHeight) => {
          musicLibraryService.reportCoverDecoded(reportSrc, reportWidth, reportHeight);
        };
      })
      .catch(() => {
        coverDecodeReporter = () => {};
      })
      .finally(() => {
        coverDecodeReporterLoading = null;
      });
  }

  void coverDecodeReporterLoading.then(() => {
    coverDecodeReporter?.(src, width, height);
  });
}

function AppContent() {
  const kernel = useKernel();
  const telemetry = useMemo(() => getTelemetryLogger('startup', 'AppContent'), []);
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const keybindings = kernel.services.get(KEYBINDINGS_SERVICE_TOKEN);
  const installedExtensionRuntimeManager = kernel.services.getOptional(
    INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN
  );
  const runtimeCapsuleManager = kernel.services.getOptional(
    RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
  ) as RuntimeCapsuleManagerService | null;
  const { navigateTo } = useNavigation();
  const { editorState } = useEditor();

  const [isMainWindowVisible, setIsMainWindowVisible] = useState(true);
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isMainWindowFocused, setIsMainWindowFocused] = useState(() => document.hasFocus());
  const [isEditorAuxWindowFocused, setIsEditorAuxWindowFocused] = useState(false);
  const [isMainWindowMinimized, setIsMainWindowMinimized] = useState(false);
  const [isPageFrozen, setIsPageFrozen] = useState(false);
  const { service: performanceControlService, settings: performanceSettings } =
    usePerformanceControlSettings();
  const isWindowActive =
    isMainWindowVisible &&
    isDocumentVisible &&
    !isMainWindowMinimized &&
    !isPageFrozen &&
    isMainWindowFocused;
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const shouldPollEditorAuxFocus = shouldPollEditorAuxWindowFocus({
    isTauri,
    isEditing: editorState.isEditing,
    isMainWindowFocused,
    isMainWindowVisible,
    isDocumentVisible,
    isMainWindowMinimized,
    isPageFrozen,
  });

  useEffect(() => {
    void performanceControlService.syncEditorEffectsFromSettings();
  }, [performanceControlService, performanceSettings.editorLowPerformanceMode]);

  useEffect(() => {
    if (!isTauri || !isWindowActive) return;
    let cancelled = false;
    let syncFrame: number | null = null;
    let syncInFlight = false;
    let syncQueued = false;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let ornamentsOverlayLeaseId: string | null = null;

    const releaseOrnamentsOverlayLease = (detail: string) => {
      if (!ornamentsOverlayLeaseId || !runtimeCapsuleManager) return;
      runtimeCapsuleManager.releaseLease(ornamentsOverlayLeaseId, {
        kind: 'lease-expired',
        detail,
      });
      ornamentsOverlayLeaseId = null;
    };

    const acquireOrnamentsOverlayLease = (plan: OrnamentsRenderPlan) => {
      if (!runtimeCapsuleManager) return;
      releaseOrnamentsOverlayLease('ornaments overlay plan refreshed');
      const lease = runtimeCapsuleManager.acquireLease({
        capabilityId: 'ornaments.render-overlay',
        ownerKind: 'window',
        ownerId: 'ornaments-render-overlay',
        priority: plan.animatedCount > 0 ? 'normal' : 'background',
        reason: {
          routeId: 'ornaments-render-overlay',
          detail: `ornaments overlay requested for ${plan.enabledCount} enabled item(s)`,
        },
      });
      ornamentsOverlayLeaseId = lease?.id ?? null;
    };

    const runGeometrySync = () => {
      if (cancelled) return;
      if (syncInFlight) {
        syncQueued = true;
        return;
      }

      syncInFlight = true;
      void invoke('ornaments_overlay_sync_geometry')
        .catch(() => {
          // High-frequency window geometry sync intentionally bypasses invoke telemetry.
        })
        .finally(() => {
          syncInFlight = false;
          if (cancelled || !syncQueued) return;
          syncQueued = false;
          scheduleGeometrySync();
        });
    };

    const scheduleGeometrySync = () => {
      if (cancelled) return;
      if (syncFrame !== null) return;
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = null;
        runGeometrySync();
      });
    };

    const detachGeometryListeners = () => {
      if (unlistenMove) {
        unlistenMove();
        unlistenMove = null;
      }
      if (unlistenResize) {
        unlistenResize();
        unlistenResize = null;
      }
    };

    const attachGeometryListeners = async () => {
      try {
        detachGeometryListeners();
        const [moveCleanup, resizeCleanup] = await Promise.all([
          appWindow.onMoved(scheduleGeometrySync),
          appWindow.onResized(scheduleGeometrySync),
        ]);

        if (cancelled) {
          moveCleanup();
          resizeCleanup();
          return;
        }

        unlistenMove = moveCleanup;
        unlistenResize = resizeCleanup;
      } catch {
        // best-effort: ornaments overlays should not block main window interaction
      }
    };

    const openRenderOverlays = () => {
      const plan = readOrnamentsRenderPlan();
      if (plan.enabledCount === 0) {
        telemetry.info('ornaments.render-overlay.skip-empty');
        releaseOrnamentsOverlayLease('ornaments overlay plan is empty');
        detachGeometryListeners();
        void invokeWithTelemetry('ornaments_render_overlay_sync_planes', {
          behind: false,
          above: false,
        }, {
          moduleId: 'ornaments',
          component: 'AppContent',
          event: 'ornaments.render-overlay.sync-empty',
          successLevel: 'info',
        }).catch(() => {
          // best-effort: disabled ornaments should not block main window boot
        });
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (cancelled) return;

          setStartupMemoryTraceFlag('ornamentsOverlayRequested');
          recordStartupMemoryCheckpoint('ornaments.overlay.open.requested', {
            fields: {
              enabledCount: plan.enabledCount,
              behind: plan.behind,
              above: plan.above,
              animatedCount: plan.animatedCount,
              totalPlacementAreaPx: plan.totalPlacementAreaPx,
              totalSourcePixels: plan.totalSourcePixels,
            },
          });
          void invokeWithTelemetry('ornaments_render_overlay_sync_planes', {
            behind: plan.behind,
            above: plan.above,
          }, {
            moduleId: 'ornaments',
            component: 'AppContent',
            event: 'ornaments.render-overlay.sync-planes',
            successLevel: 'info',
          })
            .then(() => {
              if (cancelled) return;
              setStartupMemoryTraceFlag('ornamentsOverlayOpened');
              recordStartupMemoryCheckpoint('ornaments.overlay.opened', {
                fields: {
                  enabledCount: plan.enabledCount,
                  behind: plan.behind,
                  above: plan.above,
                  animatedCount: plan.animatedCount,
                  totalPlacementAreaPx: plan.totalPlacementAreaPx,
                  totalSourcePixels: plan.totalSourcePixels,
                },
              });
              acquireOrnamentsOverlayLease(plan);
              scheduleGeometrySync();
              void attachGeometryListeners();
            })
            .catch(() => {
              // best-effort: ornaments overlays should never block main window boot
            });
        });
      });
    };

    const cleanupStartupIdle = onStartupIdle(openRenderOverlays, {
      delayMs: ORNAMENTS_RENDER_OVERLAY_STARTUP_DELAY_MS,
      timeoutMs: 2_000,
    });
    let cleanupOrnamentsUpdated: (() => void) | null = null;
    const cleanupOrnamentsUpdatedPromise = setupTauriListener(TAURI_EVENTS.ORNAMENTS_UPDATED, () => {
      if (!cancelled) openRenderOverlays();
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return null;
        }
        cleanupOrnamentsUpdated = cleanup;
        return cleanup;
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      cleanupStartupIdle();
      if (cleanupOrnamentsUpdated) cleanupOrnamentsUpdated();
      void cleanupOrnamentsUpdatedPromise.then((cleanup) => {
        if (cleanup && cleanup !== cleanupOrnamentsUpdated) cleanup();
      });
      if (syncFrame !== null) {
        window.cancelAnimationFrame(syncFrame);
      }
      detachGeometryListeners();
      releaseOrnamentsOverlayLease('ornaments overlay app content cleanup');
    };
  }, [isTauri, isWindowActive, runtimeCapsuleManager, telemetry]);

  useEffect(() => {
    const handler = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (target.naturalWidth <= 0 || target.naturalHeight <= 0) return;

      const parent = target.closest(
        '.music-library-album-cover, .album-cover-large, .card-cover, .track-cover-image'
      );
      if (!parent) return;

      const src = target.currentSrc || target.src;
      if (!src) return;
      reportCoverDecoded(src, target.naturalWidth, target.naturalHeight);
    };

    document.addEventListener('load', handler, true);
    return () => document.removeEventListener('load', handler, true);
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;
    void getDebugConfig()
      .then(async (config) => {
        if (cancelled) return;
        if (!config.openDebugCenterOnNextStart) return;

        await dispatchCommandOrFallback(commands, 'app:navigate-debug-center', () =>
          navigateTo('debug', { tab: 'debug-center' })
        );
        void setDebugConfig({ ...config, openDebugCenterOnNextStart: false }).catch((error) => {
          telemetry.warn('startup.debug-center.flag-clear.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      })
      .catch(() => {
        // best-effort: debug center should not block app boot
      });

    return () => {
      cancelled = true;
    };
  }, [commands, isTauri, navigateTo, telemetry]);

  useEffect(() => {
    if (!shouldRunDurableStorageMigrations()) {
      return;
    }

    const run = async () => {
      try {
        let pmps: { migrated: number; failed: number; skipped?: boolean } | null = null;

        if (shouldRunPmpsDurableMigration()) {
          const { migrateInstalledPmpsShaderPacksToDurableStorage } = await import(
            './shader-system/pmps'
          );
          pmps = await migrateInstalledPmpsShaderPacksToDurableStorage();
        }

        if (pmps && (pmps.migrated || pmps.failed)) {
          telemetry.info('storage.migration.result', {
            fields: { pmps },
          });
        }
      } catch {
        // best-effort: migration should not block app boot
      }
    };

    const requestIdleCallback = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
      }
    ).requestIdleCallback;
    if (requestIdleCallback) {
      requestIdleCallback(() => void run(), { timeout: 1500 });
      return;
    }

    const timer = window.setTimeout(() => void run(), 800);
    return () => window.clearTimeout(timer);
  }, [telemetry]);

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const onFreeze = () => setIsPageFrozen(true);
    const onResume = () => setIsPageFrozen(false);

    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
    return () => {
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onResume);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let blurTimer: number | null = null;
    let unlisten: (() => void) | null = null;

    const applyFocus = (focused: boolean) => {
      if (blurTimer !== null) {
        window.clearTimeout(blurTimer);
        blurTimer = null;
      }

      if (focused) {
        setIsMainWindowFocused(true);
        return;
      }

      // Debounce blur: some platforms briefly drop focus while spawning child windows or dragging.
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        if (!disposed) setIsMainWindowFocused(false);
      }, 160);
    };

    const setup = async () => {
      if (isTauri) {
        try {
          const initialFocused = await appWindow.isFocused().catch(() => document.hasFocus());
          applyFocus(initialFocused);
          unlisten = await appWindow.onFocusChanged(({ payload: focused }) => {
            applyFocus(focused);
          });
          return;
        } catch (error) {
          telemetry.warn('window.main.focus-listener.attach.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const onFocus = () => applyFocus(true);
      const onBlur = () => applyFocus(false);
      applyFocus(document.hasFocus());
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      unlisten = () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    };

    void setup();

    return () => {
      disposed = true;
      if (blurTimer !== null) window.clearTimeout(blurTimer);
      if (unlisten) unlisten();
    };
  }, [isTauri, telemetry]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;
    let unlistenResize: (() => void) | null = null;
    let pollTimer: number | null = null;
    let lastMinimized: boolean | null = null;

    const refresh = async () => {
      try {
        const minimized = await appWindow.isMinimized();
        if (disposed) return;
        if (lastMinimized === minimized) return;
        lastMinimized = minimized;
        setIsMainWindowMinimized(minimized);
      } catch {
        // ignore
      }
    };

    const setup = async () => {
      await refresh();

      try {
        unlistenResize = await appWindow.onResized(() => {
          void refresh();
        });
      } catch {
        // ignore
      }

      pollTimer = window.setInterval(() => {
        if (document.hidden || !document.hasFocus()) {
          void refresh();
        }
      }, 2000);
    };

    void setup();

    return () => {
      disposed = true;
      if (unlistenResize) unlistenResize();
      if (pollTimer !== null) window.clearInterval(pollTimer);
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || !installedExtensionRuntimeManager) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    const attach = async () => {
      try {
        const cleanup = await appWindow.onFileDropEvent((event) => {
          if (event.payload.type !== 'drop') {
            return;
          }

          void activateInstalledExtensionsForHostFiles(installedExtensionRuntimeManager, {
            filePaths: event.payload.paths,
            action: 'window-dropped',
            hostLabel: 'AppWindowFileDrop',
          }).catch((error) => {
            telemetry.warn('startup.file-drop-activation.failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          });
        });

        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
      } catch (error) {
        telemetry.warn('startup.file-drop-listener.attach.failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void attach();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [installedExtensionRuntimeManager, isTauri, telemetry]);

  useEffect(() => {
    if (!isTauri || !installedExtensionRuntimeManager) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let pendingFlush = Promise.resolve();

    const scheduleFlush = () => {
      pendingFlush = pendingFlush
        .then(async () => {
          const payloads = await consumePendingHostFileOpens();
          if (disposed || payloads.length === 0) {
            return;
          }

          await activateInstalledExtensionsForNativeHostFileOpens(
            installedExtensionRuntimeManager,
            payloads
          );
        })
        .catch((error) => {
          telemetry.warn('startup.host-file-open.consume.failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const attach = async () => {
      const cleanup = await setupTauriListener(TAURI_EVENTS.HOST_FILE_OPENED, () => {
        scheduleFlush();
      });
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    };

    scheduleFlush();
    void attach();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [installedExtensionRuntimeManager, isTauri, telemetry]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const handled = keybindings.handleKeyboardEvent(e);
      if (handled) {
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [keybindings]);

  useEffect(() => {
    const unsubscribeToggle = kernel.events.on('ui/commandPaletteToggleRequested', () => {
      setCommandPaletteOpen((value) => !value);
    });
    const unsubscribeClose = kernel.events.on('ui/commandPaletteCloseRequested', () => {
      setCommandPaletteOpen(false);
    });
    return () => {
      unsubscribeToggle();
      unsubscribeClose();
    };
  }, [kernel.events]);

  useEffect(() => {
    if (!isTauri) return;

    const init = async () => {
      try {
        setIsMainWindowVisible(await appWindow.isVisible());
      } catch {
        // ignore
      }

      const unlistenHidden = await setupTauriListener(TAURI_EVENTS.MAIN_WINDOW_HIDDEN, () => {
        setIsMainWindowVisible(false);
      });
      const unlistenShown = await setupTauriListener(TAURI_EVENTS.MAIN_WINDOW_SHOWN, () => {
        setIsMainWindowVisible(true);
      });

      return () => {
        unlistenHidden();
        unlistenShown();
      };
    };

    const cleanupPromise = init();
    return () => {
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri, telemetry]);

  useEffect(() => {
    if (!isTauri) return;

    let disposed = false;

    const syncAndApplyPinPolicy = async () => {
      const preferredPinned = readWindowPinState();
      if (typeof preferredPinned === 'boolean') {
        await applyWindowPinPolicy();
        return;
      }

      try {
        const resolvedPinned = await (
          (
            appWindow as typeof appWindow & {
              isAlwaysOnTop?: () => Promise<boolean>;
            }
          ).isAlwaysOnTop?.() ?? Promise.resolve(false)
        ).catch(() => false);
        if (disposed) return;
        writeWindowPinState(Boolean(resolvedPinned));
        await applyWindowPinPolicy();
      } catch {
        // best-effort: pin state sync is non-critical
      }
    };

    void syncAndApplyPinPolicy();

    const cleanupPromise = setupConfigSync(
      [STORAGE_KEYS.WINDOW_PIN_STATE],
      [TAURI_EVENTS.WINDOW_PIN_STATE_UPDATED],
      () => {
        void syncAndApplyPinPolicy();
      }
    );

    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup());
    };
  }, [isTauri]);

  useEffect(() => {
    if (!shouldPollEditorAuxFocus) {
      setIsEditorAuxWindowFocused(false);
      return;
    }

    let disposed = false;
    let pollTimer: number | null = null;

    const refreshEditorWindowFocus = async () => {
      try {
        const focused = await hasFocusedVisibleEditorWindow(getAll());
        if (!disposed) {
          setIsEditorAuxWindowFocused(focused);
        }
      } catch {
        if (!disposed) {
          setIsEditorAuxWindowFocused(false);
        }
      }
    };

    void refreshEditorWindowFocus();
    pollTimer = window.setInterval(() => {
      void refreshEditorWindowFocus();
    }, 200);

    return () => {
      disposed = true;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [shouldPollEditorAuxFocus]);

  const isRenderFocusActive = isMainWindowFocused || isEditorAuxWindowFocused;

  const renderMode = useAdaptiveRenderMode({
    isWindowVisible: isMainWindowVisible,
    isDocumentVisible,
    // Keep the main matrix responsive while an auxiliary editor window owns focus.
    isWindowFocused: isRenderFocusActive,
    isWindowMinimized: isMainWindowMinimized,
    isPageFrozen,
    backgroundRenderPolicy: performanceSettings.backgroundRenderPolicy,
  });

  return (
    <WindowActivityProvider
      value={{ isVisible: isMainWindowVisible, isActive: isWindowActive, renderMode }}
    >
      <QualityProvider>
        <div className="app-container">
          <MatrixWorkbench showEditorOverlay showEditorPanel showWindowBorder />
        </div>

        <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      </QualityProvider>
    </WindowActivityProvider>
  );
}

function App() {
  const kernel = useKernel();
  const lifecycle = kernel.services.get(APP_LIFECYCLE_SERVICE_TOKEN);
  const spaceRuntimeGovernance = kernel.services.getOptional(
    SPACE_RUNTIME_GOVERNANCE_SERVICE_TOKEN
  ) as SpaceRuntimeGovernanceService | null;
  const runtimeCapsuleManager = kernel.services.getOptional(
    RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
  ) as RuntimeCapsuleManagerService | null;
  const registerFlushHandler = useCallback(
    (handler: () => void) => lifecycle.registerFlushHandler(() => handler()),
    [lifecycle]
  );

  // 从 localStorage 加载保存的配置以获取正确的 magnet 位置
  // 注意：magnetsForContext 仅用于 EditorProvider 的初始化
  // 后续更新通过 AppContent 内部的 updateOccupancy 方法进行
  const [magnetsForContext] = useState<Magnet[]>(() => {
    const defaultLibrary = createDefaultMagnetLibrary();
    const initial = createInitialMagnetState(defaultLibrary);
    return initial.magnetLibrary.filter((magnet) => initial.activeMagnetIds.has(magnet.id));
  });

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <EditorProvider magnets={magnetsForContext}>
          <NavigationProvider>
            <MagnetLibraryProvider
              gridSize={{ columns: MATRIX_CONFIG.COLUMNS, rows: MATRIX_CONFIG.ROWS }}
              registerFlushHandler={registerFlushHandler}
              spaceRuntimeGovernance={spaceRuntimeGovernance}
              runtimeCapsuleManager={runtimeCapsuleManager}
            >
              <WindowCloseProvider>
                <AppContent />
              </WindowCloseProvider>
            </MagnetLibraryProvider>
          </NavigationProvider>
        </EditorProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}

export default App;
