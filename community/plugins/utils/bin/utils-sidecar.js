#!/usr/bin/env node

import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE_VERSION = '1.0';
const pluginId = process.env.PXP_PLUGIN_ID ?? 'utils';
const runtimeId = process.env.PXP_RUNTIME_ID ?? 'sidecar.main';
const runtimeInstanceId = process.env.PXP_RUNTIME_INSTANCE_ID ?? `utils-sidecar-${process.pid}`;
const commandId = process.env.PXP_COMMAND_ID ?? 'utils.probe.system';
const commandStartedAtMs = Date.now();
const sidecarDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRootDir = path.resolve(sidecarDir, '..');
const QT_ADAPTER_RELATIVE_PATH = 'qt/UtilsAdapterProbe.qml';
const QT_ADAPTER_PATH = path.join(pluginRootDir, ...QT_ADAPTER_RELATIVE_PATH.split('/'));
const PERFORMANCE_CPU_SAMPLE_MS = 140;
const AUDIO_PLAYBACK_CAPABILITY_ID = 'host.pmp.audio-engine.playback';
const AUDIO_COMMAND_METHOD_BY_ID = {
  'utils.media.next': 'playNext',
  'utils.media.previous': 'playPrevious',
  'utils.media.toggleMute': 'toggleMute',
};

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
    schemaVersion: '1.0',
    capturedAtMs: Date.now(),
    platform: process.platform,
    arch: process.arch,
    os: {
      release: os.release(),
      uptimeSeconds: Math.floor(os.uptime()),
    },
    cpu: {
      logicalCores: Array.isArray(os.cpus()) ? os.cpus().length : 0,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
    },
    runtime: {
      pid: process.pid,
      nodeVersion: process.version,
    },
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createCpuTimesSample() {
  return os.cpus().map((cpu) => {
    const times = cpu.times || {};
    const idleMs = typeof times.idle === 'number' ? times.idle : 0;
    const totalMs = Object.values(times).reduce(
      (total, value) => total + (typeof value === 'number' ? value : 0),
      0
    );
    return {
      idleMs,
      totalMs,
    };
  });
}

function calculateCpuLoadPercent(startSample, endSample) {
  let idleDeltaMs = 0;
  let totalDeltaMs = 0;
  const sampleCount = Math.min(startSample.length, endSample.length);

  for (let index = 0; index < sampleCount; index += 1) {
    const start = startSample[index];
    const end = endSample[index];
    idleDeltaMs += Math.max(0, end.idleMs - start.idleMs);
    totalDeltaMs += Math.max(0, end.totalMs - start.totalMs);
  }

  if (totalDeltaMs <= 0) {
    return null;
  }

  return Math.max(0, Math.min(100, (1 - idleDeltaMs / totalDeltaMs) * 100));
}

function createNetworkSnapshot() {
  const interfaces = os.networkInterfaces();
  let interfaceCount = 0;
  let addressCount = 0;
  let internalAddressCount = 0;
  let externalAddressCount = 0;
  const familyCounts = {};

  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }

    interfaceCount += 1;
    for (const entry of entries) {
      addressCount += 1;
      const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
      familyCounts[family] = (familyCounts[family] || 0) + 1;
      if (entry.internal) {
        internalAddressCount += 1;
      } else {
        externalAddressCount += 1;
      }
    }
  }

  return {
    interfaceCount,
    addressCount,
    internalAddressCount,
    externalAddressCount,
    familyCounts,
    addressesRedacted: true,
  };
}

async function createPerformanceSnapshot() {
  const cpuStart = createCpuTimesSample();
  await delay(PERFORMANCE_CPU_SAMPLE_MS);
  const cpuEnd = createCpuTimesSample();
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const processMemory = process.memoryUsage();

  return {
    schemaVersion: '1.0',
    capturedAtMs: Date.now(),
    platform: process.platform,
    arch: process.arch,
    sample: {
      cpuSampleMs: PERFORMANCE_CPU_SAMPLE_MS,
      mode: 'coarse-command-snapshot',
    },
    cpu: {
      logicalCores: cpuEnd.length,
      loadPercent: calculateCpuLoadPercent(cpuStart, cpuEnd),
    },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes,
      usedPercent: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : null,
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      rssBytes: processMemory.rss,
      heapTotalBytes: processMemory.heapTotal,
      heapUsedBytes: processMemory.heapUsed,
      externalBytes: processMemory.external,
    },
    network: createNetworkSnapshot(),
  };
}

async function pathExists(candidatePath) {
  try {
    await fs.access(candidatePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isExecutableAvailable(commandName) {
  const pathValue = process.env.PATH || '';
  const pathExts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
          .split(';')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : [''];

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of pathExts) {
      const candidate =
        process.platform === 'win32' && path.extname(commandName)
          ? path.join(dir, commandName)
          : path.join(dir, `${commandName}${ext}`);
      if (await pathExists(candidate)) {
        return true;
      }
    }
  }

  return false;
}

async function createQtAdapterSnapshot() {
  let qmlBytes = null;
  let artifactError = null;

  try {
    qmlBytes = await fs.readFile(QT_ADAPTER_PATH);
  } catch (error) {
    artifactError = readError(error);
  }

  const qmlText = qmlBytes ? qmlBytes.toString('utf8') : '';
  const qmlImports = Array.from(qmlText.matchAll(/^\s*import\s+([^\r\n]+)/gm)).map((match) =>
    match[1].trim()
  );

  const executableProbe = {
    qml: await isExecutableAvailable('qml'),
    qml6: await isExecutableAvailable('qml6'),
    qmlscene: await isExecutableAvailable('qmlscene'),
    qmlscene6: await isExecutableAvailable('qmlscene6'),
  };

  return {
    schemaVersion: '1.0',
    capturedAtMs: Date.now(),
    adapter: {
      id: 'utils.qt.adapter',
      lane: 'sidecar-native-adapter',
      status: qmlBytes ? 'contract-ready' : 'missing-artifact',
      language: 'qml',
      uiCarrier: false,
      sidecarOwnsHostVisibleUi: false,
      supportedSurfaces: ['command'],
      hostSurfaceManagerRequiredForUi: true,
      lifecycle: [
        'runtime.hello',
        'runtime.init',
        'runtime.activate',
        'capability.invoke',
        'runtime.dispose',
      ],
    },
    artifact: {
      relativePath: QT_ADAPTER_RELATIVE_PATH,
      present: Boolean(qmlBytes),
      byteLength: qmlBytes ? qmlBytes.byteLength : 0,
      sha256: qmlBytes ? crypto.createHash('sha256').update(qmlBytes).digest('hex') : null,
      error: artifactError,
    },
    qtRuntime: {
      executableProbe,
      executablePathRedacted: true,
      launchMode: 'not-launched',
      reason: 'V1 probes the Qt adapter contract only; it does not create a top-level Qt window.',
    },
    boundaries: {
      qmlUiCarrierEnabled: false,
      sidecarTopLevelWindowAllowed: false,
      generalFilesystemCapability: false,
      devSessionMayOverrideRuntimeSourceOnly: true,
    },
    qml: {
      imports: qmlImports,
      declaresVisibleWindow: /\bWindow\s*\{/.test(qmlText) || /\bApplicationWindow\s*\{/.test(qmlText),
      declaresQtObject: /\bQtObject\s*\{/.test(qmlText),
    },
  };
}

let workflow = null;

function createResponseEnvelope(result, extra = {}) {
  return {
    ok: true,
    protocolVersion: BRIDGE_VERSION,
    requestId: createRequestId('result'),
    command: commandId,
    data: result,
    durationMs: Math.max(0, Date.now() - commandStartedAtMs),
    ...(Array.isArray(extra.warnings) && extra.warnings.length > 0 ? { warnings: extra.warnings } : {}),
  };
}

function isAudioCommand() {
  return (
    commandId === 'utils.media.playPause' ||
    Object.prototype.hasOwnProperty.call(AUDIO_COMMAND_METHOD_BY_ID, commandId)
  );
}

function readAudioPlaybackState(value) {
  return value && typeof value === 'object' && typeof value.playbackState === 'string'
    ? value.playbackState
    : null;
}

function createAudioResult(action, message) {
  const ok = message.ok === true;
  return {
    commandId,
    probe: 'audio-control',
    timestamp: isoNow(),
    summary: ok
      ? `Requested PMP audio ${action}`
      : `PMP audio ${action} request failed`,
    sidecar: createSystemSnapshot(),
    audio: {
      capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
      method: action,
      ok,
      error: ok ? null : readError(message.error),
    },
  };
}

function requestAudioAction(action, options = {}) {
  workflow = {
    phase: 'audio-control',
    requestId: createRequestId(`audio-${action}`),
    action,
    previousPlaybackState:
      typeof options.previousPlaybackState === 'string' ? options.previousPlaybackState : null,
  };

  send({
    protocolVersion: BRIDGE_VERSION,
    op: 'capability.invoke.request',
    requestId: workflow.requestId,
    capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
    method: action,
  });
}

function emitCommandResult(envelope, extra = {}) {
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
      envelope,
      ...extra,
    },
  });
}

function persistResult(result, extra = {}) {
  const envelope = createResponseEnvelope(result, extra);
  workflow = {
    phase: 'persist',
    requestId: createRequestId('persist'),
    envelope,
  };

  send({
    protocolVersion: BRIDGE_VERSION,
    op: 'capability.invoke.request',
    requestId: workflow.requestId,
    capabilityId: 'host.pmp.storage.config',
    method: 'patch',
    payload: {
      lastRun: envelope,
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

  if (commandId === 'utils.probe.performance') {
    workflow = {
      phase: 'performance',
      requestId: createRequestId('performance'),
    };

    void createPerformanceSnapshot()
      .then((performance) => {
        if (!workflow || workflow.phase !== 'performance') {
          return;
        }
        persistResult({
          commandId,
          probe: 'performance',
          timestamp: isoNow(),
          summary: 'Captured coarse system performance snapshot',
          sidecar: createSystemSnapshot(),
          performance,
        });
      })
      .catch((error) => {
        if (!workflow || workflow.phase !== 'performance') {
          return;
        }
        persistResult(
          {
            commandId,
            probe: 'performance',
            timestamp: isoNow(),
            summary: 'System performance probe failed',
            sidecar: createSystemSnapshot(),
          },
          {
            warnings: [
              {
                code: 'performance-probe-failed',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          }
        );
      });
    return;
  }

  if (commandId === 'utils.probe.qt.adapter') {
    workflow = {
      phase: 'qt-adapter',
      requestId: createRequestId('qt-adapter'),
    };

    void createQtAdapterSnapshot()
      .then((qtAdapter) => {
        if (!workflow || workflow.phase !== 'qt-adapter') {
          return;
        }
        persistResult({
          commandId,
          probe: 'qt-adapter',
          timestamp: isoNow(),
          summary: qtAdapter.artifact.present
            ? 'Captured Qt/QML adapter contract snapshot'
            : 'Qt/QML adapter contract artifact is missing',
          sidecar: createSystemSnapshot(),
          qtAdapter,
        });
      })
      .catch((error) => {
        if (!workflow || workflow.phase !== 'qt-adapter') {
          return;
        }
        persistResult(
          {
            commandId,
            probe: 'qt-adapter',
            timestamp: isoNow(),
            summary: 'Qt/QML adapter contract probe failed',
            sidecar: createSystemSnapshot(),
          },
          {
            warnings: [
              {
                code: 'qt-adapter-probe-failed',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          }
        );
      });
    return;
  }

  if (isAudioCommand()) {
    if (commandId === 'utils.media.playPause') {
      workflow = {
        phase: 'audio-state',
        requestId: createRequestId('audio-state'),
      };

      send({
        protocolVersion: BRIDGE_VERSION,
        op: 'capability.invoke.request',
        requestId: workflow.requestId,
        capabilityId: AUDIO_PLAYBACK_CAPABILITY_ID,
        method: 'getState',
      });
      return;
    }

    requestAudioAction(AUDIO_COMMAND_METHOD_BY_ID[commandId]);
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

function handleAudioStateResponse(message) {
  if (!workflow || workflow.phase !== 'audio-state') {
    return;
  }

  if (message.ok !== true) {
    persistResult(createAudioResult('playPause', message), {
      warnings: [
        {
          code: 'audio-state-read-failed',
          message: readError(message.error).message,
        },
      ],
    });
    return;
  }

  const playbackState = readAudioPlaybackState(message.data);
  requestAudioAction(playbackState === 'playing' ? 'pause' : 'play', {
    previousPlaybackState: playbackState,
  });
}

function handleAudioControlResponse(message) {
  if (!workflow || workflow.phase !== 'audio-control') {
    return;
  }

  const action = workflow.action;
  const previousPlaybackState = workflow.previousPlaybackState;
  const result = createAudioResult(action, message);
  persistResult({
    ...result,
    audio: {
      ...result.audio,
      previousPlaybackState,
    },
  });
}

function handlePersistResponse(message) {
  if (!workflow || workflow.phase !== 'persist') {
    return;
  }

  const envelope = workflow.envelope;
  workflow = null;
  emitCommandResult(envelope, {
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

    if (workflow && workflow.phase === 'audio-state' && message.requestId === workflow.requestId) {
      handleAudioStateResponse(message);
      return;
    }

    if (workflow && workflow.phase === 'audio-control' && message.requestId === workflow.requestId) {
      handleAudioControlResponse(message);
      return;
    }

    if (workflow && workflow.phase === 'persist' && message.requestId === workflow.requestId) {
      handlePersistResponse(message);
    }
  }
});
