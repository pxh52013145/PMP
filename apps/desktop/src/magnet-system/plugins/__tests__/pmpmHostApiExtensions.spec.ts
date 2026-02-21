import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_VERSION, HOST_API_VERSION } from '../../../constants/versions';
import { musicLibraryService } from '../../../services/audio/MusicLibraryService';
import { clearPmpmAuditLog, readPmpmAuditLog } from '../pmpmGovernance';
import {
  configureAudioInputAdapterGovernance,
  createPluginMountApi,
  registerDesktopPetRuntimeProvider,
  registerAudioInputAdapterProvider,
  registerAiAdapterProvider,
  registerVoiceTrainingRuntimeProvider,
  registerPluginHostCapability,
  setDefaultAudioInputAdapterProvider,
  type HostAudioService,
  type HostNavigation,
} from '../pluginHostApi';

type NavigationListener = Parameters<NonNullable<HostNavigation['subscribe']>>[0];

function createTestAudioService(overrides: Partial<HostAudioService> = {}): HostAudioService {
  return {
    getState: () => ({ currentTrack: null, playMode: 'sequence' }),
    onStateChange: () => () => {},
    onTimeUpdate: () => () => {},
    onEnded: () => () => {},
    play: async () => {},
    pause: () => {},
    stop: () => {},
    seek: () => {},
    setVolume: () => {},
    toggleMute: () => {},
    ...overrides,
  };
}

function makeNavigationSnapshot(currentIndex: number) {
  return {
    currentPage: { type: 'home' as const },
    history: [{ type: 'home' as const }],
    currentIndex,
  };
}

function createTestNavigation(snapshot: { currentIndex: number } = { currentIndex: 0 }) {
  const listeners = new Set<NavigationListener>();

  const navigation: HostNavigation = {
    navigateTo: vi.fn(),
    goBack: vi.fn(),
    getSnapshot: () =>
      makeNavigationSnapshot(snapshot.currentIndex) as never,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  return {
    navigation,
    emitChange: (nextIndex: number) => {
      const next = makeNavigationSnapshot(nextIndex);
      for (const cb of Array.from(listeners)) cb(next);
    },
  };
}

describe('pmpm Host API - extensions', () => {
  afterEach(() => {
    clearPmpmAuditLog();
    configureAudioInputAdapterGovernance({
      thirdPartyEnabled: false,
      allowedProviderIds: null,
      timeoutMs: 2000,
      maxOpenSessionsPerPlugin: 24,
      quarantineThreshold: 3,
      quarantineMs: 120000,
    });
  });

  it('host.getInfo returns null when permission denied', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.getInfo()).toBeNull();
  });

  it('host.getInfo returns version info when allowed', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.getInfo()).toEqual({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      hostApiVersion: HOST_API_VERSION,
      appVersion: APP_VERSION,
      runtime: expect.any(String),
    });
  });

  it('audio.playNext is gated by api:audio-control', async () => {
    const playNext = vi.fn(async () => {});

    const apiDenied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ playNext }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await apiDenied.audio.playNext();
    expect(playNext).not.toHaveBeenCalled();

    const apiAllowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-control']),
      audioService: createTestAudioService({ playNext }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await apiAllowed.audio.playNext();
    expect(playNext).toHaveBeenCalledTimes(1);
  });

  it('audio.setPlayMode validates mode and requires api:audio-control', () => {
    const setPlayMode = vi.fn();

    const apiDenied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ setPlayMode }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    apiDenied.audio.setPlayMode('loop');
    expect(setPlayMode).not.toHaveBeenCalled();

    const apiAllowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-control']),
      audioService: createTestAudioService({ setPlayMode }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    apiAllowed.audio.setPlayMode('not-a-mode');
    expect(setPlayMode).not.toHaveBeenCalled();

    apiAllowed.audio.setPlayMode('loop');
    expect(setPlayMode).toHaveBeenCalledTimes(1);
    expect(setPlayMode).toHaveBeenCalledWith('loop');
  });

  it('navigation.canGoBack uses snapshot currentIndex when allowed', () => {
    const { navigation: nav0 } = createTestNavigation({ currentIndex: 0 });
    const api0 = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation: nav0,
    });
    expect(api0.navigation.canGoBack()).toBe(false);

    const { navigation: nav2 } = createTestNavigation({ currentIndex: 2 });
    const api2 = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation: nav2,
    });
    expect(api2.navigation.canGoBack()).toBe(true);
  });

  it('navigation.onChange wires through host subscribe when allowed', () => {
    const { navigation, emitChange } = createTestNavigation({ currentIndex: 0 });
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:navigation']),
      audioService: createTestAudioService(),
      navigation,
    });

    const cb = vi.fn();
    const unsubscribe = api.navigation.onChange(cb);
    emitChange(1);
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    emitChange(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('host.listCapabilities filters by capability permission', async () => {
    const deniedAi = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const deniedList = await deniedAi.host.listCapabilities();
    expect(deniedList.some((item) => item.id === 'foundation.ai-adapter')).toBe(false);
    expect(deniedList.some((item) => item.id === 'foundation.audio-input-adapter')).toBe(false);

    const allowedAi = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>([
        'api:host',
        'api:ai-runtime',
        'api:audio-input-adapter',
      ]),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const allowedList = await allowedAi.host.listCapabilities();
    expect(allowedList.some((item) => item.id === 'foundation.ai-adapter')).toBe(true);
    expect(allowedList.some((item) => item.id === 'foundation.audio-input-adapter')).toBe(true);
  });

  it('host.invokeCapability enforces permissions and forwards invoke context', async () => {
    const unregister = registerPluginHostCapability({
      id: 'test.echo-bridge',
      version: '1.0.0',
      permission: 'api:ai-runtime',
      handler: ({ method, payload, context }) => ({
        method,
        payload,
        pluginId: context.pluginId,
      }),
    });

    try {
      const denied = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      await expect(
        denied.host.invokeCapability('test.echo-bridge', 'run', { value: 1 })
      ).rejects.toThrow(/permission denied/i);

      const allowed = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      await expect(
        allowed.host.invokeCapability('test.echo-bridge', 'run', { value: 1 })
      ).resolves.toEqual({
        method: 'run',
        payload: { value: 1 },
        pluginId: 'demo',
      });
    } finally {
      unregister();
    }
  });

  it('host.invokeCapability supports builtin capability-registry list', async () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:host-capability']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const result = await api.host.invokeCapability('foundation.capability-registry', 'list', {});
    expect(result).toMatchObject({ ok: true });
    const data = (result as { ok: true; data: Array<{ id: string }> }).data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((item) => item.id === 'foundation.capability-registry')).toBe(true);
  });

  it('host.invokeCapability supports builtin reserved describe method', async () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const result = await api.host.invokeCapability('foundation.ai-adapter', 'describe', null);
    expect(result).toMatchObject({
      ok: true,
      data: {
        capabilityId: 'foundation.ai-adapter',
        ready: false,
      },
    });
  });

  it('foundation.audio-input-adapter describe is gated and returns bridge metadata', async () => {
    const denied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:host-capability']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await expect(
      denied.host.invokeCapability('foundation.audio-input-adapter', 'describe', null)
    ).rejects.toThrow(/permission denied/i);

    const allowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>([
        'api:host',
        'api:host-capability',
        'api:audio-input-adapter',
      ]),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const result = await allowed.host.invokeCapability(
      'foundation.audio-input-adapter',
      'describe',
      null
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        capabilityId: 'foundation.audio-input-adapter',
        domain: 'audio-input-adapter',
        stage: 'phase-d',
        ready: false,
        implementation: 'hybrid-bridge',
        bridgeAvailable: false,
      },
    });
  });

  it('foundation.audio-input-adapter supports builtin bridge workflow in phase B', async () => {
    const listAudioInputs = vi.fn(async () => ['sacd', 'symphonia', 'rodio']);
    const selectAudioInput = vi.fn(async () => true);

    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>([
        'api:host',
        'api:host-capability',
        'api:audio-input-adapter',
      ]),
      audioService: createTestAudioService({
        listAudioInputs,
        selectAudioInput,
      }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const describe = await api.host.invokeCapability('foundation.audio-input-adapter', 'describe', null);
    expect(describe).toMatchObject({
      ok: true,
      data: {
        capabilityId: 'foundation.audio-input-adapter',
        ready: true,
        implementation: 'hybrid-bridge',
      },
    });

    const listed = await api.host.invokeCapability('foundation.audio-input-adapter', 'listInputs', null);
    expect(listed).toMatchObject({
      ok: true,
      data: {
        inputCount: 3,
        inputs: [{ id: 'sacd' }, { id: 'symphonia' }, { id: 'rodio' }],
      },
    });

    const probe = await api.host.invokeCapability('foundation.audio-input-adapter', 'probe', {
      sourceUri: 'C:/Music/demo.flac',
    });
    expect(probe).toMatchObject({
      ok: true,
      data: {
        sourcePath: 'C:/Music/demo.flac',
        selectedInputId: 'symphonia',
        confidence: 'matched',
        supported: true,
      },
    });

    const openSession = await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
      sourceUri: 'C:/Music/demo.flac',
    });
    expect(openSession).toMatchObject({
      ok: true,
      data: {
        selectedInputId: 'symphonia',
      },
    });
    expect(selectAudioInput).toHaveBeenCalledWith('symphonia');

    const openedSessionId = (openSession as { ok: true; data: { sessionId: string } }).data.sessionId;
    expect(typeof openedSessionId).toBe('string');
    expect(openedSessionId.length).toBeGreaterThan(0);

    const healthAfterOpen = await api.host.invokeCapability('foundation.audio-input-adapter', 'health', null);
    expect(healthAfterOpen).toMatchObject({
      ok: true,
      data: {
        ready: true,
        inputCount: 3,
        pluginOpenSessionCount: 1,
      },
    });

    const closeSession = await api.host.invokeCapability('foundation.audio-input-adapter', 'closeSession', {
      sessionId: openedSessionId,
    });
    expect(closeSession).toMatchObject({
      ok: true,
      data: {
        sessionId: openedSessionId,
        closed: true,
      },
    });

    const healthAfterClose = await api.host.invokeCapability('foundation.audio-input-adapter', 'health', null);
    expect(healthAfterClose).toMatchObject({
      ok: true,
      data: {
        pluginOpenSessionCount: 0,
      },
    });
  });

  it('foundation.audio-input-adapter supports third-party provider registration and governance', async () => {
    const unregisterA = registerAudioInputAdapterProvider(
      {
        info: {
          id: 'test.decoder-a',
          name: 'Decoder A',
          version: '0.1.0',
          protocolVersion: '1.0.0',
        },
        openSession: async () => ({
          providerSessionId: 'a-session',
        }),
      },
      { setAsDefault: true }
    );

    const unregisterB = registerAudioInputAdapterProvider({
      info: {
        id: 'test.decoder-b',
        name: 'Decoder B',
        version: '0.1.0',
        protocolVersion: '1.0.0',
      },
      openSession: async () => ({
        providerSessionId: 'b-session',
      }),
    });

    try {
      configureAudioInputAdapterGovernance({
        thirdPartyEnabled: true,
        allowedProviderIds: ['test.decoder-a'],
        timeoutMs: 1500,
      });
      setDefaultAudioInputAdapterProvider('test.decoder-a');

      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>([
          'api:host',
          'api:host-capability',
          'api:audio-input-adapter',
        ]),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const providers = await api.host.invokeCapability(
        'foundation.audio-input-adapter',
        'listProviders',
        null
      );

      expect(providers).toMatchObject({
        ok: true,
        data: {
          thirdPartyEnabled: true,
          defaultProviderId: 'test.decoder-a',
          providerCount: 2,
          providers: [
            { id: 'test.decoder-a', enabled: true },
            { id: 'test.decoder-b', enabled: false },
          ],
        },
      });

      const disabledHealth = await api.host.invokeCapability(
        'foundation.audio-input-adapter',
        'health',
        { providerId: 'test.decoder-b' }
      );
      expect(disabledHealth).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.decoder-b',
          ready: false,
          reason: 'provider-disabled-by-governance',
        },
      });
    } finally {
      unregisterA();
      unregisterB();
    }
  });

  it('foundation.audio-input-adapter openSession falls back to builtin when provider fails', async () => {
    const openSession = vi.fn(async () => {
      throw new Error('sidecar unavailable');
    });
    const selectAudioInput = vi.fn(async () => true);

    const unregister = registerAudioInputAdapterProvider(
      {
        info: {
          id: 'test.decoder-fail',
          name: 'Decoder Failing Sidecar',
          version: '0.1.0',
          protocolVersion: '1.0.0',
        },
        openSession,
      },
      { setAsDefault: true }
    );

    try {
      configureAudioInputAdapterGovernance({ thirdPartyEnabled: true, timeoutMs: 800 });

      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>([
          'api:host',
          'api:host-capability',
          'api:audio-input-adapter',
        ]),
        audioService: createTestAudioService({
          listAudioInputs: async () => ['symphonia', 'rodio'],
          selectAudioInput,
        }),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const opened = await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/fallback.flac',
      });

      expect(openSession).toHaveBeenCalledTimes(1);
      expect(selectAudioInput).toHaveBeenCalledWith('symphonia');
      expect(opened).toMatchObject({
        ok: true,
        data: {
          selectedAdapterKind: 'builtin',
          selectedInputId: 'symphonia',
          fallbackFromProvider: {
            providerId: 'test.decoder-fail',
          },
        },
      });

      const audit = readPmpmAuditLog();
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-fallback' &&
            event.pluginId === 'demo' &&
            event.fromProviderId === 'test.decoder-fail' &&
            event.toAdapterId === 'symphonia'
        )
      ).toBe(true);
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-selected' &&
            event.pluginId === 'demo' &&
            event.adapterKind === 'builtin' &&
            event.adapterId === 'symphonia'
        )
      ).toBe(true);
    } finally {
      unregister();
    }
  });

  it('foundation.audio-input-adapter openSession/closeSession use provider path when available', async () => {
    const closeSession = vi.fn(async () => {});

    const unregister = registerAudioInputAdapterProvider(
      {
        info: {
          id: 'test.decoder-ok',
          name: 'Decoder OK Sidecar',
          version: '0.1.0',
          protocolVersion: '1.0.0',
        },
        probe: async () => ({
          supported: true,
          score: 0.9,
          inputId: 'ext-decoder',
        }),
        openSession: async () => ({
          providerSessionId: 'provider-session-1',
          selectedInputId: 'ext-decoder',
        }),
        closeSession,
      },
      { setAsDefault: true }
    );

    try {
      configureAudioInputAdapterGovernance({ thirdPartyEnabled: true });

      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>([
          'api:host',
          'api:host-capability',
          'api:audio-input-adapter',
        ]),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const opened = await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/provider.ogg',
        providerId: 'test.decoder-ok',
        fallbackToBuiltin: false,
      });

      expect(opened).toMatchObject({
        ok: true,
        data: {
          selectedAdapterKind: 'provider',
          selectedProviderId: 'test.decoder-ok',
          selectedInputId: 'ext-decoder',
          providerSessionId: 'provider-session-1',
        },
      });

      const sessionId = (opened as { ok: true; data: { sessionId: string } }).data.sessionId;

      const closed = await api.host.invokeCapability('foundation.audio-input-adapter', 'closeSession', {
        sessionId,
      });

      expect(closeSession).toHaveBeenCalledTimes(1);
      expect(closed).toMatchObject({
        ok: true,
        data: {
          closed: true,
          adapterKind: 'provider',
          adapterId: 'test.decoder-ok',
        },
      });

      const audit = readPmpmAuditLog();
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-selected' &&
            event.pluginId === 'demo' &&
            event.adapterKind === 'provider' &&
            event.adapterId === 'test.decoder-ok'
        )
      ).toBe(true);
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-session-closed' &&
            event.pluginId === 'demo' &&
            event.sessionId === sessionId &&
            event.adapterId === 'test.decoder-ok'
        )
      ).toBe(true);
    } finally {
      unregister();
    }
  });

  it('foundation.audio-input-adapter supports provider quarantine stats and clear flow', async () => {
    const openSession = vi.fn(async () => {
      throw new Error('decoder-sidecar-crash');
    });
    const selectAudioInput = vi.fn(async () => true);

    const unregister = registerAudioInputAdapterProvider(
      {
        info: {
          id: 'test.decoder-quarantine',
          name: 'Decoder Quarantine',
          version: '0.1.0',
          protocolVersion: '1.0.0',
        },
        openSession,
      },
      { setAsDefault: true }
    );

    try {
      configureAudioInputAdapterGovernance({
        thirdPartyEnabled: true,
        timeoutMs: 1200,
        quarantineThreshold: 2,
        quarantineMs: 60_000,
      });

      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>([
          'api:host',
          'api:host-capability',
          'api:audio-input-adapter',
        ]),
        audioService: createTestAudioService({
          listAudioInputs: async () => ['symphonia', 'rodio'],
          selectAudioInput,
        }),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/quarantine-1.flac',
      });
      await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/quarantine-2.flac',
      });

      const providers = await api.host.invokeCapability(
        'foundation.audio-input-adapter',
        'listProviders',
        null
      );

      expect(providers).toMatchObject({
        ok: true,
        data: {
          providers: [
            {
              id: 'test.decoder-quarantine',
              quarantined: true,
              unavailableReason: 'provider-quarantined',
            },
          ],
        },
      });

      const stats = await api.host.invokeCapability('foundation.audio-input-adapter', 'stats', {
        providerId: 'test.decoder-quarantine',
      });
      expect(stats).toMatchObject({
        ok: true,
        data: {
          providerStats: [
            {
              providerId: 'test.decoder-quarantine',
              totalFailureCount: 2,
              quarantined: true,
            },
          ],
        },
      });

      const clear = await api.host.invokeCapability(
        'foundation.audio-input-adapter',
        'clearProviderQuarantine',
        { providerId: 'test.decoder-quarantine' }
      );
      expect(clear).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.decoder-quarantine',
          cleared: true,
        },
      });

      const providersAfterClear = await api.host.invokeCapability(
        'foundation.audio-input-adapter',
        'listProviders',
        null
      );
      expect(providersAfterClear).toMatchObject({
        ok: true,
        data: {
          providers: [
            {
              id: 'test.decoder-quarantine',
              quarantined: false,
            },
          ],
        },
      });

      const audit = readPmpmAuditLog();
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-provider-quarantined' &&
            event.providerId === 'test.decoder-quarantine'
        )
      ).toBe(true);
      expect(
        audit.some(
          (event) =>
            event.type === 'audio-input-adapter-provider-quarantine-cleared' &&
            event.providerId === 'test.decoder-quarantine'
        )
      ).toBe(true);
    } finally {
      unregister();
    }
  });

  it('foundation.desktop-pet-runtime supports provider registration and invoke', async () => {
    const invoke = vi.fn(async ({ task, input }: { task: string; input: unknown }) => ({
      task,
      echoed: input,
    }));

    const unregister = registerDesktopPetRuntimeProvider(
      {
        info: {
          id: 'test.desktop-pet-provider',
          name: 'Desktop Pet Provider',
          version: '0.1.0',
          capabilities: ['pet.animate', 'pet.state'],
        },
        invoke,
      },
      { setAsDefault: true }
    );

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:desktop-pet']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const describe = await api.host.invokeCapability('foundation.desktop-pet-runtime', 'describe', null);
      expect(describe).toMatchObject({
        ok: true,
        data: {
          ready: true,
          providerCount: 1,
        },
      });

      const providers = await api.host.invokeCapability(
        'foundation.desktop-pet-runtime',
        'listProviders',
        { capability: 'pet.animate' }
      );
      expect(providers).toMatchObject({
        ok: true,
        data: {
          providerCount: 1,
          providers: [{ id: 'test.desktop-pet-provider' }],
        },
      });

      const result = await api.host.invokeCapability('foundation.desktop-pet-runtime', 'invoke', {
        task: 'pet.animate.wave',
        input: { speed: 1.2 },
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.desktop-pet-provider',
          task: 'pet.animate.wave',
        },
      });
    } finally {
      unregister();
    }
  });

  it('foundation.voice-training-runtime supports provider registration and invoke', async () => {
    const invoke = vi.fn(async ({ task }: { task: string }) => ({
      accepted: true,
      task,
    }));

    const unregister = registerVoiceTrainingRuntimeProvider(
      {
        info: {
          id: 'test.voice-training-provider',
          name: 'Voice Training Provider',
          version: '0.1.0',
          capabilities: ['voice.train', 'voice.infer'],
        },
        invoke,
      },
      { setAsDefault: true }
    );

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:voice-training']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const describe = await api.host.invokeCapability(
        'foundation.voice-training-runtime',
        'describe',
        null
      );
      expect(describe).toMatchObject({
        ok: true,
        data: {
          ready: true,
          providerCount: 1,
        },
      });

      const result = await api.host.invokeCapability('foundation.voice-training-runtime', 'invoke', {
        task: 'voice.train.step',
        input: { datasetId: 'dataset-1' },
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.voice-training-provider',
          task: 'voice.train.step',
        },
      });
    } finally {
      unregister();
    }
  });

  it('foundation.ai-adapter lists providers and routes invoke payload', async () => {
    const invoke = vi.fn(async ({ input }: { input: unknown }) => {
      const text =
        typeof input === 'object' && input && 'text' in input
          ? String((input as { text?: unknown }).text ?? '')
          : '';
      return { echoed: text };
    });

    const unregister = registerAiAdapterProvider(
      {
        info: {
          id: 'test.mock-ai-provider',
          name: 'Mock AI Provider',
          version: '0.1.0',
          vendor: 'PMPM Test',
          capabilities: ['chat', 'streaming'],
        },
        invoke,
      },
      { setAsDefault: true }
    );

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const providers = await api.host.invokeCapability('foundation.ai-adapter', 'listProviders', null);
      expect(providers).toMatchObject({
        ok: true,
        data: {
          defaultProviderId: 'test.mock-ai-provider',
          providerCount: 1,
          providers: [{ id: 'test.mock-ai-provider' }],
        },
      });

      const invokeResult = await api.host.invokeCapability('foundation.ai-adapter', 'invoke', {
        task: 'chat.generate',
        input: { text: 'hello' },
        options: { temperature: 0.2 },
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      const request = invoke.mock.calls[0][0] as unknown as {
        task: string;
        options: Record<string, unknown>;
        context: { pluginId: string; permissions: ReadonlySet<string> };
      };
      expect(request.task).toBe('chat.generate');
      expect(request.options).toEqual({ temperature: 0.2 });
      expect(request.context.pluginId).toBe('demo');
      expect(request.context.permissions.has('api:ai-runtime')).toBe(true);

      expect(invokeResult).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.mock-ai-provider',
          task: 'chat.generate',
          output: { echoed: 'hello' },
        },
      });
    } finally {
      unregister();
    }
  });

  it('foundation.ai-adapter health and invoke validation return stable envelopes', async () => {
    const unregister = registerAiAdapterProvider(
      {
        info: {
          id: 'test.unstable-ai-provider',
          name: 'Unstable AI Provider',
          version: '0.1.0',
          capabilities: ['completion'],
        },
        health: () => ({ status: 'degraded', message: 'quota-low' }),
        invoke: async () => {
          throw new Error('provider-down');
        },
      },
      { setAsDefault: true }
    );

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const health = await api.host.invokeCapability('foundation.ai-adapter', 'health', {
        providerId: 'test.unstable-ai-provider',
      });
      expect(health).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.unstable-ai-provider',
          status: 'degraded',
          ready: false,
        },
      });

      const invalid = await api.host.invokeCapability('foundation.ai-adapter', 'invoke', {
        providerId: 'test.unstable-ai-provider',
      });
      expect(invalid).toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_PAYLOAD',
        },
      });

      const failedInvoke = await api.host.invokeCapability('foundation.ai-adapter', 'invoke', {
        providerId: 'test.unstable-ai-provider',
        task: 'completion.generate',
      });
      expect(failedInvoke).toMatchObject({
        ok: false,
        error: {
          code: 'PROVIDER_ERROR',
        },
      });
    } finally {
      unregister();
    }
  });

  it('foundation.ai-adapter searchTracks returns host music library matches', async () => {
    const searchSpy = vi.spyOn(musicLibraryService, 'searchTracks').mockResolvedValue([
      { id: 'track-a', title: 'Alpha', artist: 'Artist A', filePath: 'C:/music/alpha.mp3' },
      { id: 'track-b', title: 'Beta', artist: 'Artist B', filePath: 'C:/music/beta.mp3' },
    ] as never);

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const result = await api.host.invokeCapability('foundation.ai-adapter', 'searchTracks', {
        query: ' alpha ',
        limit: 5,
      });

      expect(searchSpy).toHaveBeenCalledWith('alpha', 5);
      expect(result).toMatchObject({
        ok: true,
        data: {
          query: 'alpha',
          count: 2,
          tracks: [{ id: 'track-a' }, { id: 'track-b' }],
        },
      });
    } finally {
      searchSpy.mockRestore();
    }
  });

  it('foundation.ai-adapter playTrack queues and starts selected track', async () => {
    const searchSpy = vi.spyOn(musicLibraryService, 'searchTracks').mockResolvedValue([
      { id: 'track-a', title: 'Alpha', artist: 'Artist A', filePath: 'C:/music/alpha.mp3' },
      { id: 'track-b', title: 'Beta', artist: 'Artist B', filePath: 'C:/music/beta.mp3' },
    ] as never);

    const clearQueue = vi.fn();
    const addMultipleToQueue = vi.fn();
    const getQueue = vi.fn(() => [{ id: 'existing', title: 'Existing' }]);
    const playTrackAtIndex = vi.fn(async () => {});

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService({
          clearQueue,
          addMultipleToQueue,
          getQueue,
          playTrackAtIndex,
        }),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const result = await api.host.invokeCapability('foundation.ai-adapter', 'playTrack', {
        query: 'beta',
        matchIndex: 1,
        queueMode: 'replace',
      });

      expect(searchSpy).toHaveBeenCalledWith('beta', 25);
      expect(clearQueue).toHaveBeenCalledTimes(1);
      expect(addMultipleToQueue).toHaveBeenCalledTimes(1);
      expect(playTrackAtIndex).toHaveBeenCalledWith(1);

      expect(result).toMatchObject({
        ok: true,
        data: {
          queueMode: 'replace',
          selectedIndex: 1,
          queueIndex: 1,
          track: { id: 'track-b' },
        },
      });
    } finally {
      searchSpy.mockRestore();
    }
  });

  it('host.invokeCapability rejects invalid method names', async () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    await expect(
      api.host.invokeCapability('foundation.ai-adapter', 'bad method', {})
    ).rejects.toThrow(/invalid host capability method/i);
  });

  it('host.invokeCapability rejects oversized payloads', async () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const oversizedPayload = { text: 'x'.repeat(300 * 1024) };
    await expect(
      api.host.invokeCapability('foundation.ai-adapter', 'describe', oversizedPayload)
    ).rejects.toThrow(/payload too large/i);
  });

  it('host.invokeCapability times out for stalled runtime handlers', async () => {
    vi.useFakeTimers();

    const unregister = registerPluginHostCapability({
      id: 'test.slow-runtime',
      version: '1.0.0',
      permission: 'api:ai-runtime',
      handler: async () => {
        await new Promise(() => {});
        return null;
      },
    });

    try {
      const api = createPluginMountApi({
        pluginId: 'demo',
        hostLabel: 'TestHost',
        permissions: new Set<string>(['api:host', 'api:host-capability', 'api:ai-runtime']),
        audioService: createTestAudioService(),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const pending = api.host.invokeCapability('test.slow-runtime', 'run', null);
      const assertion = expect(pending).rejects.toThrow(/timed out/i);
      await vi.advanceTimersByTimeAsync(6_100);
      await assertion;
    } finally {
      unregister();
      vi.useRealTimers();
    }
  });

  it('host.hasPermission supports wildcard capability grants', () => {
    const api = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:host', 'api:*']),
      audioService: createTestAudioService(),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(api.host.hasPermission('api:voice-training')).toBe(true);
    expect(api.host.hasPermission('api:desktop-pet')).toBe(true);
  });

  it('visualizer.getSpectrumFrame and onSpectrumFrame are gated and poll host frames', async () => {
    const getSpectrumFrame = vi.fn((tap?: 'pre-dsp' | 'post-dsp') => ({
      frameId: tap === 'pre-dsp' ? 10 : 20,
      timestampMs: 123,
      tap: tap ?? 'post-dsp',
      sampleRate: 48_000,
      bins: new Uint8Array([1, 2, 3]),
    }));

    const denied = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(),
      audioService: createTestAudioService({ getSpectrumFrame }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    expect(denied.visualizer.getSpectrumFrame({ tap: 'pre-dsp' })).toBeNull();

    const allowed = createPluginMountApi({
      pluginId: 'demo',
      hostLabel: 'TestHost',
      permissions: new Set<string>(['api:audio-visual']),
      audioService: createTestAudioService({ getSpectrumFrame }),
      navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
    });

    const pre = allowed.visualizer.getSpectrumFrame({ tap: 'pre-dsp' });
    expect(pre?.tap).toBe('pre-dsp');

    vi.useFakeTimers();
    const cb = vi.fn();
    const off = allowed.visualizer.onSpectrumFrame(cb, { tap: 'post-dsp', intervalMs: 16 });
    vi.advanceTimersByTime(20);
    off();
    vi.useRealTimers();

    expect(cb).toHaveBeenCalled();
    expect(getSpectrumFrame).toHaveBeenCalledWith('pre-dsp');
    expect(getSpectrumFrame).toHaveBeenCalledWith('post-dsp');
  });
});
