import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommandContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import './CommandPalette.css';

type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function sortCommands(a: CommandContribution, b: CommandContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const kernel = useKernel();
  const commands = kernel.services.get(COMMANDS_SERVICE_TOKEN);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [registryRevision, setRegistryRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [argsText, setArgsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRegistryRevision((value) => value + 1));
  }, [kernel.contributions]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRunningId(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(() => {
    void registryRevision;
    const q = normalizeText(query);
    return commands
      .list()
      .filter((cmd) => {
        if (!q) return true;
        const haystack = `${cmd.id} ${cmd.title} ${cmd.description ?? ''} ${(cmd.tags ?? []).join(' ')}`;
        return normalizeText(haystack).includes(q);
      })
      .sort(sortCommands)
      .slice(0, 50);
  }, [commands, query, registryRevision]);

  const parseArgs = (): unknown => {
    const raw = argsText.trim();
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch (err) {
      throw new Error(`Args JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const run = async (id: string) => {
    setError(null);
    setRunningId(id);

    try {
      await commands.dispatch(id, parseArgs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="command-palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true">
        <div className="command-palette-header">
          <input
            ref={inputRef}
            value={query}
            placeholder="Search commands…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
              }
              if (e.key === 'Enter') {
                const first = filtered[0];
                if (first) {
                  e.preventDefault();
                  void run(first.id);
                }
              }
            }}
          />
          <button type="button" className="command-palette-close" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="command-palette-args">
          <textarea
            value={argsText}
            placeholder="Args JSON (optional)"
            onChange={(e) => setArgsText(e.target.value)}
          />
        </div>

        {error && <div className="command-palette-error">{error}</div>}

        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">No commands registered.</div>
          ) : (
            <ul>
              {filtered.map((cmd) => (
                <li key={cmd.id}>
                  <button
                    type="button"
                    className="command-palette-item"
                    disabled={runningId === cmd.id}
                    onClick={() => void run(cmd.id)}
                    title={cmd.id}
                  >
                    <div className="command-palette-item-title">{cmd.title}</div>
                    <div className="command-palette-item-meta">
                      <span className="command-palette-item-id">{cmd.id}</span>
                      {cmd.source && <span className="command-palette-item-source">{cmd.source}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

