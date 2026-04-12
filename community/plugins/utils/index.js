const PLUGIN_ID = 'utils';
const PAGE_ID = 'utils-page';
const OVERLAY_ID = 'utils-overlay';
const WIDGET_ID = 'utils-widget';

const SIDECAR_COMMANDS = [
  'utils.probe.system',
  'utils.probe.windows',
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
  root.style.overflow = 'hidden';
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

function createButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.border = '1px solid rgba(255,255,255,0.14)';
  button.style.background =
    'linear-gradient(135deg, rgba(55, 180, 255, 0.24), rgba(255, 164, 96, 0.18))';
  button.style.color = '#f8fbff';
  button.style.fontWeight = '700';
  button.style.fontSize = '11px';
  button.style.padding = '8px 10px';
  button.style.borderRadius = '10px';
  button.style.cursor = 'pointer';
  button.addEventListener('click', onClick);
  return button;
}

function readConfig(api) {
  if (!api || !api.config || typeof api.config.get !== 'function') {
    return {};
  }
  const value = api.config.get();
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readLastRun(config) {
  const lastRun =
    config && typeof config === 'object' && !Array.isArray(config) ? config.lastRun : null;
  return lastRun && typeof lastRun === 'object' && !Array.isArray(lastRun) ? lastRun : null;
}

async function safeInvoke(api, capabilityId, method, payload) {
  try {
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

async function loadDiagnostics(api) {
  const hostInfo =
    api && api.host && typeof api.host.getInfo === 'function' ? api.host.getInfo() : null;
  const permissions =
    api && api.host && typeof api.host.listPermissions === 'function'
      ? api.host.listPermissions()
      : [];

  const capabilities =
    api && api.host && typeof api.host.listCapabilities === 'function'
      ? await api.host.listCapabilities()
      : [];

  const rendererDescriptor = await safeInvoke(api, 'host.pmp.magnets.renderer', 'describe');
  const catalogList = await safeInvoke(api, 'host.pmp.magnets.catalog', 'list');

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

  return {
    hostInfo,
    permissions,
    capabilities,
    rendererMethods,
    catalogCount,
  };
}

function mountSurface(container, api, options) {
  const root = createRoot(container, {
    background: options.background,
    borderRadius: options.borderRadius,
    padding: options.padding,
    border: options.border,
    shadow: options.shadow,
  });

  createHeader(root, options.title, options.subtitle, options.accent);

  const statusCard = createCard(root, 'Status');
  const statusGrid = createInfoGrid(statusCard);

  const diagnosticsCard = createCard(root, 'Host Snapshot');
  const diagnosticsGrid = createInfoGrid(diagnosticsCard);
  const diagnosticsBadges = createBadgeRow(diagnosticsCard);

  const commandCard = createCard(root, 'Commands');
  const commandList = document.createElement('div');
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

  const actionsCard = createCard(root, 'Actions');
  const actionRow = document.createElement('div');
  actionRow.style.display = 'flex';
  actionRow.style.flexWrap = 'wrap';
  actionRow.style.gap = '8px';
  actionsCard.appendChild(actionRow);

  const refreshButton = createButton('Refresh Host Snapshot', () => {
    void refreshDiagnostics();
  });
  actionRow.appendChild(refreshButton);

  if (options.allowOpenDetailPage) {
    actionRow.appendChild(
      createButton('Open Detail Page', () => {
        if (!api || !api.navigation || typeof api.navigation.navigateTo !== 'function') {
          return;
        }
        api.navigation.navigateTo('plugin-page', {
          pluginId: PLUGIN_ID,
          pageId: PAGE_ID,
        });
      })
    );
  }

  const noteCard = createCard(root, 'Operator Note');
  const noteInput = document.createElement('input');
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

  let disposed = false;
  let refreshToken = 0;

  const renderStatus = () => {
    const config = readConfig(api);
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

    noteInput.value = note;

    setInfoGridRows(statusGrid, [
      ['plugin', PLUGIN_ID],
      ['surface', options.surfaceLabel],
      ['surfaceId', options.surfaceId || PLUGIN_ID],
      ['last command', command],
      ['last probe', probe],
      ['last updated', timestamp],
      ['summary', outcome],
    ]);
  };

  const refreshDiagnostics = async () => {
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
      ['runtime', snapshot.hostInfo && snapshot.hostInfo.runtime ? snapshot.hostInfo.runtime : '-'],
      [
        'host label',
        snapshot.hostInfo && snapshot.hostInfo.hostLabel ? snapshot.hostInfo.hostLabel : '-',
      ],
      ['permissions', Array.isArray(snapshot.permissions) ? String(snapshot.permissions.length) : '0'],
      ['capabilities', Array.isArray(snapshot.capabilities) ? String(snapshot.capabilities.length) : '0'],
      ['catalog count', snapshot.catalogCount === null ? 'unavailable' : String(snapshot.catalogCount)],
      [
        'renderer methods',
        snapshot.rendererMethods.length > 0 ? snapshot.rendererMethods.join(', ') : 'unavailable',
      ],
    ]);
    setBadgeRow(diagnosticsBadges, capabilityIds.length > 0 ? capabilityIds : ['No visible capabilities']);
  };

  renderStatus();
  const disposeConfig =
    api && api.config && typeof api.config.onChange === 'function'
      ? api.config.onChange(() => {
          if (!disposed) {
            renderStatus();
          }
        })
      : () => {};

  noteInput.addEventListener('input', () => {
    if (!api || !api.config || typeof api.config.patch !== 'function') {
      return;
    }
    api.config.patch({
      operatorNote: noteInput.value,
    });
  });

  void refreshDiagnostics();

  return () => {
    disposed = true;
    try {
      disposeConfig();
    } catch {
      // ignore
    }
    container.innerHTML = '';
  };
}

export function mount(container, api) {
  return mountSurface(container, api, {
    title: 'Utils Hub',
    subtitle:
      'SAO-inspired control panel for sidecar health, shell-surface routes, and host magnet boundaries.',
    accent: 'Magnet Hub',
    surfaceLabel: 'magnet',
    surfaceId: PLUGIN_ID,
    allowOpenDetailPage: true,
    commandIds: [...SIDECAR_COMMANDS, ...HOST_SHELL_COMMANDS],
    background:
      'linear-gradient(145deg, rgba(4, 13, 28, 0.95), rgba(8, 38, 60, 0.9) 55%, rgba(255, 152, 76, 0.28))',
    border: '1px solid rgba(140, 224, 255, 0.2)',
    borderRadius: '16px',
    padding: '12px',
    shadow: '0 18px 54px rgba(5, 10, 18, 0.34)',
  });
}

export function mountPage(container, api, pageId) {
  return mountSurface(container, api, {
    title: 'Utils Detail Page',
    subtitle:
      'Expanded diagnostic surface mapping launcher, HUD, widget, and native probe concepts onto current PMP host boundaries.',
    accent: 'Detail Page',
    surfaceLabel: 'page',
    surfaceId: pageId || PAGE_ID,
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
  });
}

export function mountOverlay(container, api, surfaceId) {
  return mountSurface(container, api, {
    title: 'Utils Overlay',
    subtitle:
      'Host-managed quick panel. Reopen should focus the existing window instead of spawning a duplicate.',
    accent: 'Overlay',
    surfaceLabel: 'overlay',
    surfaceId: surfaceId || OVERLAY_ID,
    allowOpenDetailPage: true,
    commandIds: [HOST_SHELL_COMMANDS[0], ...SIDECAR_COMMANDS.slice(0, 2)],
    background:
      'linear-gradient(135deg, rgba(10, 18, 30, 0.96), rgba(20, 54, 78, 0.9) 55%, rgba(84, 210, 255, 0.26))',
    border: '1px solid rgba(134, 234, 255, 0.24)',
    borderRadius: '18px',
    padding: '14px',
    shadow: '0 24px 70px rgba(2, 8, 18, 0.42)',
  });
}

export function mountDesktopWidget(container, api, surfaceId) {
  return mountSurface(container, api, {
    title: 'Utils Widget',
    subtitle:
      'Ambient HUD surface summarizing the latest sidecar probe and operator note for desktop presence.',
    accent: 'Desktop Widget',
    surfaceLabel: 'desktop-widget',
    surfaceId: surfaceId || WIDGET_ID,
    allowOpenDetailPage: true,
    commandIds: [HOST_SHELL_COMMANDS[1], ...SIDECAR_COMMANDS.slice(0, 2)],
    background:
      'linear-gradient(145deg, rgba(8, 14, 26, 0.95), rgba(17, 39, 57, 0.9) 48%, rgba(255, 183, 102, 0.24))',
    border: '1px solid rgba(255, 218, 168, 0.18)',
    borderRadius: '18px',
    padding: '12px',
    shadow: '0 18px 54px rgba(5, 10, 18, 0.34)',
  });
}
