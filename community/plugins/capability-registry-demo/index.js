const REGISTRY_ID = 'core.capability-registry';

function readErrorMessage(error) {
  return error && error.message ? String(error.message) : String(error || 'Unknown error');
}

function safeJson(value, fallback) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
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
  root.style.background =
    'linear-gradient(180deg, rgba(18, 24, 38, 0.92) 0%, rgba(20, 30, 54, 0.88) 100%)';
  root.style.border = '1px solid rgba(255,255,255,0.10)';
  root.style.color = '#e8f1ff';
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
  button.style.borderRadius = '999px';
  button.style.padding = '8px 12px';
  button.style.background = 'rgba(255,255,255,0.08)';
  button.style.color = '#f7fbff';
  button.style.cursor = 'pointer';
  button.style.fontSize = '12px';
  button.style.fontWeight = '600';
  button.addEventListener('click', () => {
    void onClick();
  });
  return button;
}

function formatCapabilityList(list, limit) {
  if (!Array.isArray(list)) return '-';
  const ids = list
    .map((item) => (item && typeof item === 'object' ? item.id : null))
    .filter((id) => typeof id === 'string' && id.length > 0);
  const clipped = ids.slice(0, limit);
  const tail = ids.length > limit ? `\n... (${ids.length - limit} more)` : '';
  return `${clipped.join('\n')}${tail}`;
}

export function mount(container, api) {
  const root = createRoot(container);

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '12px';
  root.appendChild(header);

  const title = document.createElement('div');
  title.textContent = 'Capability Registry Demo';
  title.style.fontSize = '14px';
  title.style.fontWeight = '800';
  header.appendChild(title);

  const refreshBtn = createButton('Refresh', refresh);
  header.appendChild(refreshBtn);

  const status = document.createElement('div');
  status.style.fontSize = '11px';
  status.style.opacity = '0.75';
  status.textContent = 'idle';
  root.appendChild(status);

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '140px minmax(0, 1fr)';
  grid.style.gap = '6px 10px';
  grid.style.padding = '10px';
  grid.style.borderRadius = '10px';
  grid.style.background = 'rgba(255,255,255,0.04)';
  grid.style.border = '1px solid rgba(255,255,255,0.08)';
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

  const hostInfoEl = addRow('host.getInfo()');
  const permsEl = addRow('host.listPermissions()');
  const capsEl = addRow('host.listCapabilities()');
  const registryDescribeEl = addRow(`${REGISTRY_ID}.describe`);
  const registryListEl = addRow(`${REGISTRY_ID}.list`);
  const errorEl = addRow('Last error');

  async function refresh() {
    status.textContent = 'loading...';
    errorEl.textContent = '-';
    try {
      const info = api && api.host && typeof api.host.getInfo === 'function' ? api.host.getInfo() : null;
      hostInfoEl.textContent = safeJson(info, String(info || '-'));

      const perms =
        api && api.host && typeof api.host.listPermissions === 'function'
          ? api.host.listPermissions()
          : [];
      permsEl.textContent = Array.isArray(perms) ? perms.join(', ') : '-';

      const caps =
        api && api.host && typeof api.host.listCapabilities === 'function'
          ? await api.host.listCapabilities()
          : [];
      capsEl.textContent = Array.isArray(caps) ? `${caps.length} capabilities\n${formatCapabilityList(caps, 12)}` : '-';

      const describe =
        api && api.host && typeof api.host.invokeCapability === 'function'
          ? await api.host.invokeCapability(REGISTRY_ID, 'describe')
          : null;
      registryDescribeEl.textContent = safeJson(describe, String(describe || '-'));

      const listed =
        api && api.host && typeof api.host.invokeCapability === 'function'
          ? await api.host.invokeCapability(REGISTRY_ID, 'list')
          : null;
      registryListEl.textContent = safeJson(listed, String(listed || '-'));

      status.textContent = 'ok';
    } catch (error) {
      status.textContent = 'error';
      errorEl.textContent = readErrorMessage(error);
    }
  }

  void refresh();

  return () => {
    container.innerHTML = '';
  };
}

