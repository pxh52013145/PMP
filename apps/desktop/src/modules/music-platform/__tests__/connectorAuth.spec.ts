import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateNativeBilibiliQrCodeSessionMock,
  getNativeBilibiliAuthStatusMock,
  logoutNativeBilibiliMock,
  pollNativeBilibiliQrCodeSessionMock,
} = vi.hoisted(() => ({
  generateNativeBilibiliQrCodeSessionMock: vi.fn(),
  getNativeBilibiliAuthStatusMock: vi.fn(),
  logoutNativeBilibiliMock: vi.fn(),
  pollNativeBilibiliQrCodeSessionMock: vi.fn(),
}));

vi.mock('../../music-library', () => ({
  generateNativeBilibiliQrCodeSession: generateNativeBilibiliQrCodeSessionMock,
  getNativeBilibiliAuthStatus: getNativeBilibiliAuthStatusMock,
  logoutNativeBilibili: logoutNativeBilibiliMock,
  pollNativeBilibiliQrCodeSession: pollNativeBilibiliQrCodeSessionMock,
}));

import {
  beginBilibiliQrLogin,
  beginPlatformQrLogin,
  getPlatformConnectorAuthSnapshot,
  listPlatformConnectorAuthSnapshots,
  listPlatformConnectorDefinitions,
  logoutPlatformConnector,
  pollPlatformQrLogin,
  refreshAndEmitPlatformConnectorAuthSnapshot,
} from '../connectorAuth';

const BILIBILI_CONNECTOR_ID = 'connector.platform.bilibili';
const NETEASE_CONNECTOR_ID = 'connector.platform.netease';
const QQMUSIC_CONNECTOR_ID = 'connector.platform.qqmusic';

beforeEach(() => {
  vi.clearAllMocks();

  getNativeBilibiliAuthStatusMock.mockResolvedValue({
    connectorId: BILIBILI_CONNECTOR_ID,
    authState: 'unauthorized',
    accountUid: undefined,
    updatedAtMs: 1700000000000,
    expiresAtMs: undefined,
    availability: 'available',
    availabilityMessage: '',
  });

  generateNativeBilibiliQrCodeSessionMock.mockResolvedValue({
    connectorId: BILIBILI_CONNECTOR_ID,
    sessionId: 'session-1',
    qrcodeKey: 'key-1',
    qrUrl: 'https://example.com/qr',
    qrImageDataUrl: 'data:image/png;base64,abc',
    generatedAtMs: 1700000001000,
    expiresAtMs: 1700000010000,
  });

  pollNativeBilibiliQrCodeSessionMock.mockResolvedValue({
    connectorId: BILIBILI_CONNECTOR_ID,
    sessionId: 'session-1',
    state: 'pending',
    stateCode: 86101,
    stateMessage: 'waiting',
    authState: 'pending',
    accountUid: undefined,
    expiresAtMs: undefined,
  });

  logoutNativeBilibiliMock.mockResolvedValue({
    connectorId: BILIBILI_CONNECTOR_ID,
    authState: 'unauthorized',
    accountUid: undefined,
    updatedAtMs: 1700000002000,
    expiresAtMs: undefined,
    availability: 'available',
    availabilityMessage: '',
  });
});

describe('music-platform connectorAuth adapters', () => {
  it('lists builtin connector definitions with stable order', () => {
    const definitions = listPlatformConnectorDefinitions();

    const connectorIds = definitions.map((item) => item.connectorId);
    expect(connectorIds).toContain(BILIBILI_CONNECTOR_ID);
    expect(connectorIds).toContain(NETEASE_CONNECTOR_ID);
    expect(connectorIds).toContain(QQMUSIC_CONNECTOR_ID);

    expect(definitions.find((item) => item.connectorId === BILIBILI_CONNECTOR_ID)?.enabled).toBe(true);
    expect(definitions.find((item) => item.connectorId === NETEASE_CONNECTOR_ID)?.enabled).toBe(false);
    expect(definitions.find((item) => item.connectorId === QQMUSIC_CONNECTOR_ID)?.enabled).toBe(false);
  });

  it('returns connector snapshots independently for each connector id', async () => {
    getNativeBilibiliAuthStatusMock.mockResolvedValueOnce({
      connectorId: BILIBILI_CONNECTOR_ID,
      authState: 'authorized',
      accountUid: 'uid-123',
      updatedAtMs: 1700000003000,
      expiresAtMs: 1700000900000,
      availability: 'available',
      availabilityMessage: 'ok',
    });

    const snapshots = await listPlatformConnectorAuthSnapshots();
    const byConnectorId = new Map(snapshots.map((item) => [item.connectorId, item]));

    expect(byConnectorId.get(BILIBILI_CONNECTOR_ID)?.authState).toBe('authorized');
    expect(byConnectorId.get(BILIBILI_CONNECTOR_ID)?.accountUid).toBe('uid-123');

    expect(byConnectorId.get(NETEASE_CONNECTOR_ID)?.authState).toBe('unauthorized');
    expect(byConnectorId.get(NETEASE_CONNECTOR_ID)?.availability).toBe('unavailable');

    expect(byConnectorId.get(QQMUSIC_CONNECTOR_ID)?.authState).toBe('unauthorized');
    expect(byConnectorId.get(QQMUSIC_CONNECTOR_ID)?.availability).toBe('unavailable');
  });

  it('routes qr login operations through connector adapter contract', async () => {
    const bilibiliSession = await beginPlatformQrLogin(BILIBILI_CONNECTOR_ID);
    expect(generateNativeBilibiliQrCodeSessionMock).toHaveBeenCalledTimes(1);
    expect(bilibiliSession?.connectorId).toBe(BILIBILI_CONNECTOR_ID);

    const unsupportedSession = await beginPlatformQrLogin(NETEASE_CONNECTOR_ID);
    expect(unsupportedSession).toBeNull();
  });

  it('refreshes bilibili snapshot after terminal qr poll state', async () => {
    pollNativeBilibiliQrCodeSessionMock.mockResolvedValueOnce({
      connectorId: BILIBILI_CONNECTOR_ID,
      sessionId: 'session-1',
      state: 'authorized',
      stateCode: 0,
      stateMessage: 'ok',
      authState: 'authorized',
      accountUid: 'uid-789',
      expiresAtMs: 1700000900000,
    });

    getNativeBilibiliAuthStatusMock.mockResolvedValueOnce({
      connectorId: BILIBILI_CONNECTOR_ID,
      authState: 'authorized',
      accountUid: 'uid-789',
      updatedAtMs: 1700000005000,
      expiresAtMs: 1700000900000,
      availability: 'available',
      availabilityMessage: 'ok',
    });

    const result = await pollPlatformQrLogin(BILIBILI_CONNECTOR_ID, 'session-1');
    expect(result?.authState).toBe('authorized');
    expect(pollNativeBilibiliQrCodeSessionMock).toHaveBeenCalledWith('session-1');
    expect(getNativeBilibiliAuthStatusMock).toHaveBeenCalledTimes(1);
  });

  it('keeps bilibili compatibility wrappers operational', async () => {
    const snapshot = await getPlatformConnectorAuthSnapshot(BILIBILI_CONNECTOR_ID);
    expect(snapshot?.connectorId).toBe(BILIBILI_CONNECTOR_ID);

    const wrappedSession = await beginBilibiliQrLogin();
    expect(wrappedSession?.connectorId).toBe(BILIBILI_CONNECTOR_ID);

    const refreshed = await refreshAndEmitPlatformConnectorAuthSnapshot(BILIBILI_CONNECTOR_ID);
    expect(refreshed?.connectorId).toBe(BILIBILI_CONNECTOR_ID);

    const loggedOut = await logoutPlatformConnector(BILIBILI_CONNECTOR_ID);
    expect(loggedOut?.connectorId).toBe(BILIBILI_CONNECTOR_ID);
    expect(logoutNativeBilibiliMock).toHaveBeenCalledTimes(1);
  });
});
