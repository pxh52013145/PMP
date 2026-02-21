import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  configureAudioInputAdapterGovernance,
  createPluginMountApi,
  registerAudioInputAdapterSidecarProvider,
  type HostAudioService,
  type HostNavigation,
} from '../pluginHostApi';

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

describe('audioInputAdapterSidecar bridge', () => {
  afterEach(() => {
    configureAudioInputAdapterGovernance({
      thirdPartyEnabled: false,
      allowedProviderIds: null,
      timeoutMs: 2000,
    });
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  });

  it('registers sidecar provider and routes probe/open/close through sidecar commands', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const invokeFn = vi.fn(async (command: string) => {
      switch (command) {
        case 'decoder_sidecar_test_describe_provider':
          return {
            ready: true,
            protocolVersion: '1.0.1',
          };
        case 'decoder_sidecar_test_probe':
          return {
            supported: true,
            score: 0.92,
            inputId: 'sidecar-decoder',
          };
        case 'decoder_sidecar_test_open_session':
          return {
            providerSessionId: 'provider-session-42',
            selectedInputId: 'sidecar-decoder',
          };
        case 'decoder_sidecar_test_close_session':
          return {
            closed: true,
          };
        default:
          throw new Error(`unexpected command: ${command}`);
      }
    });

    const unregister = registerAudioInputAdapterSidecarProvider({
      info: {
        id: 'test.sidecar-provider',
        name: 'Test Sidecar Provider',
        version: '0.1.0',
        protocolVersion: '1.0.0',
      },
      setAsDefault: true,
      commandPrefix: 'decoder_sidecar_test',
      invokeFn,
    });

    try {
      configureAudioInputAdapterGovernance({
        thirdPartyEnabled: true,
        timeoutMs: 1200,
      });

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

      const probe = await api.host.invokeCapability('foundation.audio-input-adapter', 'probe', {
        sourcePath: 'C:/Music/sidecar.flac',
        providerId: 'test.sidecar-provider',
      });

      expect(probe).toMatchObject({
        ok: true,
        data: {
          selectedAdapterKind: 'provider',
          selectedProviderId: 'test.sidecar-provider',
          selectedInputId: 'sidecar-decoder',
          supported: true,
          confidence: 'provider',
        },
      });

      const opened = await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/sidecar.flac',
        providerId: 'test.sidecar-provider',
        fallbackToBuiltin: false,
      });

      expect(opened).toMatchObject({
        ok: true,
        data: {
          selectedAdapterKind: 'provider',
          selectedProviderId: 'test.sidecar-provider',
          selectedInputId: 'sidecar-decoder',
          providerSessionId: 'provider-session-42',
        },
      });

      const sessionId = (opened as { ok: true; data: { sessionId: string } }).data.sessionId;

      const closed = await api.host.invokeCapability('foundation.audio-input-adapter', 'closeSession', {
        sessionId,
      });
      expect(closed).toMatchObject({
        ok: true,
        data: {
          sessionId,
          closed: true,
          adapterKind: 'provider',
          adapterId: 'test.sidecar-provider',
        },
      });

      const commands = invokeFn.mock.calls.map((call) => call[0]);
      expect(commands).toContain('decoder_sidecar_test_describe_provider');
      expect(commands).toContain('decoder_sidecar_test_probe');
      expect(commands).toContain('decoder_sidecar_test_open_session');
      expect(commands).toContain('decoder_sidecar_test_close_session');
    } finally {
      unregister();
    }
  });

  it('falls back to builtin adapter when sidecar command is unavailable', async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};

    const invokeFn = vi.fn(async (command: string) => {
      if (command.endsWith('_describe_provider')) {
        throw new Error('unknown command native_audio_decoder_sidecar_describe_provider');
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const selectAudioInput = vi.fn(async () => true);

    const unregister = registerAudioInputAdapterSidecarProvider({
      info: {
        id: 'test.sidecar-missing-command',
        name: 'Missing Command Sidecar',
        version: '0.1.0',
        protocolVersion: '1.0.0',
      },
      setAsDefault: true,
      invokeFn,
    });

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
        audioService: createTestAudioService({
          listAudioInputs: async () => ['symphonia', 'rodio'],
          selectAudioInput,
        }),
        navigation: { navigateTo: () => {}, goBack: () => {} } satisfies HostNavigation,
      });

      const health = await api.host.invokeCapability('foundation.audio-input-adapter', 'health', {
        providerId: 'test.sidecar-missing-command',
      });

      expect(health).toMatchObject({
        ok: true,
        data: {
          providerId: 'test.sidecar-missing-command',
          ready: false,
          status: 'offline',
        },
      });

      const opened = await api.host.invokeCapability('foundation.audio-input-adapter', 'openSession', {
        sourcePath: 'C:/Music/fallback.flac',
        providerId: 'test.sidecar-missing-command',
      });

      expect(selectAudioInput).toHaveBeenCalledWith('symphonia');
      expect(opened).toMatchObject({
        ok: true,
        data: {
          selectedAdapterKind: 'builtin',
          selectedInputId: 'symphonia',
          fallbackFromProvider: {
            providerId: 'test.sidecar-missing-command',
          },
        },
      });
    } finally {
      unregister();
    }
  });
});

