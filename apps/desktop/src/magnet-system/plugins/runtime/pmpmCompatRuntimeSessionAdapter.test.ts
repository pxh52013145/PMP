import { describe, expect, it } from 'vitest';
import type {
  RuntimeActivate,
  RuntimeHealthResponse,
  RuntimeHello,
  RuntimeInit,
} from '@pixel-matrix/plugin-platform-contracts';
import {
  createPmpmCompatRuntimeSessionAdapter,
} from './pmpmCompatRuntimeSessionAdapter';

function createRuntimeHello(): RuntimeHello {
  return {
    bridgeVersion: 'compat.pmpm.bridge.v1',
    op: 'runtime.hello',
    pluginId: 'view-plugin',
    runtimeId: 'compat.pmpm.main',
    runtimeInstanceId: 'frame-1',
    supportedBridgeVersions: ['compat.pmpm.bridge.v1'],
    runtimeKind: 'webview',
    carrier: 'webview-frame',
    supportsViewMount: true,
    supportedDataPlanes: ['inline-json'],
  };
}

function createRuntimeInit(): RuntimeInit {
  return {
    bridgeVersion: 'compat.pmpm.bridge.v1',
    op: 'runtime.init',
    pluginId: 'view-plugin',
    runtimeId: 'compat.pmpm.main',
    runtimeInstanceId: 'frame-1',
    hostId: 'pmp',
    trustLevel: 'sandboxed',
    grantedCapabilities: [],
  };
}

function createRuntimeActivate(): RuntimeActivate {
  return {
    bridgeVersion: 'compat.pmpm.bridge.v1',
    op: 'runtime.activate',
    pluginId: 'view-plugin',
    runtimeId: 'compat.pmpm.main',
    runtimeInstanceId: 'frame-1',
    cause: 'view',
    payload: {
      surface: 'page',
      surfaceId: 'demo-page',
    },
  };
}

function createRuntimeHealth(): RuntimeHealthResponse {
  return {
    bridgeVersion: 'compat.pmpm.bridge.v1',
    op: 'runtime.health.response',
    pluginId: 'view-plugin',
    runtimeId: 'compat.pmpm.main',
    runtimeInstanceId: 'frame-1',
    requestId: 'health-1',
    ready: true,
    status: 'healthy',
  };
}

describe('pmpm compat runtime session adapter', () => {
  it('adapts iframe lifecycle and runtime events onto runtime bridge messages', async () => {
    const sentCompatMessages: unknown[] = [];
    const adapter = createPmpmCompatRuntimeSessionAdapter({
      runtimeHello: createRuntimeHello(),
      runtimeHealth: createRuntimeHealth(),
      hostLabel: 'PluginSandbox',
      surface: 'page',
      surfaceId: 'demo-page',
      permissions: ['api:navigation'],
      entryCode: 'export function mount() {}',
      initialConfig: { enabled: true },
      postCompatMessage: (message) => {
        sentCompatMessages.push(message);
      },
    });

    const receivedMessages: unknown[] = [];
    const unsubscribe = adapter.port.onMessage((message) => {
      receivedMessages.push(message);
    });

    adapter.handleCompatMessage({
      frameId: 'frame-1',
      type: 'pmpm:iframe-ready',
    });
    expect(receivedMessages[0]).toMatchObject({
      op: 'runtime.hello',
      pluginId: 'view-plugin',
    });

    await adapter.port.postMessage(createRuntimeInit());
    expect(receivedMessages[1]).toMatchObject({
      op: 'runtime.init.ack',
    });

    await adapter.port.postMessage(createRuntimeActivate());
    expect(sentCompatMessages[0]).toMatchObject({
      type: 'pmpm:init',
      pluginId: 'view-plugin',
      surface: 'page',
      surfaceId: 'demo-page',
    });

    await adapter.port.postMessage({
      ...createRuntimeHello(),
      op: 'runtime.event',
      eventName: 'audio.load-progress',
      payload: { progress: 0.5 },
      emittedAt: 123,
    });
    expect(sentCompatMessages[1]).toMatchObject({
      type: 'pmpm:event',
      name: 'audio.loadProgress',
      payload: { progress: 0.5 },
    });

    adapter.handleCompatMessage({
      frameId: 'frame-1',
      type: 'pmpm:permission-denied',
      pluginId: 'view-plugin',
      hostLabel: 'PluginSandbox',
      capability: 'api:navigation',
      action: 'navigation.navigateTo()',
    });
    expect(receivedMessages[2]).toMatchObject({
      op: 'runtime.event',
      eventName: 'permission.denied',
      payload: {
        capability: 'api:navigation',
        action: 'navigation.navigateTo()',
      },
    });

    adapter.handleCompatMessage({
      frameId: 'frame-1',
      type: 'pmpm:mounted',
    });
    expect(receivedMessages[3]).toMatchObject({
      op: 'runtime.activate.ack',
    });

    unsubscribe();
  });
});
