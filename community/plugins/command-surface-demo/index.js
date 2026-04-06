const KEY_COUNT = 'count';
const KEY_LAST_COMMAND = 'lastCommand';
const KEY_LAST_ARGS = 'lastArgs';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function readConfig(api) {
  const cfg = api && api.config && typeof api.config.get === 'function' ? api.config.get() : {};
  return asObject(cfg) ?? {};
}

function nextCount(current) {
  const n = typeof current === 'number' && Number.isFinite(current) ? current : 0;
  return n + 1;
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value || '');
  }
}

function createRoot(container) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '8px';
  root.style.padding = '12px';
  root.style.borderRadius = '12px';
  root.style.background = 'rgba(255,255,255,0.06)';
  root.style.border = '1px solid rgba(255,255,255,0.10)';
  root.style.color = 'rgba(255,255,255,0.92)';
  root.style.fontFamily = '"Segoe UI", "PingFang SC", sans-serif';
  root.style.overflow = 'hidden';
  container.innerHTML = '';
  container.appendChild(root);
  return root;
}

function createButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.border = '1px solid rgba(255,255,255,0.16)';
  button.style.borderRadius = '10px';
  button.style.padding = '8px 10px';
  button.style.background = 'rgba(255,255,255,0.08)';
  button.style.color = '#f7fbff';
  button.style.cursor = 'pointer';
  button.style.fontSize = '12px';
  button.style.fontWeight = '700';
  button.addEventListener('click', () => {
    void onClick();
  });
  return button;
}

function patchConfig(api, next) {
  if (!api || !api.config || typeof api.config.patch !== 'function') {
    throw new Error('config.patch is not available (missing permission storage:local?)');
  }
  api.config.patch(next);
}

function setConfig(api, next) {
  if (!api || !api.config || typeof api.config.set !== 'function') {
    throw new Error('config.set is not available (missing permission storage:local?)');
  }
  api.config.set(next);
}

export function mount(container, api) {
  const root = createRoot(container);

  const title = document.createElement('div');
  title.textContent = 'Command Surface Demo';
  title.style.fontWeight = '900';
  title.style.fontSize = '14px';
  root.appendChild(title);

  const summary = document.createElement('div');
  summary.style.fontSize = '11px';
  summary.style.opacity = '0.8';
  summary.textContent = 'Run the contributed commands from PMP to update the persisted counter.';
  root.appendChild(summary);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '120px minmax(0, 1fr)';
  grid.style.gap = '6px 10px';
  grid.style.padding = '10px';
  grid.style.borderRadius = '10px';
  grid.style.background = 'rgba(0,0,0,0.18)';
  grid.style.border = '1px solid rgba(255,255,255,0.10)';
  grid.style.fontSize = '11px';
  root.appendChild(grid);

  function addRow(label) {
    const k = document.createElement('div');
    k.textContent = label;
    k.style.opacity = '0.72';
    const v = document.createElement('div');
    v.textContent = '-';
    v.style.wordBreak = 'break-word';
    grid.appendChild(k);
    grid.appendChild(v);
    return v;
  }

  const countEl = addRow('count');
  const lastCommandEl = addRow('lastCommand');
  const lastArgsEl = addRow('lastArgs');
  const errorEl = addRow('Last error');

  const actions = document.createElement('div');
  actions.style.display = 'grid';
  actions.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
  actions.style.gap = '8px';
  root.appendChild(actions);

  const incBtn = createButton('Increment (UI)', () => {
    try {
      const cfg = readConfig(api);
      patchConfig(api, {
        [KEY_COUNT]: nextCount(cfg[KEY_COUNT]),
        [KEY_LAST_COMMAND]: 'ui.increment',
        [KEY_LAST_ARGS]: '-',
      });
      errorEl.textContent = '-';
      refresh();
    } catch (error) {
      errorEl.textContent = readErrorMessage(error);
    }
  });

  const resetBtn = createButton('Reset (UI)', () => {
    try {
      setConfig(api, {
        [KEY_COUNT]: 0,
        [KEY_LAST_COMMAND]: 'ui.reset',
        [KEY_LAST_ARGS]: '-',
      });
      errorEl.textContent = '-';
      refresh();
    } catch (error) {
      errorEl.textContent = readErrorMessage(error);
    }
  });

  actions.appendChild(incBtn);
  actions.appendChild(resetBtn);

  let unlisten = null;

  function refresh() {
    const cfg = readConfig(api);
    countEl.textContent = String(typeof cfg[KEY_COUNT] === 'number' ? cfg[KEY_COUNT] : 0);
    lastCommandEl.textContent = String(cfg[KEY_LAST_COMMAND] || '-');
    lastArgsEl.textContent = String(cfg[KEY_LAST_ARGS] || '-');
  }

  try {
    if (api && api.config && typeof api.config.onChange === 'function') {
      unlisten = api.config.onChange(() => refresh());
    }
  } catch (error) {
    errorEl.textContent = readErrorMessage(error);
  }

  refresh();

  return () => {
    try {
      unlisten && unlisten();
    } catch {}
    container.innerHTML = '';
  };
}

export async function runCommand(api, commandId, args) {
  const cfg = readConfig(api);

  if (commandId === 'increment') {
    patchConfig(api, {
      [KEY_COUNT]: nextCount(cfg[KEY_COUNT]),
      [KEY_LAST_COMMAND]: 'command.increment',
      [KEY_LAST_ARGS]: safeJson(args ?? null) || '-',
    });
    return;
  }

  if (commandId === 'reset') {
    setConfig(api, {
      [KEY_COUNT]: 0,
      [KEY_LAST_COMMAND]: 'command.reset',
      [KEY_LAST_ARGS]: safeJson(args ?? null) || '-',
    });
    return;
  }

  throw new Error(`Unknown command: ${String(commandId)}`);
}

