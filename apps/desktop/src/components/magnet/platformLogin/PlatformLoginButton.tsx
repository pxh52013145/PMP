import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import { useT } from '../../../i18n';
import {
  beginBilibiliQrLogin,
  getBilibiliConnectorAuthSnapshot,
  logoutBilibiliConnector,
  pollBilibiliQrLogin,
  refreshAndEmitBilibiliConnectorAuthSnapshot,
  subscribePlatformConnectorAuthChanged,
  type BilibiliQrLoginPollResult,
  type BilibiliQrLoginSession,
  type PlatformConnectorAuthSnapshot,
} from '../../../modules/music-platform';
import './PlatformLoginButton.css';

const QR_AUTO_POLL_INTERVAL_MS = 1_800;
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

function isTerminalPollState(result: BilibiliQrLoginPollResult | null): boolean {
  if (!result) return false;
  const normalized = result.state.trim().toLowerCase();
  return normalized === 'authorized' || normalized === 'expired' || normalized === 'failed';
}

export const PlatformLoginButton: React.FC = () => {
  const t = useT();

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [authPopupOpen, setAuthPopupOpen] = useState(false);
  const [selectedPlatformId, setSelectedPlatformId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authSnapshot, setAuthSnapshot] = useState<PlatformConnectorAuthSnapshot | null>(null);
  const [qrSession, setQrSession] = useState<BilibiliQrLoginSession | null>(null);
  const [pollResult, setPollResult] = useState<BilibiliQrLoginPollResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const selectorPopupRef = useRef<HTMLDivElement | null>(null);
  const authPopupRef = useRef<HTMLDivElement | null>(null);
  const bilibiliIconButtonRef = useRef<HTMLButtonElement | null>(null);

  const platformItems = useMemo<PlatformSelectorItem[]>(
    () => [
      {
        id: BILIBILI_CONNECTOR_ID,
        labelKey: 'magnet.platform-login.platform.bilibili',
        enabled: true,
        icon: <BilibiliBrandIcon />,
      },
      {
        id: 'connector.platform.netease',
        labelKey: 'magnet.platform-login.platform.netease',
        enabled: false,
        icon: <span className="platform-login-placeholder-icon">N</span>,
      },
      {
        id: 'connector.platform.qqmusic',
        labelKey: 'magnet.platform-login.platform.qqmusic',
        enabled: false,
        icon: <span className="platform-login-placeholder-icon">Q</span>,
      },
    ],
    []
  );

  const bilibiliAuthPopupVisible =
    selectorOpen && authPopupOpen && selectedPlatformId === BILIBILI_CONNECTOR_ID;

  const refreshAuthSnapshot = useCallback(async () => {
    const snapshot = await getBilibiliConnectorAuthSnapshot();
    setAuthSnapshot(snapshot);
  }, []);

  useEffect(() => {
    void refreshAuthSnapshot();

    const unsubscribe = subscribePlatformConnectorAuthChanged((snapshot) => {
      if (snapshot.connectorId !== BILIBILI_CONNECTOR_ID) return;
      setAuthSnapshot(snapshot);
    });

    return () => {
      unsubscribe();
    };
  }, [refreshAuthSnapshot]);

  useEffect(() => {
    if (!selectorOpen && !bilibiliAuthPopupVisible) return;

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
      if (bilibiliAuthPopupVisible) {
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
  }, [bilibiliAuthPopupVisible, selectorOpen]);

  const runPoll = useCallback(
    async (sessionId?: string) => {
      const targetSessionId = (sessionId ?? qrSession?.sessionId ?? '').trim();
      if (!targetSessionId || busy) return;

      setBusy(true);
      try {
        const result = await pollBilibiliQrLogin(targetSessionId);
        setPollResult(result);
        setError(null);

        if (!result) {
          setError(t('magnet.platform-login.error.pollFailed'));
          return;
        }

        if (result.authState === 'authorized') {
          setStatusMessage(
            t('magnet.platform-login.status.authorized', {
              accountUid: result.accountUid ?? '-',
            })
          );
          setQrSession(null);
        } else if (isTerminalPollState(result)) {
          setQrSession(null);
          setStatusMessage(
            t('magnet.platform-login.status.pollState', {
              state: result.state,
              message: result.stateMessage,
            })
          );
        }

        await refreshAndEmitBilibiliConnectorAuthSnapshot();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('magnet.platform-login.error.pollFailed'));
      } finally {
        setBusy(false);
      }
    },
    [busy, qrSession?.sessionId, t]
  );

  useEffect(() => {
    if (!bilibiliAuthPopupVisible) return;
    if (!qrSession?.sessionId) return;

    const timer = window.setInterval(() => {
      void runPoll(qrSession.sessionId);
    }, QR_AUTO_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [bilibiliAuthPopupVisible, qrSession?.sessionId, runPoll]);

  const handleToggleSelector = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSelectorOpen((prev) => {
      const next = !prev;
      if (!next) {
        setAuthPopupOpen(false);
        setSelectedPlatformId(null);
      }
      return next;
    });
  };

  const handleSelectPlatform = useCallback(
    (platformId: string, enabled: boolean) => {
      setSelectedPlatformId(platformId);
      if (!enabled) {
        setAuthPopupOpen(false);
        setStatusMessage(t('magnet.platform-login.status.comingSoon'));
        return;
      }

      setError(null);
      setStatusMessage(null);
      setAuthPopupOpen(true);
    },
    [t]
  );

  const handleGenerateQr = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    try {
      const session = await beginBilibiliQrLogin();
      if (!session) {
        setError(t('magnet.platform-login.error.generateFailed'));
        return;
      }

      setQrSession(session);
      setPollResult(null);
      setError(null);
      setStatusMessage(t('magnet.platform-login.status.generated'));
      await refreshAuthSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('magnet.platform-login.error.generateFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, refreshAuthSnapshot, t]);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy(true);

    try {
      const snapshot = await logoutBilibiliConnector();
      setAuthSnapshot(snapshot);
      setQrSession(null);
      setPollResult(null);
      setError(null);
      setStatusMessage(t('magnet.platform-login.status.loggedOut'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('magnet.platform-login.error.logoutFailed'));
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  const authStateLabel = useMemo(
    () => t(toAuthLabelKey(authSnapshot?.authState ?? 'unauthorized')),
    [authSnapshot?.authState, t]
  );
  const availabilityLabel = useMemo(
    () => t(toAvailabilityLabelKey(authSnapshot?.availability ?? 'unknown')),
    [authSnapshot?.availability, t]
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
        <div className="platform-login-selector-title">
          {t('magnet.platform-login.selector.title')}
        </div>

        <div className="platform-login-platform-list">
          {platformItems.map((item) => (
            <button
              key={item.id}
              ref={item.id === BILIBILI_CONNECTOR_ID ? bilibiliIconButtonRef : undefined}
              type="button"
              className={`platform-login-platform-item ${
                selectedPlatformId === item.id ? 'platform-login-platform-item--active' : ''
              }`}
              disabled={!item.enabled}
              onClick={() => handleSelectPlatform(item.id, item.enabled)}
            >
              <span className="platform-login-platform-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="platform-login-platform-label">{t(item.labelKey)}</span>
            </button>
          ))}
        </div>

        {statusMessage ? <p className="platform-login-status">{statusMessage}</p> : null}
      </CollisionAwarePopup>

      <CollisionAwarePopup
        ref={authPopupRef}
        open={bilibiliAuthPopupVisible}
        anchorRef={bilibiliIconButtonRef}
        placement="bottom-start"
        offset={10}
        viewportPadding={10}
        className="platform-login-auth-popup"
        role="dialog"
      >
        <div className="platform-login-auth-title">
          {t('magnet.platform-login.popup.title', {
            platform: t('magnet.platform-login.platform.bilibili'),
          })}
        </div>

        <p className="platform-login-auth-line">
          {t('magnet.platform-login.auth.line', {
            state: authStateLabel,
            accountUid: authSnapshot?.accountUid ?? '-',
          })}
        </p>
        <p className="platform-login-auth-line">
          {t('magnet.platform-login.availability.line', {
            availability: availabilityLabel,
            message: authSnapshot?.availabilityMessage ?? t('magnet.platform-login.availability.none'),
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
            disabled={busy || !qrSession}
          >
            {t('magnet.platform-login.action.poll')}
          </button>
          <button type="button" onClick={() => void handleLogout()} disabled={busy}>
            {t('magnet.platform-login.action.logout')}
          </button>
        </div>

        {qrSession ? (
          <div className="platform-login-qr-card">
            <img
              src={qrSession.qrImageDataUrl}
              alt={t('magnet.platform-login.qr.alt')}
              className="platform-login-qr-image"
            />
            <p className="platform-login-qr-hint">{t('magnet.platform-login.qr.hint')}</p>
            <p className="platform-login-qr-expire">
              {t('magnet.platform-login.qr.expiresAt', {
                expiresAt: new Date(qrSession.expiresAtMs).toLocaleString(),
              })}
            </p>
          </div>
        ) : (
          <p className="platform-login-empty">{t('magnet.platform-login.qr.empty')}</p>
        )}

        {pollResult ? (
          <p className="platform-login-poll-result">
            {t('magnet.platform-login.status.pollState', {
              state: pollResult.state,
              message: pollResult.stateMessage,
            })}
          </p>
        ) : null}

        {error ? <p className="platform-login-error">{error}</p> : null}
      </CollisionAwarePopup>
    </>
  );
};
