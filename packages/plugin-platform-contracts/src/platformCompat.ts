export type PlatformCompatAvailability = 'available' | 'degraded' | 'unavailable';

export type PlatformCompatLoginMode = 'none' | 'cookie' | 'qr' | 'cookie+qr';

export type PlatformCompatRuntimeAuthState =
  | 'unauthorized'
  | 'pending'
  | 'authorized'
  | 'expired'
  | 'revoked'
  | 'error';

export type PlatformInstanceAuthState = 'empty' | 'authorizing' | 'authorized' | 'expired' | 'error';

export interface PlatformApiError {
  code:
    | 'AUTH_REQUIRED'
    | 'API_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'UNSUPPORTED_CAPABILITY'
    | string;
  message: string;
  retryable?: boolean;
  details?: unknown;
}

export type PlatformApiResult<T = unknown> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: PlatformApiError;
    };

export interface PlatformCompatCapabilityMap {
  playlists: boolean;
  favorites: boolean;
  dailyRecommendations: boolean;
  search: boolean;
  quality: boolean;
  navigation: boolean;
  settings: boolean;
  pages: boolean;
}

export interface PlatformCompatContractFile {
  contractVersion: '1.0';
  platform: {
    platformId: string;
    displayName: string;
    staticIcon: string;
    vendor?: string;
    supportsMultiInstance: boolean;
  };
  auth: {
    loginMode: PlatformCompatLoginMode;
    requiresCookie: boolean;
    requiresAccountId: boolean;
    supportsRefresh: boolean;
  };
  capabilities: PlatformCompatCapabilityMap;
  apiBindings: {
    auth: string;
    library?: string;
    recommendations?: string;
    search?: string;
    quality?: string;
    navigation?: string;
    settings?: string;
    pages?: string;
  };
  extension?: Record<string, unknown>;
}

export interface PlatformCompatRuntimeApi {
  auth?: {
    getSnapshot?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    refreshSnapshot?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    beginQrLogin?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        sessionId: string;
        qrcodeKey: string;
        qrUrl: string;
        qrImageDataUrl: string;
        generatedAtMs: number;
        expiresAtMs: number;
      }>
    >;
    pollQrLogin?: (input: { instanceId: string; sessionId: string }) => Promise<
      PlatformApiResult<{
        sessionId: string;
        state: string;
        stateCode: number;
        stateMessage: string;
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        expiresAtMs?: number;
        metadata?: Record<string, unknown>;
      }>
    >;
    logout?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
    clearAuthCookies?: (input: { instanceId: string }) => Promise<
      PlatformApiResult<{
        authState: PlatformCompatRuntimeAuthState;
        accountId?: string;
        accountName?: string;
        updatedAtMs?: number;
        expiresAtMs?: number;
        availability?: PlatformCompatAvailability;
        availabilityMessage?: string;
        metadata?: Record<string, unknown>;
      }>
    >;
  };
  library?: Record<string, unknown>;
  recommendations?: Record<string, unknown>;
  search?: Record<string, unknown>;
  quality?: Record<string, unknown>;
  navigation?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  pages?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface PlatformInstanceRecord {
  instanceId: string;
  platformId: string;
  instanceLabel: string;
  displayName: string;
  staticIcon: string;
  account: {
    accountId?: string;
    accountName?: string;
  };
  auth: {
    status: PlatformInstanceAuthState;
    cookieRef?: string;
    cookieUpdatedAtMs?: number;
  };
  capabilities: PlatformCompatCapabilityMap;
  registrations: {
    navigationIds: string[];
    settingsIds: string[];
    pageIds: string[];
  };
  availability: PlatformCompatAvailability;
  availabilityMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface PlatformRenderSelectionRecord {
  instanceId: string;
  mounted: boolean;
  mountedAtMs?: number;
  order?: number;
  metadata?: Record<string, unknown>;
}
