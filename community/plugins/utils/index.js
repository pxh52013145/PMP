const PLUGIN_ID = 'utils';
const PAGE_ID = 'utils-page';
const OVERLAY_ID = 'utils-overlay';
const WIDGET_ID = 'utils-widget';
const AUDIO_PLAYBACK_CAPABILITY_ID = 'host.pmp.audio-engine.playback';
const AUDIO_ANALYSIS_CAPABILITY_ID = 'host.pmp.audio-engine.analysis';

const SIDECAR_COMMANDS = [
  'utils.probe.system',
  'utils.probe.performance',
  'utils.probe.windows',
  'utils.probe.qt.adapter',
  'utils.media.playPause',
  'utils.media.next',
  'utils.media.previous',
  'utils.media.toggleMute',
  'utils.simulate.hang',
  'utils.simulate.crash',
];

const HOST_SHELL_COMMANDS = [
  `extv2:${PLUGIN_ID}:shell-surface:${OVERLAY_ID}:summon`,
  `extv2:${PLUGIN_ID}:shell-surface:${WIDGET_ID}:summon`,
];

function createRoot(container, options) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';
  root.style.padding = options.padding || '12px';
  root.style.borderRadius = options.borderRadius || '16px';
  root.style.background = options.background;
  root.style.border = options.border || '1px solid rgba(255,255,255,0.12)';
  root.style.color = '#f8fbff';
  root.style.fontFamily = '"Segoe UI", "PingFang SC", sans-serif';
  root.style.overflow = options.overflow || 'hidden';
  root.style.boxShadow = options.shadow || '0 18px 48px rgba(5, 10, 18, 0.28)';
  container.innerHTML = '';
  container.appendChild(root);
  return root;
}

function createHeader(root, title, subtitle, accent) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '4px';

  const tag = document.createElement('div');
  tag.textContent = accent;
  tag.style.fontSize = '10px';
  tag.style.letterSpacing = '0.22em';
  tag.style.textTransform = 'uppercase';
  tag.style.opacity = '0.76';
  wrap.appendChild(tag);

  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.fontSize = '17px';
  heading.style.fontWeight = '900';
  wrap.appendChild(heading);

  const text = document.createElement('div');
  text.textContent = subtitle;
  text.style.fontSize = '12px';
  text.style.lineHeight = '1.55';
  text.style.opacity = '0.82';
  wrap.appendChild(text);

  root.appendChild(wrap);
}

function createCard(root, title) {
  const card = document.createElement('section');
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';
  card.style.padding = '10px 12px';
  card.style.borderRadius = '14px';
  card.style.background = 'rgba(3, 10, 20, 0.26)';
  card.style.border = '1px solid rgba(255,255,255,0.1)';

  const heading = document.createElement('div');
  heading.textContent = title;
  heading.style.fontSize = '11px';
  heading.style.fontWeight = '800';
  heading.style.letterSpacing = '0.08em';
  heading.style.textTransform = 'uppercase';
  heading.style.opacity = '0.9';
  card.appendChild(heading);

  root.appendChild(card);
  return card;
}

function createInfoGrid(root) {
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '110px minmax(0, 1fr)';
  grid.style.gap = '6px 10px';
  root.appendChild(grid);
  return grid;
}

function setInfoGridRows(grid, rows) {
  grid.innerHTML = '';
  for (const [label, value] of rows) {
    const key = document.createElement('div');
    key.textContent = label;
    key.style.fontSize = '11px';
    key.style.opacity = '0.68';

    const cell = document.createElement('div');
    cell.textContent = value;
    cell.style.fontSize = '11px';
    cell.style.wordBreak = 'break-word';

    grid.appendChild(key);
    grid.appendChild(cell);
  }
}

function createBadgeRow(root) {
  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.gap = '6px';
  root.appendChild(row);
  return row;
}

function setBadgeRow(row, values) {
  row.innerHTML = '';
  for (const value of values) {
    const badge = document.createElement('span');
    badge.textContent = value;
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '999px';
    badge.style.fontSize = '10px';
    badge.style.background = 'rgba(112, 225, 255, 0.14)';
    badge.style.border = '1px solid rgba(112, 225, 255, 0.2)';
    badge.style.color = '#dff8ff';
    row.appendChild(badge);
  }
}

function formatBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '-';
}

function formatDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '-';
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatPlaybackPosition(currentTime, duration) {
  const current = formatDuration(currentTime);
  const total = formatDuration(duration);
  return current === '-' && total === '-' ? '-' : `${current} / ${total}`;
}

function createButton(label, onClick, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = options.title || label;
  button.style.border = '1px solid rgba(255,255,255,0.14)';
  button.style.background =
    options.tone === 'plain'
      ? 'rgba(255,255,255,0.08)'
      : 'linear-gradient(135deg, rgba(55, 180, 255, 0.24), rgba(255, 164, 96, 0.18))';
  button.style.color = '#f8fbff';
  button.style.fontWeight = '700';
  button.style.fontSize = '11px';
  button.style.padding = options.compact ? '6px 8px' : '8px 10px';
  button.style.borderRadius = '10px';
  button.style.cursor = 'pointer';
  button.addEventListener('click', onClick);
  return button;
}

function createSpectrumStrip(root, barCount = 24) {
  const strip = document.createElement('div');
  strip.style.display = 'grid';
  strip.style.gridTemplateColumns = `repeat(${barCount}, minmax(2px, 1fr))`;
  strip.style.alignItems = 'end';
  strip.style.gap = '3px';
  strip.style.height = '38px';
  strip.style.padding = '6px 0 0';
  root.appendChild(strip);

  const bars = [];
  for (let index = 0; index < barCount; index += 1) {
    const bar = document.createElement('div');
    bar.style.minHeight = '3px';
    bar.style.height = '3px';
    bar.style.borderRadius = '999px 999px 2px 2px';
    bar.style.background =
      index % 3 === 0
        ? 'rgba(255, 196, 112, 0.88)'
        : index % 3 === 1
          ? 'rgba(91, 212, 255, 0.88)'
          : 'rgba(188, 236, 255, 0.72)';
    bar.style.boxShadow = '0 0 12px rgba(91, 212, 255, 0.16)';
    strip.appendChild(bar);
    bars.push(bar);
  }

  return bars;
}

function toNumberList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'number' && Number.isFinite(item));
  }
  if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) {
    return Array.from(value);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const length =
    typeof record.length === 'number' && Number.isFinite(record.length)
      ? Math.max(0, Math.min(512, Math.floor(record.length)))
      : null;

  if (length !== null) {
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const entry = record[index];
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        values.push(entry);
      }
    }
    return values;
  }

  return Object.keys(record)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => record[key])
    .filter((item) => typeof item === 'number' && Number.isFinite(item));
}

function setSpectrumBars(bars, bins) {
  const values = Array.isArray(bins) && bins.length > 0 ? bins : [];
  for (let index = 0; index < bars.length; index += 1) {
    const value = values.length > 0 ? values[Math.floor((index / bars.length) * values.length)] : 0;
    const normalized = Math.max(0, Math.min(1, value / 255));
    const height = Math.max(3, Math.round(4 + normalized * 34));
    bars[index].style.height = `${height}px`;
    bars[index].style.opacity = values.length > 0 ? '1' : '0.28';
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readLastRun(config) {
  const lastRun =
    config && typeof config === 'object' && !Array.isArray(config) ? config.lastRun : null;
  if (!lastRun || typeof lastRun !== 'object' || Array.isArray(lastRun)) {
    return null;
  }
  if (lastRun.ok === true && lastRun.data && typeof lastRun.data === 'object') {
    return {
      ...lastRun.data,
      envelope: {
        protocolVersion: lastRun.protocolVersion,
        requestId: lastRun.requestId,
        durationMs: lastRun.durationMs,
      },
    };
  }
  return lastRun;
}

function readPerformanceSnapshot(lastRun) {
  const performance =
    lastRun && lastRun.performance && typeof lastRun.performance === 'object'
      ? lastRun.performance
      : null;
  if (performance) {
    return performance;
  }

  const sidecar =
    lastRun && lastRun.sidecar && typeof lastRun.sidecar === 'object' ? lastRun.sidecar : null;
  if (!sidecar) {
    return null;
  }

  return {
    schemaVersion: sidecar.schemaVersion || '1.0',
    capturedAtMs: sidecar.capturedAtMs,
    platform: sidecar.platform,
    arch: sidecar.arch,
    cpu: sidecar.cpu,
    memory: sidecar.memory,
    runtime: sidecar.runtime,
  };
}

async function safeInvoke(api, capabilityId, method, payload) {
  try {
    if (!api || !api.host || typeof api.host.invokeCapability !== 'function') {
      return {
        ok: false,
        error: {
          message: 'Host capability bridge is unavailable',
        },
      };
    }
    return await api.host.invokeCapability(capabilityId, method, payload);
  } catch (error) {
    return {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function readCapabilityData(result, fallbackValue) {
  return result && result.ok === true && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : fallbackValue;
}

async function readConfig(api) {
  const result = await safeInvoke(api, 'host.pmp.storage.config', 'get');
  return asRecord(readCapabilityData(result, {})) || {};
}

async function loadDiagnostics(api) {
  const registryList = await safeInvoke(api, 'core.capability-registry', 'list');
  const navigationDescriptor = await safeInvoke(api, 'host.pmp.navigation', 'describe');
  const storageDescriptor = await safeInvoke(api, 'host.pmp.storage.config', 'describe');
  const rendererDescriptor = await safeInvoke(api, 'host.pmp.magnets.renderer', 'describe');
  const catalogList = await safeInvoke(api, 'host.pmp.magnets.catalog', 'list');
  const capabilities = readCapabilityData(registryList, []);

  const rendererMethods =
    rendererDescriptor &&
    rendererDescriptor.ok === true &&
    rendererDescriptor.data &&
    typeof rendererDescriptor.data === 'object' &&
    Array.isArray(rendererDescriptor.data.methods)
      ? rendererDescriptor.data.methods
      : [];

  const catalogCount =
    catalogList &&
    catalogList.ok === true &&
    catalogList.data &&
    typeof catalogList.data === 'object' &&
    typeof catalogList.data.magnetCount === 'number'
      ? catalogList.data.magnetCount
      : null;

  const navigationMethods =
    navigationDescriptor &&
    navigationDescriptor.ok === true &&
    navigationDescriptor.data &&
    typeof navigationDescriptor.data === 'object' &&
    Array.isArray(navigationDescriptor.data.methods)
      ? navigationDescriptor.data.methods
      : [];

  const storageMethods =
    storageDescriptor &&
    storageDescriptor.ok === true &&
    storageDescriptor.data &&
    typeof storageDescriptor.data === 'object' &&
    Array.isArray(storageDescriptor.data.methods)
      ? storageDescriptor.data.methods
      : [];

  return {
    capabilities,
    rendererMethods,
    catalogCount,
    navigationMethods,
    storageMethods,
  };
}

function readTrackLabel(track) {
  const record = asRecord(track);
  if (!record) {
    return {
      title: 'No active track',
      artist: 'PMP playback idle',
    };
  }

  const title =
    typeof record.title === 'string' && record.title.trim().length > 0
      ? record.title.trim()
      : 'Untitled track';
  const artist =
    typeof record.artist === 'string' && record.artist.trim().length > 0
      ? record.artist.trim()
      : typeof record.albumArtist === 'string' && record.albumArtist.trim().length > 0
        ? record.albumArtist.trim()
        : 'Unknown artist';

  return { title, artist };
}

function readAudioStateRows(state, playMode) {
  const record = asRecord(state);
  if (!record) {
    return [
      ['status', 'Audio capability unavailable'],
      ['hint', `Declare ${AUDIO_PLAYBACK_CAPABILITY_ID} and reinstall/reload the plugin`],
    ];
  }

  const track = readTrackLabel(record.currentTrack);
  const queueLength = Array.isArray(record.queue) ? record.queue.length : 0;
  const playlist = asRecord(record.currentPlaylist);

  return [
    ['track', track.title],
    ['artist', track.artist],
    ['state', typeof record.playbackState === 'string' ? record.playbackState : '-'],
    [
      'position',
      formatPlaybackPosition(
        typeof record.currentTime === 'number' ? record.currentTime : null,
        typeof record.duration === 'number' ? record.duration : null
      ),
    ],
    ['volume', formatPercent(typeof record.volume === 'number' ? record.volume * 100 : null)],
    ['muted', record.muted === true ? 'yes' : 'no'],
    ['mode', typeof playMode === 'string' && playMode.length > 0 ? playMode : '-'],
    ['queue', queueLength > 0 ? `${queueLength} tracks` : 'empty'],
    [
      'playlist',
      playlist && typeof playlist.name === 'string' && playlist.name.trim().length > 0
        ? playlist.name.trim()
        : '-',
    ],
  ];
}

function readSpectrumBins(frame) {
  const record = asRecord(frame);
  if (!record) {
    return [];
  }
  return toNumberList(record.bins);
}

async function loadAudioSnapshot(api) {
  const [stateResult, playModeResult, spectrumResult] = await Promise.all([
    safeInvoke(api, AUDIO_PLAYBACK_CAPABILITY_ID, 'getState'),
    safeInvoke(api, AUDIO_PLAYBACK_CAPABILITY_ID, 'getPlayMode'),
    safeInvoke(api, AUDIO_ANALYSIS_CAPABILITY_ID, 'getSpectrumFrame', { tap: 'post-dsp' }),
  ]);

  const state = readCapabilityData(stateResult, null);
  const playMode = readCapabilityData(playModeResult, null);
  const spectrumFrame = readCapabilityData(spectrumResult, null);
  const spectrumBins = readSpectrumBins(spectrumFrame);

  return {
    state,
    playMode,
    spectrumBins,
    playbackAvailable: stateResult && stateResult.ok === true,
    analysisAvailable: spectrumResult && spectrumResult.ok === true,
    playbackError:
      stateResult && stateResult.ok === false && stateResult.error
        ? stateResult.error.message || 'Playback capability failed'
        : null,
    analysisError:
      spectrumResult && spectrumResult.ok === false && spectrumResult.error
        ? spectrumResult.error.message || 'Audio analysis capability failed'
        : null,
  };
}

function mountSurface(container, api, options) {
  const root = createRoot(container, {
    background: options.background,
    borderRadius: options.borderRadius,
    padding: options.padding,
    border: options.border,
    shadow: options.shadow,
    overflow: options.overflow,
  });

  createHeader(root, options.title, options.subtitle, options.accent);

  const emitRuntimeTelemetry = (event, level, fields) => {
    void safeInvoke(api, 'host.pmp.telemetry', 'log', {
      loggerId: 'plugin.utils',
      event,
      level,
      component: 'utils-webview-runtime',
      runtimeId: 'webview.main',
      fields: {
        pluginId: PLUGIN_ID,
        surface: options.surfaceLabel,
        surfaceId: options.surfaceId || PLUGIN_ID,
        ...(fields || {}),
      },
    });
  };

  const showDiagnostics = options.showDiagnostics !== false;
  const showCommandList = options.showCommandList !== false;
  const showActions = options.showActions !== false;
  const showOperatorNote = options.showOperatorNote !== false;
  const showMedia = options.showMedia !== false;
  const showMediaControls = options.showMediaControls !== false;
  const showPerformance = options.showPerformance !== false;
  const statusLimit =
    typeof options.statusLimit === 'number' && Number.isFinite(options.statusLimit)
      ? Math.max(1, Math.floor(options.statusLimit))
      : null;

  const statusCard = createCard(root, 'Status');
  const statusGrid = createInfoGrid(statusCard);

  const diagnosticsCard = showDiagnostics ? createCard(root, 'Host Snapshot') : null;
  const diagnosticsGrid = diagnosticsCard ? createInfoGrid(diagnosticsCard) : null;
  const diagnosticsBadges = diagnosticsCard ? createBadgeRow(diagnosticsCard) : null;

  const performanceCard = showPerformance ? createCard(root, 'System Performance') : null;
  const performanceGrid = performanceCard ? createInfoGrid(performanceCard) : null;

  const mediaCard = showMedia ? createCard(root, 'PMP Audio') : null;
  const mediaGrid = mediaCard ? createInfoGrid(mediaCard) : null;
  const spectrumBars = mediaCard ? createSpectrumStrip(mediaCard, options.compact ? 18 : 24) : [];
  let lastAudioSnapshot = null;

  const invokeAudioControl = async (method, payload) => {
    const result = await safeInvoke(api, AUDIO_PLAYBACK_CAPABILITY_ID, method, payload);
    emitRuntimeTelemetry('plugin.utils.audio.control', result && result.ok === true ? 'info' : 'warn', {
      method,
      ok: result && result.ok === true,
      error:
        result && result.ok === false && result.error
          ? result.error.message || 'audio-control-failed'
          : null,
    });
    await renderAudio();
  };

  if (mediaCard && showMediaControls) {
    const mediaActions = document.createElement('div');
    mediaActions.style.display = 'flex';
    mediaActions.style.flexWrap = 'wrap';
    mediaActions.style.gap = '6px';
    mediaCard.appendChild(mediaActions);
    mediaActions.appendChild(
      createButton('Prev', () => {
        void invokeAudioControl('playPrevious');
      }, { compact: options.compact })
    );
    mediaActions.appendChild(
      createButton('Play/Pause', () => {
        const state = asRecord(lastAudioSnapshot && lastAudioSnapshot.state);
        const method = state && state.playbackState === 'playing' ? 'pause' : 'play';
        void invokeAudioControl(method);
      }, { compact: options.compact })
    );
    mediaActions.appendChild(
      createButton('Next', () => {
        void invokeAudioControl('playNext');
      }, { compact: options.compact })
    );
    mediaActions.appendChild(
      createButton('Mute', () => {
        void invokeAudioControl('toggleMute');
      }, { compact: options.compact, tone: 'plain' })
    );
  }

  const commandCard = showCommandList ? createCard(root, 'Commands') : null;
  const commandList = commandCard ? document.createElement('div') : null;
  if (commandCard && commandList) {
    commandList.style.display = 'grid';
    commandList.style.gap = '4px';
    commandList.style.fontSize = '11px';
    commandList.style.opacity = '0.86';
    commandCard.appendChild(commandList);
    for (const commandId of options.commandIds) {
      const row = document.createElement('div');
      row.textContent = commandId;
      commandList.appendChild(row);
    }
  }

  const actionsCard = showActions ? createCard(root, 'Actions') : null;
  const actionRow = actionsCard ? document.createElement('div') : null;
  if (actionsCard && actionRow) {
    actionRow.style.display = 'flex';
    actionRow.style.flexWrap = 'wrap';
    actionRow.style.gap = '8px';
    actionsCard.appendChild(actionRow);

    const refreshButton = createButton('Refresh Snapshot', () => {
      void refreshDiagnostics();
      void renderAudio();
    }, { compact: options.compact });
    actionRow.appendChild(refreshButton);

    if (options.allowOpenDetailPage) {
      actionRow.appendChild(
        createButton('Open Detail Page', () => {
          void safeInvoke(api, 'host.pmp.navigation', 'navigateTo', {
            page: 'plugin-page',
            params: {
              pluginId: PLUGIN_ID,
              pageId: PAGE_ID,
            },
          });
        }, { compact: options.compact })
      );
    }
  }

  emitRuntimeTelemetry('plugin.utils.surface.mount.start', 'info', {
    dataContractVersion: '1.0',
  });

  const noteCard = showOperatorNote ? createCard(root, 'Operator Note') : null;
  const noteInput = noteCard ? document.createElement('input') : null;
  if (noteCard && noteInput) {
    noteInput.type = 'text';
    noteInput.placeholder = 'Capture operator notes or follow-up items';
    noteInput.style.width = '100%';
    noteInput.style.boxSizing = 'border-box';
    noteInput.style.borderRadius = '10px';
    noteInput.style.border = '1px solid rgba(255,255,255,0.14)';
    noteInput.style.background = 'rgba(0,0,0,0.18)';
    noteInput.style.color = '#f8fbff';
    noteInput.style.padding = '8px 10px';
    noteInput.style.fontSize = '12px';
    noteCard.appendChild(noteInput);
  }

  let disposed = false;
  let refreshToken = 0;
  let statusToken = 0;
  let audioToken = 0;
  const audioRefreshTimer =
    showMedia && typeof window !== 'undefined'
      ? window.setInterval(() => {
          if (!disposed) {
            void renderAudio();
          }
        }, options.audioRefreshMs || 3000)
      : null;

  const renderStatus = async () => {
    const token = statusToken + 1;
    statusToken = token;
    const config = await readConfig(api);
    if (disposed || token !== statusToken) {
      return;
    }
    const lastRun = readLastRun(config);
    const probe =
      lastRun &&
      typeof lastRun.probe === 'string' &&
      lastRun.probe.length > 0
        ? lastRun.probe
        : '-';
    const command =
      lastRun &&
      typeof lastRun.commandId === 'string' &&
      lastRun.commandId.length > 0
        ? lastRun.commandId
        : '-';
    const timestamp =
      lastRun &&
      typeof lastRun.timestamp === 'string' &&
      lastRun.timestamp.length > 0
        ? lastRun.timestamp
        : '-';
    const outcome =
      lastRun &&
      typeof lastRun.summary === 'string' &&
      lastRun.summary.length > 0
        ? lastRun.summary
        : 'No sidecar result yet';
    const note =
      typeof config.operatorNote === 'string' && config.operatorNote.length > 0
        ? config.operatorNote
        : '';
    const performance = readPerformanceSnapshot(lastRun);

    if (noteInput) {
      noteInput.value = note;
    }

    const statusRows = [
      ['plugin', PLUGIN_ID],
      ['surface', options.surfaceLabel],
      ['surfaceId', options.surfaceId || PLUGIN_ID],
      ['data contract', lastRun && lastRun.envelope ? lastRun.envelope.protocolVersion || '1.0' : '1.0'],
      ['last command', command],
      ['last probe', probe],
      ['last updated', timestamp],
      [
        'duration',
        lastRun && lastRun.envelope && typeof lastRun.envelope.durationMs === 'number'
          ? `${lastRun.envelope.durationMs}ms`
          : '-',
      ],
      ['summary', outcome],
    ];

    if (!showMedia && lastAudioSnapshot) {
      statusRows.push(...readAudioStateRows(lastAudioSnapshot.state, lastAudioSnapshot.playMode).slice(0, 4));
    }

    setInfoGridRows(statusGrid, statusLimit ? statusRows.slice(0, statusLimit) : statusRows);

    if (!performanceGrid) {
      return;
    }

    if (!performance) {
      setInfoGridRows(performanceGrid, [
        ['status', 'No performance probe yet'],
        ['command', 'Run utils.probe.performance'],
      ]);
    } else {
      const cpu =
        performance.cpu && typeof performance.cpu === 'object' ? performance.cpu : {};
      const memory =
        performance.memory && typeof performance.memory === 'object' ? performance.memory : {};
      const processMetrics =
        performance.process && typeof performance.process === 'object'
          ? performance.process
          : performance.runtime && typeof performance.runtime === 'object'
            ? performance.runtime
            : {};
      const network =
        performance.network && typeof performance.network === 'object' ? performance.network : {};

      setInfoGridRows(performanceGrid, [
        ['captured', typeof performance.capturedAtMs === 'number' ? new Date(performance.capturedAtMs).toLocaleTimeString() : '-'],
        ['platform', [performance.platform, performance.arch].filter(Boolean).join(' / ') || '-'],
        ['cpu usage', formatPercent(cpu.loadPercent)],
        ['logical cores', typeof cpu.logicalCores === 'number' ? String(cpu.logicalCores) : '-'],
        ['memory used', formatBytes(memory.usedBytes)],
        ['memory free', formatBytes(memory.freeBytes ?? memory.availableBytes)],
        ['memory usage', formatPercent(memory.usedPercent)],
        ['process rss', formatBytes(processMetrics.rssBytes)],
        [
          'network',
          typeof network.interfaceCount === 'number'
            ? `${network.interfaceCount} interfaces / ${network.externalAddressCount ?? 0} external addresses`
            : 'redacted',
        ],
      ]);
    }
  };

  const renderAudio = async () => {
    if (!mediaGrid) {
      if (!showMedia) {
        await renderStatus();
      }
      return;
    }

    const token = audioToken + 1;
    audioToken = token;
    const snapshot = await loadAudioSnapshot(api);
    if (disposed || token !== audioToken) {
      return;
    }

    lastAudioSnapshot = snapshot;
    const rows = readAudioStateRows(snapshot.state, snapshot.playMode);
    if (!snapshot.playbackAvailable && snapshot.playbackError) {
      rows.push(['playback error', snapshot.playbackError]);
    }
    if (!snapshot.analysisAvailable) {
      rows.push(['spectrum', snapshot.analysisError || 'Audio analysis unavailable']);
    }

    setInfoGridRows(mediaGrid, options.compact ? rows.slice(0, 6) : rows);
    setSpectrumBars(spectrumBars, snapshot.spectrumBins);
    if (!showMedia) {
      await renderStatus();
    }
  };

  const refreshDiagnostics = async () => {
    if (!diagnosticsGrid || !diagnosticsBadges) {
      return;
    }

    const token = refreshToken + 1;
    refreshToken = token;

    setInfoGridRows(diagnosticsGrid, [
      ['status', 'Loading host snapshot...'],
      ['hint', 'Querying capability registry and magnet contracts'],
    ]);
    setBadgeRow(diagnosticsBadges, []);

    const snapshot = await loadDiagnostics(api);
    if (disposed || token !== refreshToken) {
      return;
    }

    const capabilityIds = Array.isArray(snapshot.capabilities)
      ? snapshot.capabilities.map((item) => item.id).slice(0, 8)
      : [];

    setInfoGridRows(diagnosticsGrid, [
      ['capabilities', Array.isArray(snapshot.capabilities) ? String(snapshot.capabilities.length) : '0'],
      ['catalog count', snapshot.catalogCount === null ? 'unavailable' : String(snapshot.catalogCount)],
      [
        'navigation methods',
        snapshot.navigationMethods.length > 0 ? snapshot.navigationMethods.join(', ') : 'unavailable',
      ],
      [
        'storage methods',
        snapshot.storageMethods.length > 0 ? snapshot.storageMethods.join(', ') : 'unavailable',
      ],
      [
        'renderer methods',
        snapshot.rendererMethods.length > 0 ? snapshot.rendererMethods.join(', ') : 'unavailable',
      ],
    ]);
    setBadgeRow(diagnosticsBadges, capabilityIds.length > 0 ? capabilityIds : ['No visible capabilities']);
  };

  void renderStatus();
  void renderAudio();
  const disposeConfig =
    api && api.config && typeof api.config.onChange === 'function'
      ? api.config.onChange(() => {
          if (!disposed) {
            void renderStatus();
          }
        })
      : () => {};

  const handleNoteInput = () => {
    if (!noteInput) {
      return;
    }
    void safeInvoke(api, 'host.pmp.storage.config', 'patch', {
      value: {
        operatorNote: noteInput.value,
      },
    });
  };
  if (noteInput) {
    noteInput.addEventListener('input', handleNoteInput);
  }

  if (showDiagnostics) {
    void refreshDiagnostics();
  }
  emitRuntimeTelemetry('plugin.utils.surface.mount.completed', 'info', {
    dataContractVersion: '1.0',
  });

  return () => {
    disposed = true;
    try {
      disposeConfig();
    } catch {
      // ignore
    }
    if (audioRefreshTimer !== null) {
      window.clearInterval(audioRefreshTimer);
    }
    if (noteInput) {
      noteInput.removeEventListener('input', handleNoteInput);
    }
    emitRuntimeTelemetry('plugin.utils.surface.disposed', 'info', {
      dataContractVersion: '1.0',
    });
    container.innerHTML = '';
  };
}

function normalizeSurfaceKind(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return ['magnet', 'page', 'overlay', 'desktop-widget'].includes(normalized)
    ? normalized
    : 'magnet';
}

function createUtilsMountContext(fallbackKind, fallbackId, rawContext) {
  const record = asRecord(rawContext) || {};
  const surfaceKind = normalizeSurfaceKind(
    record.surfaceKind || record.surface || record.kind || fallbackKind
  );
  const surfaceId =
    typeof record.surfaceId === 'string' && record.surfaceId.trim().length > 0
      ? record.surfaceId.trim()
      : fallbackId;

  return {
    protocolVersion: '1.0',
    pluginId: PLUGIN_ID,
    runtimeId: 'webview.main',
    sourceKind: 'extv2',
    surfaceKind,
    surfaceId,
    activationId: surfaceKind === 'magnet' ? `onView:${PLUGIN_ID}` : `onView:${surfaceId}`,
    dataContractVersion: '1.0',
    theme: asRecord(record.theme) || null,
  };
}

function resolveSurfaceOptions(context) {
  const theme = asRecord(context.theme);
  const variant =
    theme && typeof theme.variant === 'string' && theme.variant.trim().length > 0
      ? theme.variant.trim()
      : 'hub';
  const compactMagnet = context.surfaceKind === 'magnet' && variant === 'compact';

  switch (context.surfaceKind) {
    case 'page':
      return {
        title: 'Utils Detail Page',
        subtitle:
          'Expanded diagnostic surface mapping launcher, HUD, widget, and native probe concepts onto current PMP host boundaries.',
        accent: 'Detail Page',
        surfaceLabel: 'page',
        surfaceId: context.surfaceId || PAGE_ID,
        allowOpenDetailPage: false,
        commandIds: [
          ...SIDECAR_COMMANDS,
          ...HOST_SHELL_COMMANDS,
          'onView:utils',
          'onView:utils-page',
          'onView:utils-overlay',
          'onView:utils-widget',
        ],
        background:
          'linear-gradient(135deg, rgba(7, 16, 28, 0.96), rgba(7, 33, 52, 0.92) 42%, rgba(33, 112, 146, 0.72) 72%, rgba(255, 170, 88, 0.22))',
        border: '1px solid rgba(153, 232, 255, 0.22)',
        borderRadius: '18px',
        padding: '16px',
        shadow: '0 20px 64px rgba(5, 10, 18, 0.3)',
        overflow: 'auto',
      };
    case 'overlay':
      return {
        title: 'Utils Overlay',
        subtitle:
          'Host-managed quick panel. Reopen should focus the existing window instead of spawning a duplicate.',
        accent: 'Overlay',
        surfaceLabel: 'overlay',
        surfaceId: context.surfaceId || OVERLAY_ID,
        allowOpenDetailPage: true,
        commandIds: [HOST_SHELL_COMMANDS[0], ...SIDECAR_COMMANDS.slice(0, 3)],
        showDiagnostics: false,
        showCommandList: false,
        showOperatorNote: false,
        background:
          'linear-gradient(135deg, rgba(10, 18, 30, 0.96), rgba(20, 54, 78, 0.9) 55%, rgba(84, 210, 255, 0.26))',
        border: '1px solid rgba(134, 234, 255, 0.24)',
        borderRadius: '18px',
        padding: '14px',
        shadow: '0 24px 70px rgba(2, 8, 18, 0.42)',
        overflow: 'auto',
        showPerformance: false,
        statusLimit: 6,
      };
    case 'desktop-widget':
      return {
        title: 'Utils Widget',
        subtitle:
          'Ambient HUD surface summarizing the latest sidecar probe and operator note for desktop presence.',
        accent: 'Desktop Widget',
        surfaceLabel: 'desktop-widget',
        surfaceId: context.surfaceId || WIDGET_ID,
        allowOpenDetailPage: true,
        commandIds: [HOST_SHELL_COMMANDS[1], ...SIDECAR_COMMANDS.slice(0, 3)],
        compact: true,
        showDiagnostics: false,
        showCommandList: false,
        showActions: false,
        showOperatorNote: false,
        showMediaControls: false,
        showPerformance: false,
        statusLimit: 5,
        background:
          'linear-gradient(145deg, rgba(8, 14, 26, 0.95), rgba(17, 39, 57, 0.9) 48%, rgba(255, 183, 102, 0.24))',
        border: '1px solid rgba(255, 218, 168, 0.18)',
        borderRadius: '18px',
        padding: '10px',
        shadow: '0 18px 54px rgba(5, 10, 18, 0.34)',
      };
    case 'magnet':
    default:
      return {
        title: compactMagnet ? 'Utils Compact' : 'Utils Hub',
        subtitle:
          compactMagnet
            ? 'Low-density HUD for current PMP audio, last system probe, and sidecar status.'
            : 'SAO-inspired control panel for PMP audio, sidecar health, and host magnet boundaries.',
        accent: compactMagnet ? 'Compact Magnet' : 'Magnet Hub',
        surfaceLabel: 'magnet',
        surfaceId: context.surfaceId || PLUGIN_ID,
        allowOpenDetailPage: true,
        commandIds: [...SIDECAR_COMMANDS, ...HOST_SHELL_COMMANDS],
        compact: compactMagnet,
        showDiagnostics: !compactMagnet,
        showCommandList: !compactMagnet,
        showOperatorNote: !compactMagnet,
        showPerformance: !compactMagnet,
        statusLimit: compactMagnet ? 6 : 9,
        showMediaControls: !compactMagnet,
        background:
          'linear-gradient(145deg, rgba(4, 13, 28, 0.95), rgba(8, 38, 60, 0.9) 55%, rgba(255, 152, 76, 0.28))',
        border: '1px solid rgba(140, 224, 255, 0.2)',
        borderRadius: '16px',
        padding: '12px',
        shadow: '0 18px 54px rgba(5, 10, 18, 0.34)',
      };
  }
}

function mountWithContext(container, api, context) {
  return mountSurface(container, api, {
    ...resolveSurfaceOptions(context),
    mountContext: context,
  });
}

export function mount(container, api, mountContext) {
  return mountWithContext(
    container,
    api,
    createUtilsMountContext('magnet', PLUGIN_ID, mountContext)
  );
}

export function mountPage(container, api, pageId) {
  return mountWithContext(
    container,
    api,
    createUtilsMountContext('page', pageId || PAGE_ID, {
      surfaceKind: 'page',
      surfaceId: pageId || PAGE_ID,
    })
  );
}

export function mountOverlay(container, api, surfaceId) {
  return mountWithContext(
    container,
    api,
    createUtilsMountContext('overlay', surfaceId || OVERLAY_ID, {
      surfaceKind: 'overlay',
      surfaceId: surfaceId || OVERLAY_ID,
    })
  );
}

export function mountDesktopWidget(container, api, surfaceId) {
  return mountWithContext(
    container,
    api,
    createUtilsMountContext('desktop-widget', surfaceId || WIDGET_ID, {
      surfaceKind: 'desktop-widget',
      surfaceId: surfaceId || WIDGET_ID,
    })
  );
}
