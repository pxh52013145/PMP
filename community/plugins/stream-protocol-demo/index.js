const DEMO_VISUALIZER_ID = 'stream-protocol-lab';
const AUDIO_INPUT_CAPABILITY_ID = 'host.pmp.audio-engine.input';
const AUDIO_ANALYSIS_CAPABILITY_ID = 'host.pmp.audio-engine.analysis';
const AUDIO_INPUT_SOURCE_PATH = 'D:/pixel-matrix-player-demo/demo.flac';

function readErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function readBinsValues(frame, limit) {
  if (!frame || !frame.bins) return [];
  try {
    return Array.from(frame.bins)
      .slice(0, limit)
      .map((value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
      });
  } catch {
    return [];
  }
}

function readBinsPreview(frame) {
  const values = readBinsValues(frame, 8);
  return values.length > 0 ? values.join(', ') : '-';
}

function trimMiddle(value, maxLength) {
  const text = String(value || '-');
  if (text.length <= maxLength) return text;
  const head = Math.max(2, Math.floor((maxLength - 1) / 2));
  const tail = Math.max(2, maxLength - head - 1);
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function createRoot(container, options) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = options && options.gap ? options.gap : '10px';
  root.style.padding = options && options.padding ? options.padding : '12px';
  root.style.borderRadius = options && options.borderRadius ? options.borderRadius : '12px';
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
  button.style.borderRadius = options && options.compact ? '10px' : '999px';
  button.style.padding = options && options.compact ? '6px 8px' : '8px 12px';
  button.style.minHeight = options && options.compact ? '28px' : 'auto';
  button.style.background =
    options && options.danger ? 'rgba(140, 33, 33, 0.32)' : 'rgba(255,255,255,0.08)';
  button.style.color = '#f7fbff';
  button.style.cursor = 'pointer';
  button.style.fontSize = options && options.compact ? '10px' : '12px';
  button.style.fontWeight = options && options.compact ? '600' : '500';
  button.style.lineHeight = '1.1';
  button.style.minWidth = '0';
  button.style.whiteSpace = 'nowrap';
  button.style.overflow = 'hidden';
  button.style.textOverflow = 'ellipsis';
  button.addEventListener('click', () => {
    void onClick();
  });
  return button;
}

function createMiniStat(label) {
  const stat = document.createElement('div');
  stat.style.display = 'flex';
  stat.style.flexDirection = 'column';
  stat.style.gap = '2px';
  stat.style.minWidth = '0';
  stat.style.padding = '5px 6px';
  stat.style.borderRadius = '8px';
  stat.style.background = 'rgba(255,255,255,0.06)';
  stat.style.border = '1px solid rgba(255,255,255,0.08)';

  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  labelEl.style.fontSize = '9px';
  labelEl.style.letterSpacing = '0.04em';
  labelEl.style.textTransform = 'uppercase';
  labelEl.style.opacity = '0.7';

  const valueEl = document.createElement('div');
  valueEl.style.fontSize = '11px';
  valueEl.style.fontWeight = '700';
  valueEl.style.whiteSpace = 'nowrap';
  valueEl.style.overflow = 'hidden';
  valueEl.style.textOverflow = 'ellipsis';

  stat.appendChild(labelEl);
  stat.appendChild(valueEl);
  return { stat, valueEl };
}

function createDemoController(api, render) {
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
    latestBinValues: [],
    sessionId: null,
    sessionMeta: '-',
    lastError: '-',
    capabilityCount: 0,
  };

  function refresh() {
    render(state);
  }

  async function loadCapabilities() {
    try {
      const capabilities = await api.host.listCapabilities();
      state.capabilityCount = Array.isArray(capabilities) ? capabilities.length : 0;
      refresh();
    } catch (error) {
      state.lastError = readErrorMessage(error);
      refresh();
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
      refresh();
    } finally {
      offData && offData();
      offEnd && offEnd();
      if (state.streamStatus !== 'ended') {
        state.streamStatus = 'ended';
        state.streamEndReason = reason || 'disposed';
        refresh();
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
    state.latestBinValues = [];
    refresh();

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
        state.latestBinValues = readBinsValues(payload, 12);
        refresh();
      });
      state.streamOffEnd = handle.onEnd((reason) => {
        state.streamStatus = 'ended';
        state.streamEndReason = reason || 'ended';
        refresh();
      });
      refresh();
    } catch (error) {
      state.streamStatus = 'error';
      state.lastError = readErrorMessage(error);
      refresh();
    }
  }

  async function cancelStream() {
    if (!state.streamHandle) return;
    try {
      await state.streamHandle.cancel('demo-cancel');
    } catch (error) {
      state.lastError = readErrorMessage(error);
      refresh();
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
      refresh();
    } catch (error) {
      state.lastError = readErrorMessage(error);
      refresh();
    }
  }

  async function closeSession(reason) {
    if (!state.sessionId) return;
    const sessionId = state.sessionId;
    state.sessionId = null;
    state.sessionMeta = '-';
    refresh();
    try {
      await api.host.closeSession(AUDIO_INPUT_CAPABILITY_ID, sessionId, reason || 'demo-close');
    } catch (error) {
      state.lastError = readErrorMessage(error);
      refresh();
    }
  }

  async function toggleSession() {
    if (state.sessionId) {
      await closeSession('demo-toggle-close');
      return;
    }
    await openSession();
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

  refresh();

  return {
    state,
    actions: {
      loadCapabilities,
      openStream,
      cancelStream,
      releaseStream,
      openSession,
      closeSession,
      toggleSession,
      crashRuntime,
    },
    start() {
      void loadCapabilities();
      void openStream();
      refresh();
    },
    dispose() {
      void releaseStream('surface-unmount');
      void closeSession('surface-unmount');
    },
  };
}

function createVisualizerView(container, api) {
  const root = createRoot(container, {
    gap: '10px',
    padding: '12px',
    borderRadius: '12px',
  });

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.gap = '12px';
  header.style.alignItems = 'flex-start';

  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.textContent = 'Stream Protocol Lab';
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
  surfaceBadge.textContent = DEMO_VISUALIZER_ID;
  surfaceBadge.style.padding = '4px 8px';
  surfaceBadge.style.borderRadius = '999px';
  surfaceBadge.style.fontSize = '11px';
  surfaceBadge.style.background = 'rgba(120, 190, 255, 0.12)';
  surfaceBadge.style.border = '1px solid rgba(120, 190, 255, 0.24)';
  header.appendChild(surfaceBadge);
  root.appendChild(header);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gap = '6px';
  grid.style.padding = '10px';
  grid.style.borderRadius = '10px';
  grid.style.background = 'rgba(255,255,255,0.04)';
  grid.style.border = '1px solid rgba(255,255,255,0.08)';

  const capabilityRow = createLabelValueRow('Capabilities', 'loading...');
  const streamStatusRow = createLabelValueRow('Stream', 'idle');
  const streamIdRow = createLabelValueRow('Stream ID', '-');
  const streamEndRow = createLabelValueRow('Stream End', '-');
  const frameCountRow = createLabelValueRow('Frames', '0');
  const tapRow = createLabelValueRow('Tap', '-');
  const sequenceRow = createLabelValueRow('Sequence', '-');
  const binsRow = createLabelValueRow('Bins[0..7]', '-');
  const sessionRow = createLabelValueRow('Session', '-');
  const sessionMetaRow = createLabelValueRow('Session Meta', '-');
  const errorRow = createLabelValueRow('Last Error', '-');

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

  function render(state) {
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

  const controller = createDemoController(api, render);

  actions.appendChild(createButton('Restart Stream', controller.actions.openStream));
  actions.appendChild(createButton('Cancel Stream', controller.actions.cancelStream));
  actions.appendChild(
    createButton('Dispose Stream', async () => {
      await controller.actions.releaseStream('demo-dispose');
    })
  );
  actions.appendChild(createButton('Open Session', controller.actions.openSession));
  actions.appendChild(
    createButton('Close Session', async () => {
      await controller.actions.closeSession('demo-close');
    })
  );
  actions.appendChild(
    createButton('Crash Runtime', controller.actions.crashRuntime, { danger: true })
  );

  controller.start();

  return () => {
    controller.dispose();
    container.innerHTML = '';
  };
}

function createMagnetView(container, api) {
  const root = createRoot(container, {
    gap: '5px',
    padding: '6px',
    borderRadius: '10px',
  });
  root.style.justifyContent = 'space-between';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '6px';

  const title = document.createElement('div');
  title.textContent = 'Stream Demo';
  title.style.fontSize = '10px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.03em';
  title.style.whiteSpace = 'nowrap';
  title.style.overflow = 'hidden';
  title.style.textOverflow = 'ellipsis';
  header.appendChild(title);

  const statusBadge = document.createElement('div');
  statusBadge.style.padding = '2px 6px';
  statusBadge.style.borderRadius = '999px';
  statusBadge.style.fontSize = '9px';
  statusBadge.style.fontWeight = '700';
  statusBadge.style.whiteSpace = 'nowrap';
  header.appendChild(statusBadge);

  root.appendChild(header);

  const statsRow = document.createElement('div');
  statsRow.style.display = 'grid';
  statsRow.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  statsRow.style.gap = '4px';

  const framesStat = createMiniStat('Frames');
  const seqStat = createMiniStat('Seq');
  const sessionStat = createMiniStat('Session');
  statsRow.appendChild(framesStat.stat);
  statsRow.appendChild(seqStat.stat);
  statsRow.appendChild(sessionStat.stat);
  root.appendChild(statsRow);

  const spectrumPanel = document.createElement('div');
  spectrumPanel.style.display = 'flex';
  spectrumPanel.style.alignItems = 'flex-end';
  spectrumPanel.style.gap = '2px';
  spectrumPanel.style.flex = '1';
  spectrumPanel.style.minHeight = '34px';
  spectrumPanel.style.padding = '4px';
  spectrumPanel.style.borderRadius = '8px';
  spectrumPanel.style.background = 'rgba(255,255,255,0.05)';
  spectrumPanel.style.border = '1px solid rgba(255,255,255,0.08)';

  const bars = Array.from({ length: 12 }, () => {
    const bar = document.createElement('div');
    bar.style.flex = '1';
    bar.style.height = '16%';
    bar.style.minHeight = '4px';
    bar.style.borderRadius = '999px';
    bar.style.background = 'linear-gradient(180deg, #8ed2ff 0%, #3ea2ff 100%)';
    bar.style.opacity = '0.85';
    bar.style.transition = 'height 120ms ease, opacity 120ms ease';
    spectrumPanel.appendChild(bar);
    return bar;
  });
  root.appendChild(spectrumPanel);

  const metaRow = document.createElement('div');
  metaRow.style.display = 'grid';
  metaRow.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  metaRow.style.gap = '4px';

  const streamIdCard = createMiniStat('Stream');
  const tapCard = createMiniStat('Tap');
  metaRow.appendChild(streamIdCard.stat);
  metaRow.appendChild(tapCard.stat);
  root.appendChild(metaRow);

  const actionGrid = document.createElement('div');
  actionGrid.style.display = 'grid';
  actionGrid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  actionGrid.style.gap = '4px';
  root.appendChild(actionGrid);

  const restartButton = createButton('Restart', () => controller.actions.openStream(), {
    compact: true,
  });
  const disposeButton = createButton(
    'Dispose',
    async () => {
      await controller.actions.releaseStream('demo-dispose');
    },
    { compact: true }
  );
  const sessionButton = createButton('Session', () => controller.actions.toggleSession(), {
    compact: true,
  });
  const crashButton = createButton('Crash', () => controller.actions.crashRuntime(), {
    compact: true,
    danger: true,
  });

  actionGrid.appendChild(restartButton);
  actionGrid.appendChild(disposeButton);
  actionGrid.appendChild(sessionButton);
  actionGrid.appendChild(crashButton);

  const footer = document.createElement('div');
  footer.style.fontSize = '9px';
  footer.style.lineHeight = '1.2';
  footer.style.opacity = '0.8';
  footer.style.minHeight = '11px';
  footer.style.whiteSpace = 'nowrap';
  footer.style.overflow = 'hidden';
  footer.style.textOverflow = 'ellipsis';
  root.appendChild(footer);

  function render(state) {
    const badgeText =
      state.streamStatus === 'open'
        ? 'LIVE'
        : state.streamStatus === 'opening'
          ? 'BOOT'
          : state.streamStatus === 'error'
            ? 'ERR'
            : 'IDLE';
    statusBadge.textContent = badgeText;
    statusBadge.style.background =
      state.streamStatus === 'open'
        ? 'rgba(72, 214, 146, 0.18)'
        : state.streamStatus === 'error'
          ? 'rgba(214, 72, 72, 0.18)'
          : 'rgba(120, 190, 255, 0.12)';
    statusBadge.style.border =
      state.streamStatus === 'open'
        ? '1px solid rgba(72, 214, 146, 0.34)'
        : state.streamStatus === 'error'
          ? '1px solid rgba(214, 72, 72, 0.34)'
          : '1px solid rgba(120, 190, 255, 0.24)';

    framesStat.valueEl.textContent = String(state.frameCount);
    seqStat.valueEl.textContent = trimMiddle(state.latestSequence, 8);
    sessionStat.valueEl.textContent = state.sessionId ? 'OPEN' : 'OFF';
    streamIdCard.valueEl.textContent = trimMiddle(state.streamId, 12);
    tapCard.valueEl.textContent = trimMiddle(state.latestTap, 10);
    sessionButton.textContent = state.sessionId ? 'Close' : 'Session';

    const values = state.latestBinValues;
    const maxValue = values.length > 0 ? Math.max.apply(null, values) : 0;
    bars.forEach((bar, index) => {
      const value = values[index] || 0;
      const ratio = maxValue > 0 ? value / maxValue : 0;
      const heightPercent = 14 + Math.round(ratio * 86);
      bar.style.height = `${heightPercent}%`;
      bar.style.opacity = values.length > 0 ? String(0.45 + ratio * 0.55) : '0.2';
    });

    footer.textContent =
      state.lastError && state.lastError !== '-'
        ? trimMiddle(state.lastError, 48)
        : `${trimMiddle(state.streamEndReason, 18)} | caps ${state.capabilityCount}`;
  }

  const controller = createDemoController(api, render);
  controller.start();

  return () => {
    controller.dispose();
    container.innerHTML = '';
  };
}

export function mount(container, api) {
  return createMagnetView(container, api);
}

export function mountVisualizer(container, api, visualizerId) {
  void visualizerId;
  return createVisualizerView(container, api);
}
