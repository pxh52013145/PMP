#!/usr/bin/env node

import os from 'node:os';
import readline from 'node:readline';

const BRIDGE_VERSION = '1.0';
const pluginId = process.env.PXP_PLUGIN_ID ?? 'utils';
const runtimeId = process.env.PXP_RUNTIME_ID ?? 'sidecar.main';
const runtimeInstanceId = process.env.PXP_RUNTIME_INSTANCE_ID ?? `utils-sidecar-${process.pid}`;
const commandId = process.env.PXP_COMMAND_ID ?? 'utils.probe.system';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function createRequestId(stage) {
  return `${commandId}:${stage}`;
}

function readError(error) {
  if (!error || typeof error !== 'object') {
    return { message: String(error) };
  }

  return {
    code: typeof error.code === 'string' ? error.code : 'ERROR',
    message: typeof error.message === 'string' ? error.message : 'Unknown error',
  };
}

function isoNow() {
  return new Date().toISOString();
}

function createSystemSnapshot() {
  return {
    pid: process.pid,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    hostname: os.hostname(),
    cpuCount: Array.isArray(os.cpus()) ? os.cpus().length : 0,
    uptimeSeconds: Math.floor(os.uptime()),
    nodeVersion: process.version,
  };
}

let workflow = null;

function emitCommandResult(result, extra = {}) {
  send({
    bridgeVersion: BRIDGE_VERSION,
    op: 'runtime.event',
    pluginId,
    runtimeId,
    runtimeInstanceId,
    eventName: 'command.result',
    payload: {
      ok: true,
      commandId,
      result,
      ...extra,
    },
  });
}

function persistResult(result) {
  workflow = {
    phase: 'persist',
    requestId: createRequestId('persist'),
    result,
  };

  send({
    protocolVersion: BRIDGE_VERSION,
    op: 'capability.invoke.request',
    requestId: workflow.requestId,
    capabilityId: 'host.pmp.storage.config',
    method: 'patch',
    payload: {
      lastRun: result,
    },
  });
}

function beginProbe() {
  if (commandId === 'utils.probe.system') {
    workflow = {
      phase: 'probe',
      requestId: createRequestId('probe'),
      probe: 'system',
    };

    send({
      protocolVersion: BRIDGE_VERSION,
      op: 'capability.invoke.request',
      requestId: workflow.requestId,
      capabilityId: 'core.capability-registry',
      method: 'list',
    });
    return;
  }

  if (commandId === 'utils.probe.windows') {
    workflow = {
      phase: 'probe',
      requestId: createRequestId('probe'),
      probe: 'windows',
    };

    send({
      protocolVersion: BRIDGE_VERSION,
      op: 'capability.invoke.request',
      requestId: workflow.requestId,
      capabilityId: 'host.pmp.shell.window',
      method: 'describe',
    });
    return;
  }

  persistResult({
    commandId,
    probe: 'unknown',
    timestamp: isoNow(),
    summary: 'Unknown sidecar command',
    sidecar: createSystemSnapshot(),
  });
}

function handleProbeResponse(message) {
  if (!workflow || workflow.phase !== 'probe') {
    return;
  }

  const result = {
    commandId,
    probe: workflow.probe,
    timestamp: isoNow(),
    summary:
      workflow.probe === 'system'
        ? 'Captured native-sidecar system snapshot'
        : 'Captured host shell.window capability snapshot',
    sidecar: createSystemSnapshot(),
    host: null,
  };

  if (workflow.probe === 'system') {
    const capabilityIds =
      message.ok === true && Array.isArray(message.data)
        ? message.data
            .map((entry) => (entry && typeof entry.id === 'string' ? entry.id : null))
            .filter((entry) => typeof entry === 'string')
        : [];

    result.host = {
      visibleCapabilityCount: capabilityIds.length,
      sampleCapabilities: capabilityIds.slice(0, 12),
      registryVisible: message.ok === true,
      registryError: message.ok === true ? null : readError(message.error),
    };
  } else {
    const data =
      message.ok === true && message.data && typeof message.data === 'object' ? message.data : null;

    result.host = {
      shellWindowBridge: data,
      bridgeVisible: message.ok === true,
      bridgeError: message.ok === true ? null : readError(message.error),
    };
  }

  persistResult(result);
}

function handlePersistResponse(message) {
  if (!workflow || workflow.phase !== 'persist') {
    return;
  }

  const result = workflow.result;
  workflow = null;
  emitCommandResult(result, {
    configPersisted: message.ok === true,
    configError: message.ok === true ? null : readError(message.error),
  });
}

send({
  bridgeVersion: BRIDGE_VERSION,
  op: 'runtime.hello',
  pluginId,
  runtimeId,
  runtimeInstanceId,
  supportedBridgeVersions: [BRIDGE_VERSION],
  runtimeKind: 'sidecar',
  carrier: 'native-process',
  supportsViewMount: false,
  supportedDataPlanes: ['pipe'],
});

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  const message = JSON.parse(line);

  if (message.op === 'runtime.init') {
    send({
      bridgeVersion: BRIDGE_VERSION,
      op: 'runtime.init.ack',
      pluginId,
      runtimeId,
      runtimeInstanceId,
    });
    return;
  }

  if (message.op === 'runtime.activate') {
    if (commandId === 'utils.simulate.hang') {
      return;
    }

    send({
      bridgeVersion: BRIDGE_VERSION,
      op: 'runtime.activate.ack',
      pluginId,
      runtimeId,
      runtimeInstanceId,
    });

    if (commandId === 'utils.simulate.crash') {
      send({
        bridgeVersion: BRIDGE_VERSION,
        op: 'runtime.error',
        pluginId,
        runtimeId,
        runtimeInstanceId,
        fatal: true,
        message: 'utils sidecar forced fatal crash drill',
      });
      return;
    }

    beginProbe();
    return;
  }

  if (message.op === 'capability.invoke.response') {
    if (workflow && workflow.phase === 'probe' && message.requestId === workflow.requestId) {
      handleProbeResponse(message);
      return;
    }

    if (workflow && workflow.phase === 'persist' && message.requestId === workflow.requestId) {
      handlePersistResponse(message);
    }
  }
});
