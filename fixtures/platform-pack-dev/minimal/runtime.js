export const WORKSPACE_VISIBLE_TEXT = 'PMP Dev Fixture v1';

export function createRuntimeApi() {
  return {
    auth: {
      async getSnapshot() {
        return {
          ok: true,
          data: {
            authState: 'authorized',
            accountId: 'dev-fixture',
            updatedAtMs: Date.now(),
          },
        };
      },
      async refreshSnapshot() {
        return {
          ok: true,
          data: {
            authState: 'authorized',
            accountId: 'dev-fixture',
            updatedAtMs: Date.now(),
          },
        };
      },
    },
    metadata: {
      source: 'platform-pack-dev-fixture',
      mode: 'runtime-api',
    },
  };
}

export function mountPage(container, api, mountContext) {
  const doc = container.ownerDocument || document;
  const root = doc.createElement('main');
  root.style.cssText = [
    'box-sizing:border-box',
    'min-height:100%',
    'padding:24px',
    'display:flex',
    'flex-direction:column',
    'gap:14px',
    'background:#0b121a',
    'color:#e8f7ff',
    'font-family:Segoe UI,Arial,sans-serif',
  ].join(';');

  const title = doc.createElement('h1');
  title.textContent = WORKSPACE_VISIBLE_TEXT;
  title.style.cssText = 'margin:0;font-size:24px;line-height:1.2';

  const meta = doc.createElement('code');
  meta.textContent = JSON.stringify(
    {
      connectorId: mountContext && mountContext.connectorId,
      platformId: mountContext && mountContext.platformId,
      instanceId: mountContext && mountContext.instanceId,
    },
    null,
    2
  );
  meta.style.cssText = [
    'white-space:pre-wrap',
    'padding:12px',
    'border-radius:8px',
    'background:rgba(103,232,249,0.08)',
    'color:#b8efff',
  ].join(';');

  const note = doc.createElement('p');
  note.textContent =
    'Change WORKSPACE_VISIBLE_TEXT in runtime.js, then use Reload Pack from Plugin Development Workspace.';
  note.style.cssText = 'margin:0;color:rgba(232,247,255,0.72);font-size:13px;line-height:1.5';

  root.appendChild(title);
  root.appendChild(meta);
  root.appendChild(note);
  container.appendChild(root);

  if (api && api.telemetry && typeof api.telemetry.info === 'function') {
    api.telemetry.info('platform-pack-dev-fixture.mounted', {
      text: WORKSPACE_VISIBLE_TEXT,
    });
  }

  return () => {
    root.remove();
  };
}
