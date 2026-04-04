import { strToU8, zip } from 'fflate';
import type { AsyncZippable } from 'fflate';
import type { PmpmManifest } from '@pixel-matrix/plugin-compat-pmpm';
import { installPmpmPluginFromZipBytes } from './pmpm';

export const STREAM_PROTOCOL_DEMO_PLUGIN_ID = 'stream-protocol-demo';
export const STREAM_PROTOCOL_DEMO_VISUALIZER_ID = 'stream-protocol-lab';

const STREAM_PROTOCOL_DEMO_ENTRY_PATH = 'dist/index.js';

const STREAM_PROTOCOL_DEMO_MANIFEST: PmpmManifest = {
  formatVersion: '1.0',
  type: 'magnet-plugin',
  metadata: {
    id: STREAM_PROTOCOL_DEMO_PLUGIN_ID,
    name: 'Stream Protocol Demo',
    version: '0.1.0',
    author: 'PMP Dev Runtime',
    description:
      'Runtime protocol demo plugin that exercises host.openStream, host.openSession, and runtime crash cleanup.',
    tags: ['demo', 'protocol', 'stream', 'runtime'],
  },
  entryPoint: STREAM_PROTOCOL_DEMO_ENTRY_PATH,
  permissions: ['api:host', 'api:host-capability', 'api:audio-visual', 'api:audio-input-adapter'],
  contributions: {
    visualizers: [
      {
        kind: 'visualizer',
        id: STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
        title: 'Stream Protocol Lab',
        description: 'Open a real host stream, inspect frames, and test runtime cleanup.',
        inputs: ['pre-dsp', 'post-dsp'],
      },
    ],
  },
};

const STREAM_PROTOCOL_DEMO_ENTRY_CODE = String.raw`const DEMO_PLUGIN_ID = 'stream-protocol-demo';
const DEMO_VISUALIZER_ID = 'stream-protocol-lab';
const AUDIO_INPUT_CAPABILITY_ID = 'host.pmp.audio-engine.input';
const AUDIO_ANALYSIS_CAPABILITY_ID = 'host.pmp.audio-engine.analysis';
const AUDIO_INPUT_SOURCE_PATH = 'D:/pixel-matrix-player-demo/demo.flac';

function readErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function readBinsPreview(frame) {
  if (!frame || !frame.bins) return '-';
  try {
    return Array.from(frame.bins).slice(0, 8).join(', ');
  } catch {
    return '-';
  }
}

function createRoot(container) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.padding = '12px';
  root.style.borderRadius = '12px';
  root.style.background =
    'linear-gradient(180deg, rgba(12,17,28,0.94) 0%, rgba(22,31,49,0.92) 100%)';
  root.style.color = '#e8f1ff';
  root.style.fontFamily = '"Segoe UI", "PingFang SC", sans-serif';
  root.style.overflow = 'hidden';
  container.innerHTML = '';
  container.appendChild(root);
  return root;
}

function createLabelValueRow(label, value) {
  const row = document.createElement('div');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '120px minmax(0, 1fr)';
  row.style.gap = '8px';
  row.style.alignItems = 'start';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.opacity = '0.72';
  labelEl.style.fontSize = '12px';
  labelEl.style.letterSpacing = '0.02em';

  const valueEl = document.createElement('div');
  valueEl.textContent = value;
  valueEl.style.fontSize = '12px';
  valueEl.style.wordBreak = 'break-word';

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return { row, valueEl };
}

function createButton(label, onClick, options) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.border = '1px solid rgba(255,255,255,0.16)';
  button.style.borderRadius = '999px';
  button.style.padding = '8px 12px';
  button.style.background = options && options.danger ? 'rgba(140, 33, 33, 0.32)' : 'rgba(255,255,255,0.08)';
  button.style.color = '#f7fbff';
  button.style.cursor = 'pointer';
  button.style.fontSize = '12px';
  button.addEventListener('click', () => {
    void onClick();
  });
  return button;
}

function createDemoView(container, api, options) {
  const root = createRoot(container);
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.gap = '12px';
  header.style.alignItems = 'flex-start';

  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.textContent =
    options && options.kind === 'visualizer' ? 'Stream Protocol Lab' : 'Stream Protocol Demo';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  const subtitle = document.createElement('div');
  subtitle.textContent =
    'Real PMPM runtime instance using protocol stream + session cleanup.';
  subtitle.style.fontSize = '12px';
  subtitle.style.opacity = '0.7';
  subtitle.style.marginTop = '4px';
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);
  header.appendChild(titleWrap);

  const surfaceBadge = document.createElement('div');
  surfaceBadge.textContent = options && options.kind === 'visualizer' ? DEMO_VISUALIZER_ID : 'magnet';
  surfaceBadge.style.padding = '4px 8px';
  surfaceBadge.style.borderRadius = '999px';
  surfaceBadge.style.fontSize = '11px';
  surfaceBadge.style.background = 'rgba(120, 190, 255, 0.12)';
  surfaceBadge.style.border = '1px solid rgba(120, 190, 255, 0.24)';
  header.appendChild(surfaceBadge);
  root.appendChild(header);

  const state = {
    streamHandle: null,
    streamOffData: null,
    streamOffEnd: null,
    streamId: '-',
    streamStatus: 'idle',
    streamEndReason: '-',
    frameCount: 0,
    latestTap: '-',
    latestSequence: '-',
    latestBins: '-',
    sessionId: null,
    sessionMeta: '-',
    lastError: '-',
    capabilityCount: 0,
  };

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gap = '6px';
  grid.style.padding = '10px';
  grid.style.borderRadius = '10px';
  grid.style.background = 'rgba(255,255,255,0.04)';
  grid.style.border = '1px solid rgba(255,255,255,0.08)';

  const capabilityRow = createLabelValueRow('Capabilities', 'loading...');
  const streamStatusRow = createLabelValueRow('Stream', state.streamStatus);
  const streamIdRow = createLabelValueRow('Stream ID', state.streamId);
  const streamEndRow = createLabelValueRow('Stream End', state.streamEndReason);
  const frameCountRow = createLabelValueRow('Frames', String(state.frameCount));
  const tapRow = createLabelValueRow('Tap', state.latestTap);
  const sequenceRow = createLabelValueRow('Sequence', state.latestSequence);
  const binsRow = createLabelValueRow('Bins[0..7]', state.latestBins);
  const sessionRow = createLabelValueRow('Session', '-');
  const sessionMetaRow = createLabelValueRow('Session Meta', state.sessionMeta);
  const errorRow = createLabelValueRow('Last Error', state.lastError);

  [
    capabilityRow,
    streamStatusRow,
    streamIdRow,
    streamEndRow,
    frameCountRow,
    tapRow,
    sequenceRow,
    binsRow,
    sessionRow,
    sessionMetaRow,
    errorRow,
  ].forEach((entry) => grid.appendChild(entry.row));

  root.appendChild(grid);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.flexWrap = 'wrap';
  actions.style.gap = '8px';
  root.appendChild(actions);

  const note = document.createElement('div');
  note.style.fontSize = '12px';
  note.style.opacity = '0.72';
  note.textContent =
    'Tip: open an audio session, then use "Crash Runtime" to verify host-side cleanup via audit log.';
  root.appendChild(note);

  function render() {
    capabilityRow.valueEl.textContent = String(state.capabilityCount);
    streamStatusRow.valueEl.textContent = state.streamStatus;
    streamIdRow.valueEl.textContent = state.streamId;
    streamEndRow.valueEl.textContent = state.streamEndReason;
    frameCountRow.valueEl.textContent = String(state.frameCount);
    tapRow.valueEl.textContent = state.latestTap;
    sequenceRow.valueEl.textContent = state.latestSequence;
    binsRow.valueEl.textContent = state.latestBins;
    sessionRow.valueEl.textContent = state.sessionId || '-';
    sessionMetaRow.valueEl.textContent = state.sessionMeta;
    errorRow.valueEl.textContent = state.lastError;
  }

  async function loadCapabilities() {
    try {
      const capabilities = await api.host.listCapabilities();
      state.capabilityCount = Array.isArray(capabilities) ? capabilities.length : 0;
      render();
    } catch (error) {
      state.lastError = readErrorMessage(error);
      render();
    }
  }

  async function releaseStream(reason) {
    const handle = state.streamHandle;
    const offData = state.streamOffData;
    const offEnd = state.streamOffEnd;
    state.streamHandle = null;
    state.streamOffData = null;
    state.streamOffEnd = null;
    if (!handle) return;
    try {
      await handle.dispose(reason || 'demo-release');
    } catch (error) {
      state.lastError = readErrorMessage(error);
      render();
    } finally {
      offData && offData();
      offEnd && offEnd();
      if (state.streamStatus !== 'ended') {
        state.streamStatus = 'ended';
        state.streamEndReason = reason || 'disposed';
        render();
      }
    }
  }

  async function openStream() {
    await releaseStream('demo-restart');
    state.streamStatus = 'opening';
    state.streamEndReason = '-';
    state.streamId = '-';
    state.frameCount = 0;
    state.latestTap = '-';
    state.latestSequence = '-';
    state.latestBins = '-';
    render();

    try {
      const handle = await api.host.openStream(
        AUDIO_ANALYSIS_CAPABILITY_ID,
        'openSpectrumFrameStream',
        {
          tap: 'post-dsp',
          intervalMs: 33,
        }
      );
      if (!handle) {
        throw new Error('host.openStream returned null');
      }

      state.streamHandle = handle;
      state.streamId = handle.streamId || '-';
      state.streamStatus = 'open';
      state.streamOffData = handle.onData((payload, envelope) => {
        state.frameCount += 1;
        state.latestTap = payload && payload.tap ? String(payload.tap) : '-';
        state.latestSequence =
          envelope && typeof envelope.sequence === 'number' ? String(envelope.sequence) : '-';
        state.latestBins = readBinsPreview(payload);
        render();
      });
      state.streamOffEnd = handle.onEnd((reason) => {
        state.streamStatus = 'ended';
        state.streamEndReason = reason || 'ended';
        render();
      });
      render();
    } catch (error) {
      state.streamStatus = 'error';
      state.lastError = readErrorMessage(error);
      render();
    }
  }

  async function cancelStream() {
    if (!state.streamHandle) return;
    try {
      await state.streamHandle.cancel('demo-cancel');
    } catch (error) {
      state.lastError = readErrorMessage(error);
      render();
    }
  }

  async function openSession() {
    try {
      if (state.sessionId) {
        await api.host.closeSession(AUDIO_INPUT_CAPABILITY_ID, state.sessionId, 'demo-reopen');
      }
      const opened = await api.host.openSession(AUDIO_INPUT_CAPABILITY_ID, 'openSession', {
        path: AUDIO_INPUT_SOURCE_PATH,
        fallbackToBuiltin: true,
      });
      if (!opened || !opened.sessionId) {
        throw new Error('host.openSession returned null');
      }
      state.sessionId = opened.sessionId;
      state.sessionMeta = JSON.stringify(opened.metadata || {}, null, 0);
      render();
    } catch (error) {
      state.lastError = readErrorMessage(error);
      render();
    }
  }

  async function closeSession(reason) {
    if (!state.sessionId) return;
    const sessionId = state.sessionId;
    state.sessionId = null;
    state.sessionMeta = '-';
    render();
    try {
      await api.host.closeSession(AUDIO_INPUT_CAPABILITY_ID, sessionId, reason || 'demo-close');
    } catch (error) {
      state.lastError = readErrorMessage(error);
      render();
    }
  }

  async function crashRuntime() {
    try {
      if (!state.sessionId) {
        await openSession();
      }
    } catch {}
    setTimeout(() => {
      throw new Error('Stream protocol demo forced crash');
    }, 0);
  }

  actions.appendChild(createButton('Restart Stream', openStream));
  actions.appendChild(createButton('Cancel Stream', cancelStream));
  actions.appendChild(
    createButton('Dispose Stream', async () => {
      await releaseStream('demo-dispose');
    })
  );
  actions.appendChild(createButton('Open Session', openSession));
  actions.appendChild(
    createButton('Close Session', async () => {
      await closeSession('demo-close');
    })
  );
  actions.appendChild(createButton('Crash Runtime', crashRuntime, { danger: true }));

  void loadCapabilities();
  void openStream();
  render();

  return () => {
    void releaseStream('visualizer-unmount');
    void closeSession('visualizer-unmount');
    container.innerHTML = '';
  };
}

export function mount(container, api) {
  return createDemoView(container, api, { kind: 'magnet' });
}

export function mountVisualizer(container, api, visualizerId) {
  return createDemoView(container, api, {
    kind: visualizerId === DEMO_VISUALIZER_ID ? 'visualizer' : 'visualizer',
  });
}
`;

async function createBundleBytes(): Promise<Uint8Array> {
  const files: AsyncZippable = {
    'manifest.json': strToU8(JSON.stringify(STREAM_PROTOCOL_DEMO_MANIFEST, null, 2)),
    [STREAM_PROTOCOL_DEMO_ENTRY_PATH]: strToU8(STREAM_PROTOCOL_DEMO_ENTRY_CODE),
  };

  return await new Promise((resolve, reject) => {
    zip(files, (error, zipped) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(zipped);
    });
  });
}

export function getStreamProtocolDemoPluginDefinition() {
  return {
    manifest: STREAM_PROTOCOL_DEMO_MANIFEST,
    entryCode: STREAM_PROTOCOL_DEMO_ENTRY_CODE,
  };
}

export async function installStreamProtocolDemoPlugin(): Promise<{
  pluginId: string;
  visualizerId: string;
}> {
  const bytes = await createBundleBytes();
  await installPmpmPluginFromZipBytes(bytes);
  return {
    pluginId: STREAM_PROTOCOL_DEMO_PLUGIN_ID,
    visualizerId: STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
  };
}
