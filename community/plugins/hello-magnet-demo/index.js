function createRoot(container) {
  const root = document.createElement('div');
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.justifyContent = 'space-between';
  root.style.gap = '8px';
  root.style.padding = '10px';
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

function safeReadThemeVariant(context) {
  const theme = context && typeof context === 'object' ? context.theme : null;
  const variant = theme && typeof theme === 'object' ? theme.variant : null;
  return typeof variant === 'string' && variant.trim().length > 0 ? variant.trim() : 'default';
}

export function mount(container, api, context) {
  void api;
  const root = createRoot(container);

  const title = document.createElement('div');
  title.textContent = 'Hello Magnet Demo';
  title.style.fontWeight = '800';
  title.style.fontSize = '13px';
  title.style.letterSpacing = '0.02em';
  root.appendChild(title);

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '6px';
  body.style.fontSize = '11px';
  body.style.opacity = '0.9';
  root.appendChild(body);

  const themeLine = document.createElement('div');
  themeLine.textContent = `Theme variant: ${safeReadThemeVariant(context)}`;
  body.appendChild(themeLine);

  const note = document.createElement('div');
  note.textContent = 'Purpose: smoke-test install + mount + cleanup in both inline and sandbox runtimes.';
  note.style.opacity = '0.8';
  body.appendChild(note);

  const footer = document.createElement('div');
  footer.textContent = 'No permissions required.';
  footer.style.fontSize = '10px';
  footer.style.opacity = '0.7';
  root.appendChild(footer);

  return () => {
    container.innerHTML = '';
  };
}

