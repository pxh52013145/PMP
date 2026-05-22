'use strict';

const BRIDGE_VERSION = '1.0';
const PROTOCOL_VERSION = '1.0';
const DEFAULT_PLUGIN_ID = 'sidecar-echo-demo';
const DEFAULT_RUNTIME_ID = 'sidecar.echo';

const pluginId = process.env.PXP_PLUGIN_ID || DEFAULT_PLUGIN_ID;
const runtimeId = process.env.PXP_RUNTIME_ID || DEFAULT_RUNTIME_ID;
const runtimeInstanceId =
  process.env.PXP_RUNTIME_INSTANCE_ID || `${pluginId}:runtime:${process.pid}`;

let bufferedInput = '';
let pendingCapabilityRequestId = null;
let activated = false;

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function runtimeEnvelope(op, fields = {}) {
  return {
    bridgeVersion: BRIDGE_VERSION,
    op,
    pluginId,
    runtimeId,
    runtimeInstanceId,
    ...fields,
  };
}

function sendHello() {
  writeMessage(
    runtimeEnvelope('runtime.hello', {
      supportedBridgeVersions: [BRIDGE_VERSION],
      runtimeKind: 'sidecar',
      carrier: 'native-process',
      supportsViewMount: false,
      supportedDataPlanes: ['pipe'],
    })
  );
}

function sendCapabilityListRequest(traceId) {
  pendingCapabilityRequestId = `capability:${Date.now()}:${Math.random()
    .toString(16)
    .slice(2)}`;
  writeMessage({
    protocolVersion: PROTOCOL_VERSION,
    op: 'capability.invoke.request',
    requestId: pendingCapabilityRequestId,
    traceId,
    pluginId,
    runtimeId,
    capabilityId: 'core.capability-registry',
    method: 'list',
    payload: null,
  });
}

function sendCommandResult() {
  writeMessage(
    runtimeEnvelope('runtime.event', {
      eventName: 'command.result',
      payload: { ok: true },
      sequence: Date.now(),
      emittedAt: Date.now(),
    })
  );
}

function handleMessage(message) {
  switch (message.op) {
    case 'runtime.init':
      writeMessage(
        runtimeEnvelope('runtime.init.ack', {
          requestId: message.requestId,
          traceId: message.traceId,
        })
      );
      return;
    case 'runtime.activate':
      writeMessage(
        runtimeEnvelope('runtime.activate.ack', {
          requestId: message.requestId,
          traceId: message.traceId,
        })
      );
      if (!activated) {
        activated = true;
        sendCapabilityListRequest(message.traceId);
      }
      return;
    case 'runtime.health.request':
      writeMessage(
        runtimeEnvelope('runtime.health.response', {
          requestId: message.requestId,
          traceId: message.traceId,
          ready: true,
          status: 'healthy',
        })
      );
      return;
    case 'capability.invoke.response':
      if (message.requestId === pendingCapabilityRequestId) {
        pendingCapabilityRequestId = null;
        sendCommandResult();
      }
      return;
    default:
      return;
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  bufferedInput += chunk;
  while (bufferedInput.includes('\n')) {
    const index = bufferedInput.indexOf('\n');
    const line = bufferedInput.slice(0, index).trim();
    bufferedInput = bufferedInput.slice(index + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (error) {
      writeMessage(
        runtimeEnvelope('runtime.error', {
          fatal: true,
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
});

process.stdin.resume();
sendHello();
