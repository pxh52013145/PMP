import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../../i18n/core';
import { buildPmpmSandboxSrcDoc } from './pmpmSandboxSrcDoc';
import * as hostApiModule from './host-api';
import {
  buildPmpmRuntimeActivateSnapshot,
  buildPmpmRuntimeCapabilityRevokeDrillSnapshot,
  buildPmpmRuntimeHealthSnapshot,
  buildPmpmRuntimeHelloSnapshot,
  buildPmpmRuntimeInitSnapshot,
  buildPmpmViewMountRequestSnapshot,
} from './pmpmRuntimeBridgeSnapshot';

afterEach(() => {
  setLocale('zh-CN');
  vi.restoreAllMocks();
});

describe('pmpm runtime bridge snapshot', () => {
  it('builds a runtime.init snapshot from PMPM startup state', () => {
    setLocale('en-US');

    const snapshot = buildPmpmRuntimeInitSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
      permissions: ['api:host', 'api:navigation', 'net:fetch', 'api:navigation'],
      startupTimeoutMs: 5000,
      heartbeatIntervalMs: 1500,
      unresponsiveTimeoutMs: 8000,
    });

    expect(snapshot).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.init',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      hostId: 'pmp',
      hostVersion: expect.any(String),
      trustLevel: 'sandboxed',
      grantedCapabilities: [
        {
          capabilityId: 'core.capability-registry',
          version: '1.1.0',
          mode: 'required',
        },
        {
          capabilityId: 'host.pmp.navigation',
          version: '1.0.0',
          mode: 'optional',
        },
        {
          capabilityId: 'compat.pmpm.permission.net-fetch',
          version: 'compat.pmpm.v1',
          mode: 'optional',
        },
      ],
      runtimePolicy: {
        startupTimeoutMs: 5000,
        heartbeatIntervalMs: 1500,
        unresponsiveTimeoutMs: 8000,
      },
      locale: {
        active: 'en-US',
        fallback: 'zh-CN',
      },
    });
  });

  it('exposes runtime.init snapshots through the iframe sandbox host facade', () => {
    const srcdoc = buildPmpmSandboxSrcDoc('frame-1');

    expect(srcdoc).toContain('let runtimeHelloSnapshot = null;');
    expect(srcdoc).toContain('let runtimeInitSnapshot = null;');
    expect(srcdoc).toContain('let runtimeActivateSnapshot = null;');
    expect(srcdoc).toContain('let runtimeHealthSnapshot = null;');
    expect(srcdoc).toContain('let viewMountRequestSnapshot = null;');
    expect(srcdoc).toContain('let runtimeRevokeSnapshot = null;');
    expect(srcdoc).toContain('let runtimeRevokeAckSnapshot = null;');
    expect(srcdoc).toContain('host.getRuntimeHelloSnapshot()');
    expect(srcdoc).toContain('host.getRuntimeInitSnapshot()');
    expect(srcdoc).toContain('host.getRuntimeActivateSnapshot()');
    expect(srcdoc).toContain('host.getRuntimeHealthSnapshot()');
    expect(srcdoc).toContain('host.getViewMountRequestSnapshot()');
    expect(srcdoc).toContain('host.getRuntimeRevokeSnapshot()');
    expect(srcdoc).toContain('host.getRuntimeRevokeAckSnapshot()');
    expect(srcdoc).toContain(
      "data.runtimeHello && typeof data.runtimeHello === 'object' ? data.runtimeHello : null"
    );
    expect(srcdoc).toContain(
      "data.runtimeInit && typeof data.runtimeInit === 'object' ? data.runtimeInit : null"
    );
    expect(srcdoc).toContain("data.runtimeActivate && typeof data.runtimeActivate === 'object'");
    expect(srcdoc).toContain("data.runtimeHealth && typeof data.runtimeHealth === 'object'");
    expect(srcdoc).toContain("data.viewMountRequest && typeof data.viewMountRequest === 'object'");
    expect(srcdoc).toContain("if (data.type === 'pmpm:capabilities-revoke')");
    expect(srcdoc).toContain("type: 'pmpm:capabilities-revoke-ack'");
  });

  it('builds runtime.hello snapshots for view and command compat carriers', () => {
    expect(
      buildPmpmRuntimeHelloSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'frame-1',
        runtimeKind: 'webview',
        carrier: 'webview-frame',
        supportsViewMount: true,
      })
    ).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.hello',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      supportedBridgeVersions: ['compat.pmpm.bridge.v1'],
      runtimeKind: 'webview',
      carrier: 'webview-frame',
      supportsViewMount: true,
      supportedDataPlanes: ['inline-json'],
    });

    expect(
      buildPmpmRuntimeHelloSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'worker-1',
        runtimeKind: 'extension-host',
        carrier: 'dedicated-worker',
        supportsViewMount: false,
      })
    ).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.hello',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'worker-1',
      supportedBridgeVersions: ['compat.pmpm.bridge.v1'],
      runtimeKind: 'extension-host',
      carrier: 'dedicated-worker',
      supportsViewMount: false,
      supportedDataPlanes: ['inline-json'],
    });
  });

  it('builds a healthy runtime.health.response snapshot for compat runtimes', () => {
    const snapshot = buildPmpmRuntimeHealthSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
    });

    expect(snapshot).toMatchObject({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.health.response',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      requestId: 'runtime-health:frame-1',
      ready: true,
      status: 'healthy',
    });
    expect(snapshot.message).toBeUndefined();
  });

  it('builds runtime.activate and view.mount.request snapshots for view surfaces', () => {
    const activate = buildPmpmRuntimeActivateSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
      kind: 'page',
      surfaceId: 'demo-page',
    });
    const mountRequest = buildPmpmViewMountRequestSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
      kind: 'page',
      surfaceId: 'demo-page',
    });

    expect(activate).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.activate',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      cause: 'view',
      payload: {
        surface: 'page',
        surfaceId: 'demo-page',
      },
    });
    expect(mountRequest).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'view.mount.request',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      requestId: 'view-mount:frame-1:page:demo-page',
      viewInstanceId: 'frame-1:page:demo-page',
      viewId: 'demo-page',
      viewType: 'page',
      surfaceSlot: 'host.pmp.surface.page',
      props: {
        surface: 'page',
        surfaceId: 'demo-page',
      },
    });
  });

  it('builds runtime.activate without view.mount.request for command surfaces', () => {
    const activate = buildPmpmRuntimeActivateSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
      kind: 'command',
      surfaceId: 'refresh-library',
      commandArgs: { force: true },
    });

    expect(activate).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.activate',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      cause: 'command',
      payload: {
        surface: 'command',
        surfaceId: 'refresh-library',
        commandId: 'refresh-library',
        args: { force: true },
      },
    });
    expect(
      buildPmpmViewMountRequestSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'frame-1',
        kind: 'command',
        surfaceId: 'refresh-library',
        commandArgs: { force: true },
      })
    ).toBeNull();
  });

  it('derives required/optional capability modes from permissions and manifest hints', () => {
    const snapshot = buildPmpmRuntimeInitSnapshot({
      pluginId: 'demo-plugin',
      runtimeInstanceId: 'frame-1',
      permissions: ['api:host', 'api:navigation', 'api:audio-control'],
      manifestPermissions: ['api:host', 'api:navigation', 'api:audio-control'],
      deniedPermissions: ['api:audio-control'],
      requiredPermissions: ['api:host'],
      optionalPermissions: ['api:navigation'],
    });

    expect(snapshot.grantedCapabilities).toEqual([
      {
        capabilityId: 'core.capability-registry',
        version: '1.1.0',
        mode: 'required',
      },
      {
        capabilityId: 'host.pmp.navigation',
        version: '1.0.0',
        mode: 'optional',
      },
    ]);
  });

  it('builds runtime.capabilities.revoke compat drill snapshots', () => {
    expect(
      buildPmpmRuntimeCapabilityRevokeDrillSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'frame-1',
        capabilityIds: ['host.pmp.navigation'],
      })
    ).toEqual({
      bridgeVersion: 'compat.pmpm.bridge.v1',
      op: 'runtime.capabilities.revoke',
      pluginId: 'demo-plugin',
      runtimeId: 'compat.pmpm.main',
      runtimeInstanceId: 'frame-1',
      requestId: 'runtime-capability-revoke:frame-1',
      capabilityIds: ['host.pmp.navigation'],
      reason: 'compat-drill:no-op',
    });
  });

  it('fails runtime.init negotiation when host pack families drift from exported families', () => {
    vi.spyOn(hostApiModule, 'getPmpHostCapabilityPackDescriptor').mockReturnValue({
      hostId: 'pmp',
      packVersion: '1.0.0',
      coreCompatibility: 'core.contracts@2.0',
      capabilityFamilies: ['host.pmp.navigation'],
    });
    vi.spyOn(hostApiModule, 'listPmpHostCapabilityFamilies').mockReturnValue([
      'host.pmp.navigation',
      'host.pmp.audio-engine.playback',
    ]);

    expect(() =>
      buildPmpmRuntimeInitSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'frame-1',
        permissions: ['api:navigation'],
      })
    ).toThrow('Host capability pack negotiation failed');
  });

  it('fails runtime.init negotiation when a mapped host capability is not registered', () => {
    vi.spyOn(hostApiModule, 'listPluginHostCapabilities').mockReturnValue([
      {
        id: 'core.capability-registry',
        version: '1.1.0',
      },
    ]);

    expect(() =>
      buildPmpmRuntimeInitSnapshot({
        pluginId: 'demo-plugin',
        runtimeInstanceId: 'frame-1',
        permissions: ['api:navigation'],
      })
    ).toThrow('is not registered');
  });
});
