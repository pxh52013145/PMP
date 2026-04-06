function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function createRoot(container, options) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = options && options.gap ? options.gap : '8px';
  root.style.padding = options && options.padding ? options.padding : '12px';
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

function createInputRow(label, value) {
  const row = document.createElement('div');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '110px minmax(0, 1fr)';
  row.style.gap = '8px';
  row.style.alignItems = 'center';

  const k = document.createElement('div');
  k.textContent = label;
  k.style.opacity = '0.75';
  k.style.fontSize = '11px';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.style.width = '100%';
  input.style.borderRadius = '10px';
  input.style.border = '1px solid rgba(255,255,255,0.16)';
  input.style.background = 'rgba(0,0,0,0.22)';
  input.style.color = 'rgba(255,255,255,0.92)';
  input.style.padding = '8px 10px';
  input.style.fontSize = '12px';

  row.appendChild(k);
  row.appendChild(input);
  return { row, input };
}

function readConfig(api) {
  const cfg = api && api.config && typeof api.config.get === 'function' ? api.config.get() : {};
  return asObject(cfg) ?? {};
}

function patchConfig(api, next) {
  if (!api || !api.config || typeof api.config.patch !== 'function') {
    throw new Error('config.patch is not available (missing permission storage:local?)');
  }
  api.config.patch(next);
}

export function mount(container, api) {
  const root = createRoot(container, { padding: '10px' });
  const title = document.createElement('div');
  title.textContent = 'Settings Panel Demo';
  title.style.fontWeight = '900';
  title.style.fontSize = '13px';
  root.appendChild(title);

  const hint = document.createElement('div');
  hint.textContent = 'Open the plugin settings panel (Demo Settings Panel) to edit config.';
  hint.style.fontSize = '11px';
  hint.style.opacity = '0.8';
  root.appendChild(hint);

  const cfg = readConfig(api);
  const value = typeof cfg.demoText === 'string' ? cfg.demoText : '';

  const preview = document.createElement('div');
  preview.textContent = `demoText: ${value || '-'}`;
  preview.style.fontSize = '11px';
  preview.style.opacity = '0.85';
  root.appendChild(preview);

  let unlisten = null;
  try {
    if (api && api.config && typeof api.config.onChange === 'function') {
      unlisten = api.config.onChange((nextCfg) => {
        const next = asObject(nextCfg) ?? {};
        preview.textContent = `demoText: ${typeof next.demoText === 'string' ? next.demoText : '-'}`;
      });
    }
  } catch {
    // ignore
  }

  return () => {
    try {
      unlisten && unlisten();
    } catch {}
    container.innerHTML = '';
  };
}

export function mountSettings(container, api, panelId) {
  void panelId;

  const root = createRoot(container, { padding: '14px', gap: '10px' });

  const title = document.createElement('div');
  title.textContent = 'Demo Settings Panel';
  title.style.fontWeight = '900';
  title.style.fontSize = '16px';
  root.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = 'Edits plugin config via storage:local.';
  sub.style.fontSize = '12px';
  sub.style.opacity = '0.75';
  root.appendChild(sub);

  const error = document.createElement('div');
  error.style.fontSize = '12px';
  error.style.opacity = '0.9';
  error.style.color = 'rgba(255, 160, 160, 0.92)';
  error.textContent = '';
  root.appendChild(error);

  const cfg = readConfig(api);
  const initialText = typeof cfg.demoText === 'string' ? cfg.demoText : '';

  const textRow = createInputRow('demoText', initialText);
  root.appendChild(textRow.row);

  const saveHint = document.createElement('div');
  saveHint.textContent = 'Typing updates config immediately.';
  saveHint.style.fontSize = '11px';
  saveHint.style.opacity = '0.7';
  root.appendChild(saveHint);

  let unlisten = null;

  const onInput = () => {
    try {
      patchConfig(api, { demoText: textRow.input.value });
      error.textContent = '';
    } catch (err) {
      error.textContent = readErrorMessage(err);
    }
  };
  textRow.input.addEventListener('input', onInput);

  try {
    if (api && api.config && typeof api.config.onChange === 'function') {
      unlisten = api.config.onChange((nextCfg) => {
        const next = asObject(nextCfg) ?? {};
        const nextValue = typeof next.demoText === 'string' ? next.demoText : '';
        if (textRow.input.value !== nextValue) {
          textRow.input.value = nextValue;
        }
      });
    }
  } catch (err) {
    error.textContent = readErrorMessage(err);
  }

  return () => {
    try {
      textRow.input.removeEventListener('input', onInput);
    } catch {}
    try {
      unlisten && unlisten();
    } catch {}
    container.innerHTML = '';
  };
}

