import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import { useT } from '../../../i18n';
import {
  beginPlatformQrLogin,
  getPlatformConnectorAuthSnapshot,
  listPlatformConnectorAuthSnapshots,
  listPlatformConnectorDefinitions,
  logoutPlatformConnector,
  pollPlatformQrLogin,
  refreshAndEmitPlatformConnectorAuthSnapshot,
  subscribePlatformConnectorAuthChanged,
  type PlatformConnectorAuthSnapshot,
  type PlatformConnectorDefinition,
  type PlatformQrLoginPollResult,
  type PlatformQrLoginSession,
} from '../../../modules/music-platform';
import { useResolvedMagnetSkinRenderer } from '../shared/useResolvedMagnetSkinRenderer';
import { buildMagnetVariantRenderers } from '../shared/magnetVariantCatalog';
import {
  PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS,
  PLATFORM_LOGIN_VARIANT_PRESETS,
  parsePlatformLoginSkinProps,
} from './platformLoginSkin';
import './PlatformLoginButton.css';
const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili' as const;

type PlatformSelectorItem = {
  id: string;
  labelKey: string;
  enabled: boolean;
  icon: React.ReactNode;
};

function BilibiliBrandIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373Z"
      />
    </svg>
  );
}

function toAuthLabelKey(authState: string): string {
  const normalized = authState.trim().toLowerCase();
  switch (normalized) {
    case 'pending':
    case 'authorized':
    case 'expired':
    case 'revoked':
    case 'error':
      return `magnet.platform-login.auth.${normalized}`;
    default:
      return 'magnet.platform-login.auth.unauthorized';
  }
}

function toAvailabilityLabelKey(availability: string): string {
  const normalized = availability.trim().toLowerCase();
  switch (normalized) {
    case 'available':
    case 'degraded':
    case 'unavailable':
      return `magnet.platform-login.availability.${normalized}`;
    default:
      return 'magnet.platform-login.availability.unknown';
  }
}

function isTerminalPollState(result: PlatformQrLoginPollResult | null): boolean {
  if (!result) return false;
  const normalized = result.state.trim().toLowerCase();
  return normalized === 'authorized' || normalized === 'expired' || normalized === 'failed';
}

function getConnectorMonogram(definition: PlatformConnectorDefinition): string {
  const normalizedId = definition.connectorId.replace(/^connector\.platform\./i, '').trim();
  if (!normalizedId) return 'P';
  return normalizedId[0]?.toUpperCase() ?? 'P';
}

function renderConnectorIcon(definition: PlatformConnectorDefinition): React.ReactNode {
  if (definition.connectorId === BILIBILI_CONNECTOR_ID || definition.iconKey === 'bilibili') {
    return <BilibiliBrandIcon />;
  }
  return <span className="platform-login-placeholder-icon">{getConnectorMonogram(definition)}</span>;
}

function buildPlatformSelectorItems(): PlatformSelectorItem[] {
  return listPlatformConnectorDefinitions().map((definition) => ({
    id: definition.connectorId,
    labelKey: definition.labelKey,
    enabled: definition.enabled && definition.authFlow === 'qr',
    icon: renderConnectorIcon(definition),
  }));
}

function resolvePlatformSelectorId(
  requestedConnectorId: string | undefined,
  items: PlatformSelectorItem[]
): string | null {
  if (items.length === 0) return null;
  if (!requestedConnectorId) {
    return items.find((item) => item.id === BILIBILI_CONNECTOR_ID)?.id ?? items[0]?.id ?? null;
  }

  const normalizedRequested = requestedConnectorId.trim().toLowerCase();
  const exactMatch =
    items.find((item) => item.id.trim().toLowerCase() === normalizedRequested)?.id ??
    items.find((item) => item.id.trim().toLowerCase().endsWith(`.${normalizedRequested}`))?.id;

  return exactMatch ?? items.find((item) => item.id === BILIBILI_CONNECTOR_ID)?.id ?? items[0]?.id ?? null;
}

function updateConnectorScopedValue<TRecord extends Record<string, unknown>>(
  setter: React.Dispatch<React.SetStateAction<TRecord>>,
  connectorId: string,
  value: TRecord[string]
): void {
  setter((prev) => ({
    ...prev,
    [connectorId]: value,
  } as TRecord));
}

type PlatformLoginButtonRendererProps = {
  skinProps?: Record<string, unknown>;
};

const PlatformLoginButtonDefaultRenderer: React.FC<PlatformLoginButtonRendererProps> = ({ skinProps: rawSkinProps }) => {
  const skinProps = useMemo(() => parsePlatformLoginSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [authPopupOpen, setAuthPopupOpen] = useState(false);
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [authSnapshotsByConnectorId, setAuthSnapshotsByConnectorId] = useState<
    Record<string, PlatformConnectorAuthSnapshot | null>
  >({});
  const [qrSessionsByConnectorId, setQrSessionsByConnectorId] = useState<
    Record<string, PlatformQrLoginSession | null>
  >({});
  const [pollResultsByConnectorId, setPollResultsByConnectorId] = useState<
    Record<string, PlatformQrLoginPollResult | null>
  >({});
  const [errorsByConnectorId, setErrorsByConnectorId] = useState<Record<string, string | null>>({});
  const [statusMessagesByConnectorId, setStatusMessagesByConnectorId] = useState<
    Record<string, string | null>
  >({});

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const selectorPopupRef = useRef<HTMLDivElement | null>(null);
  const authPopupRef = useRef<HTMLDivElement | null>(null);

  const platformItems = useMemo<PlatformSelectorItem[]>(() => buildPlatformSelectorItems(), []);
  const preferredPlatformId = useMemo(
    () => resolvePlatformSelectorId(skinProps.defaultConnectorId, platformItems),
    [platformItems, skinProps.defaultConnectorId]
  );

  useEffect(() => {
    setSelectedPlatformId(preferredPlatformId);
  }, [preferredPlatformId]);

  const selectedPlatformItem = useMemo(
    () =>
      platformItems.find((item) => item.id === selectedPlatformId) ??
      platformItems.find((item) => item.id === preferredPlatformId) ??
      platformItems.find((item) => item.id === BILIBILI_CONNECTOR_ID) ??
      platformItems[0] ??
      null,
    [platformItems, preferredPlatformId, selectedPlatformId]
  );

  const activeConnectorId = selectedPlatformItem?.id ?? null;
  const activeAuthSnapshot =
    (activeConnectorId ? authSnapshotsByConnectorId[activeConnectorId] : null) ?? null;
  const activeQrSession = (activeConnectorId ? qrSessionsByConnectorId[activeConnectorId] : null) ?? null;
  const activePollResult =
    (activeConnectorId ? pollResultsByConnectorId[activeConnectorId] : null) ?? null;
  const activeError = (activeConnectorId ? errorsByConnectorId[activeConnectorId] : null) ?? null;
  const activeStatusMessage =
    (activeConnectorId ? statusMessagesByConnectorId[activeConnectorId] : null) ?? null;

  const authPopupVisible = selectorOpen && authPopupOpen && Boolean(selectedPlatformItem?.enabled);

  const refreshAuthSnapshot = useCallback(async (connectorId: string) => {
    const snapshot = await getPlatformConnectorAuthSnapshot(connectorId);
    updateConnectorScopedValue(setAuthSnapshotsByConnectorId, connectorId, snapshot);
  }, []);

  const refreshAllAuthSnapshots = useCallback(async () => {
    const snapshots = await listPlatformConnectorAuthSnapshots();
    setAuthSnapshotsByConnectorId((prev) => {
      const next = { ...prev };
      for (const snapshot of snapshots) {
        next[snapshot.connectorId] = snapshot;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void refreshAllAuthSnapshots();

    const unsubscribe = subscribePlatformConnectorAuthChanged((snapshot) => {
      updateConnectorScopedValue(setAuthSnapshotsByConnectorId, snapshot.connectorId, snapshot);
    });

    return () => {
      unsubscribe();
    };
  }, [refreshAllAuthSnapshots]);

  useEffect(() => {
    if (!activeConnectorId) return;
    if (authSnapshotsByConnectorId[activeConnectorId] !== undefined) return;
    void refreshAuthSnapshot(activeConnectorId);
  }, [activeConnectorId, authSnapshotsByConnectorId, refreshAuthSnapshot]);

  useEffect(() => {
    if (!selectorOpen && !authPopupVisible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (selectorPopupRef.current?.contains(target)) return;
      if (authPopupRef.current?.contains(target)) return;

      setSelectorOpen(false);
      setAuthPopupOpen(false);
      setSelectedPlatformId(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (authPopupVisible) {
        setAuthPopupOpen(false);
        return;
      }
      setSelectorOpen(false);
      setSelectedPlatformId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [authPopupVisible, selectorOpen]);

  const runPoll = useCallback(
    async (sessionId?: string, connectorId?: string) => {
      const targetConnectorId = (connectorId ?? activeConnectorId ?? '').trim();
      if (!targetConnectorId || busy) return;

      const targetSessionId = (
        sessionId ?? qrSessionsByConnectorId[targetConnectorId]?.sessionId ?? ''
      ).trim();
      if (!targetSessionId) return;

      setBusy(true);
      try {
        const result = await pollPlatformQrLogin(targetConnectorId, targetSessionId);
        updateConnectorScopedValue(setPollResultsByConnectorId, targetConnectorId, result);
        updateConnectorScopedValue(setErrorsByConnectorId, targetConnectorId, null);

        if (!result) {
          updateConnectorScopedValue(
            setErrorsByConnectorId,
            targetConnectorId,
            t('magnet.platform-login.error.pollFailed')
          );
          return;
        }

        if (result.authState === 'authorized') {
          updateConnectorScopedValue(
            setStatusMessagesByConnectorId,
            targetConnectorId,
            t('magnet.platform-login.status.authorized', {
              accountUid: result.accountUid ?? '-',
            })
          );
          updateConnectorScopedValue(setQrSessionsByConnectorId, targetConnectorId, null);
        } else if (isTerminalPollState(result)) {
          updateConnectorScopedValue(setQrSessionsByConnectorId, targetConnectorId, null);
          updateConnectorScopedValue(
            setStatusMessagesByConnectorId,
            targetConnectorId,
            t('magnet.platform-login.status.pollState', {
              state: result.state,
              message: result.stateMessage,
            })
          );
        }

        await refreshAndEmitPlatformConnectorAuthSnapshot(targetConnectorId);
      } catch (err) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          targetConnectorId,
          err instanceof Error ? err.message : t('magnet.platform-login.error.pollFailed')
        );
      } finally {
        setBusy(false);
      }
    },
    [activeConnectorId, busy, qrSessionsByConnectorId, t]
  );

  useEffect(() => {
    if (!authPopupVisible) return;
    if (!activeConnectorId) return;
    if (!activeQrSession?.sessionId) return;

    const timer = window.setInterval(() => {
      void runPoll(activeQrSession.sessionId, activeConnectorId);
    }, skinProps.qrAutoPollIntervalMs || PLATFORM_LOGIN_DEFAULT_QR_AUTO_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeConnectorId, activeQrSession?.sessionId, authPopupVisible, runPoll, skinProps.qrAutoPollIntervalMs]);

  const handleToggleSelector = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSelectorOpen((prev) => {
      const next = !prev;
      if (!next) {
        setAuthPopupOpen(false);
        setSelectedPlatformId(null);
        return next;
      }

      const nextPlatformId = preferredPlatformId ?? selectedPlatformItem?.id ?? null;
      setSelectedPlatformId(nextPlatformId);
      const nextPlatformItem = platformItems.find((item) => item.id === nextPlatformId) ?? null;
      setAuthPopupOpen(Boolean(skinProps.openAuthOnTrigger && nextPlatformItem?.enabled));
      return next;
    });
  };

  const handleSelectPlatform = useCallback(
    (item: PlatformSelectorItem) => {
      setSelectedPlatformId(item.id);
      if (!item.enabled) {
        setAuthPopupOpen(false);
        updateConnectorScopedValue(
          setStatusMessagesByConnectorId,
          item.id,
          t('magnet.platform-login.status.comingSoon')
        );
        return;
      }

      updateConnectorScopedValue(setErrorsByConnectorId, item.id, null);
      updateConnectorScopedValue(setStatusMessagesByConnectorId, item.id, null);
      setAuthPopupOpen(true);
    },
    [t]
  );

  const handleGenerateQr = useCallback(async () => {
    const connectorId = (activeConnectorId ?? '').trim();
    if (!connectorId || busy) return;
    setBusy(true);

    try {
      const session = await beginPlatformQrLogin(connectorId);
      if (!session) {
        updateConnectorScopedValue(
          setErrorsByConnectorId,
          connectorId,
          t('magnet.platform-login.error.generateFailed')
        );
        return;
      }

      updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, session);
      updateConnectorScopedValue(setPollResultsByConnectorId, connectorId, null);
      updateConnectorScopedValue(setErrorsByConnectorId, connectorId, null);
      updateConnectorScopedValue(
        setStatusMessagesByConnectorId,
        connectorId,
        t('magnet.platform-login.status.generated')
      );
      await refreshAuthSnapshot(connectorId);
    } catch (err) {
      updateConnectorScopedValue(
        setErrorsByConnectorId,
        connectorId,
        err instanceof Error ? err.message : t('magnet.platform-login.error.generateFailed')
      );
    } finally {
      setBusy(false);
    }
  }, [activeConnectorId, busy, refreshAuthSnapshot, t]);

  const handleLogout = useCallback(async () => {
    const connectorId = (activeConnectorId ?? '').trim();
    if (!connectorId || busy) return;
    setBusy(true);

    try {
      const snapshot = await logoutPlatformConnector(connectorId);
      updateConnectorScopedValue(setAuthSnapshotsByConnectorId, connectorId, snapshot);
      updateConnectorScopedValue(setQrSessionsByConnectorId, connectorId, null);
      updateConnectorScopedValue(setPollResultsByConnectorId, connectorId, null);
      updateConnectorScopedValue(setErrorsByConnectorId, connectorId, null);
      updateConnectorScopedValue(
        setStatusMessagesByConnectorId,
        connectorId,
        t('magnet.platform-login.status.loggedOut')
      );
    } catch (err) {
      updateConnectorScopedValue(
        setErrorsByConnectorId,
        connectorId,
        err instanceof Error ? err.message : t('magnet.platform-login.error.logoutFailed')
      );
    } finally {
      setBusy(false);
    }
  }, [activeConnectorId, busy, t]);

  const selectedPlatformLabelKey = selectedPlatformItem?.labelKey ?? 'magnet.platform-login.platform.bilibili';
  const authStateLabel = useMemo(
    () => t(toAuthLabelKey(activeAuthSnapshot?.authState ?? 'unauthorized')),
    [activeAuthSnapshot?.authState, t]
  );
  const availabilityLabel = useMemo(
    () => t(toAvailabilityLabelKey(activeAuthSnapshot?.availability ?? 'unknown')),
    [activeAuthSnapshot?.availability, t]
  );

  return (
    <>
      <div className="platform-login-magnet" ref={triggerRef}>
        <button
          className="platform-login-trigger"
          title={t('magnet.platform-login.trigger.title')}
          onClick={handleToggleSelector}
        >
          <span className="platform-login-trigger-icon" aria-hidden="true">
            <BilibiliBrandIcon />
          </span>
        </button>
      </div>

      <CollisionAwarePopup
        ref={selectorPopupRef}
        open={selectorOpen}
        anchorRef={triggerRef}
        placement="bottom-start"
        offset={8}
        viewportPadding={10}
        className="platform-login-selector-popup"
        role="dialog"
      >
        {skinProps.showSelectorTitle ? (
          <div className="platform-login-selector-title">
            {t('magnet.platform-login.selector.title')}
          </div>
        ) : null}

        <div className="platform-login-platform-list">
          {platformItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`platform-login-platform-item ${
                selectedPlatformId === item.id ? 'platform-login-platform-item--active' : ''
              }`}
              disabled={!item.enabled}
              onClick={() => handleSelectPlatform(item)}
            >
              <span className="platform-login-platform-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="platform-login-platform-label">{t(item.labelKey)}</span>
            </button>
          ))}
        </div>

        {activeStatusMessage ? <p className="platform-login-status">{activeStatusMessage}</p> : null}
      </CollisionAwarePopup>

      <CollisionAwarePopup
        ref={authPopupRef}
        open={authPopupVisible}
        anchorRef={triggerRef}
        placement="bottom-start"
        offset={10}
        viewportPadding={10}
        className="platform-login-auth-popup"
        role="dialog"
      >
        <div className="platform-login-auth-title">
          {t('magnet.platform-login.popup.title', {
            platform: t(selectedPlatformLabelKey),
          })}
        </div>

        <p className="platform-login-auth-line">
          {t('magnet.platform-login.auth.line', {
            state: authStateLabel,
            accountUid: activeAuthSnapshot?.accountUid ?? '-',
          })}
        </p>
        <p className="platform-login-auth-line">
          {t('magnet.platform-login.availability.line', {
            availability: availabilityLabel,
            message: activeAuthSnapshot?.availabilityMessage ?? t('magnet.platform-login.availability.none'),
          })}
        </p>

        <div className="platform-login-actions">
          <button type="button" onClick={() => void handleGenerateQr()} disabled={busy}>
            {t('magnet.platform-login.action.generate')}
          </button>
          <button
            type="button"
            onClick={() => {
              void runPoll();
            }}
            disabled={busy || !activeQrSession}
          >
            {t('magnet.platform-login.action.poll')}
          </button>
          <button type="button" onClick={() => void handleLogout()} disabled={busy}>
            {t('magnet.platform-login.action.logout')}
          </button>
        </div>

        {activeQrSession ? (
          <div className="platform-login-qr-card">
            <img
              src={activeQrSession.qrImageDataUrl}
              alt={t('magnet.platform-login.qr.alt')}
              className="platform-login-qr-image"
            />
            <p className="platform-login-qr-hint">{t('magnet.platform-login.qr.hint')}</p>
            <p className="platform-login-qr-expire">
              {t('magnet.platform-login.qr.expiresAt', {
                expiresAt: new Date(activeQrSession.expiresAtMs).toLocaleString(),
              })}
            </p>
          </div>
        ) : (
          <p className="platform-login-empty">{t('magnet.platform-login.qr.empty')}</p>
        )}

        {activePollResult ? (
          <p className="platform-login-poll-result">
            {t('magnet.platform-login.status.pollState', {
              state: activePollResult.state,
              message: activePollResult.stateMessage,
            })}
          </p>
        ) : null}

        {activeError ? <p className="platform-login-error">{activeError}</p> : null}
      </CollisionAwarePopup>
    </>
  );
};

const PLATFORM_LOGIN_RENDERERS = {
  ...buildMagnetVariantRenderers(PlatformLoginButtonDefaultRenderer, PLATFORM_LOGIN_VARIANT_PRESETS),
} satisfies Record<string, React.ComponentType<PlatformLoginButtonRendererProps>>;

export const PlatformLoginButton: React.FC = () => {
  const { skin, Renderer } = useResolvedMagnetSkinRenderer('btn-platform-login', PLATFORM_LOGIN_RENDERERS, {
    defaultRendererId: 'default',
    defaultVariant: 'default',
  });

  return <Renderer skinProps={skin.props} />;
};
