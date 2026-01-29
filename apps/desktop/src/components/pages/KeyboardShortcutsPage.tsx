import './KeyboardShortcutsPage.css';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n';
import { KEYBINDINGS_SERVICE_TOKEN, type KeybindingRule } from '../../services/keybindings';
import type { KeybindingsSnapshot } from '../../services/keybindings/types';
import { parseWhenClause } from '../../services/keybindings/WhenClause';

type ColumnKey = 'key' | 'command' | 'when' | 'source';
type ColumnWidths = Record<ColumnKey, number>;
type ResizeState = {
  column: ColumnKey;
  startX: number;
  startWidth: number;
  pendingWidth: number;
  rafId: number | null;
  moveListener: (event: MouseEvent) => void;
  upListener: (event: MouseEvent) => void;
  previousCursor: string;
  previousUserSelect: string;
};

const DEFAULT_COLUMN_WIDTHS: ColumnWidths = {
  key: 220,
  command: 360,
  when: 280,
  source: 86,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getMinColumnWidth(column: ColumnKey): number {
  if (column === 'source') return 72;
  if (column === 'key') return 160;
  if (column === 'when') return 160;
  return 220;
}

function getMaxColumnWidth(column: ColumnKey): number {
  if (column === 'source') return 140;
  return 900;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac');
}

function formatKeycapToken(token: string, isMac: boolean): string {
  const t = token.trim().toLowerCase();
  if (!t) return token;

  if (t === 'ctrl') return isMac ? '\u2303' : 'Ctrl';
  if (t === 'shift') return isMac ? '\u21E7' : 'Shift';
  if (t === 'alt') return isMac ? '\u2325' : 'Alt';
  if (t === 'meta') return isMac ? '\u2318' : 'Win';

  if (t === 'escape') return 'Esc';
  if (t === 'space') return 'Space';
  if (t === 'tab') return 'Tab';
  if (t === 'enter') return isMac ? '\u23CE' : 'Enter';
  if (t === 'backspace') return isMac ? '\u232B' : 'Backspace';
  if (t === 'delete') return isMac ? '\u2326' : 'Del';

  if (t === 'arrowleft') return '\u2190';
  if (t === 'arrowright') return '\u2192';
  if (t === 'arrowup') return '\u2191';
  if (t === 'arrowdown') return '\u2193';

  if (t === 'pageup') return 'PgUp';
  if (t === 'pagedown') return 'PgDn';

  if (t === 'mediaplaypause') return '\u23EF';
  if (t === 'mediatracknext') return '\u23ED';
  if (t === 'mediatrackprevious') return '\u23EE';

  if (t === 'mouse4') return 'Mouse Back';
  if (t === 'mouse5') return 'Mouse Forward';

  if (/^f\\d{1,2}$/.test(t)) return t.toUpperCase();
  if (/^[a-z]$/.test(t)) return t.toUpperCase();

  return token;
}

function KeySequencePreview({ value }: { value: string }) {
  const isMac = isMacPlatform();
  const chords = value.trim().split(/\\s+/g).filter(Boolean);

  return (
    <span className="kbd-sequence" title={value} aria-label={value}>
      <span className="kbd-sequence-inner">
        {chords.map((chord, chordIndex) => {
          const parts = chord
            .split('+')
            .map((p) => p.trim())
            .filter(Boolean);

          return (
            <span className="kbd-chord" key={`${chordIndex}:${chord}`}>
              {parts.map((part, partIndex) => (
                <span className="kbd-part" key={`${partIndex}:${part}`}>
                  <kbd className="kbd-key">{formatKeycapToken(part, isMac)}</kbd>
                  {partIndex < parts.length - 1 ? <span className="kbd-plus">+</span> : null}
                </span>
              ))}
            </span>
          );
        })}
      </span>
    </span>
  );
}

function toUserRuleJson(rules: KeybindingRule[]): string {
  const payload = rules
    .filter((r) => r.source === 'user')
    .map((r) => ({
      key: r.key,
      command: r.command,
      ...(typeof r.when === 'string' && r.when.trim() ? { when: r.when } : {}),
      ...(typeof r.args !== 'undefined' ? { args: r.args } : {}),
      ...(typeof r.weight === 'number' && Number.isFinite(r.weight) ? { weight: r.weight } : {}),
    }));
  return JSON.stringify(payload, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUserRulesJson(input: string): {
  ok: true;
  rules: Omit<KeybindingRule, 'source'>[];
} | {
  ok: false;
  error:
    | { kind: 'invalidJson'; message: string }
    | { kind: 'expectedArray' }
    | { kind: 'ruleNotObject'; index: number }
    | { kind: 'keyInvalid'; index: number }
    | { kind: 'commandInvalid'; index: number }
    | { kind: 'whenInvalidType'; index: number }
    | { kind: 'weightInvalid'; index: number }
    | { kind: 'whenParseFailed'; index: number; message: string };
} {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { kind: 'invalidJson', message } };
  }

  if (!Array.isArray(raw)) {
    return { ok: false, error: { kind: 'expectedArray' } };
  }

  const rules: Omit<KeybindingRule, 'source'>[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!isRecord(item)) {
      return { ok: false, error: { kind: 'ruleNotObject', index: i } };
    }

    const key = item.key;
    const command = item.command;
    const when = item.when;
    const args = item.args;
    const weight = item.weight;

    if (typeof key !== 'string' || key.trim().length === 0) {
      return { ok: false, error: { kind: 'keyInvalid', index: i } };
    }
    if (typeof command !== 'string') {
      return { ok: false, error: { kind: 'commandInvalid', index: i } };
    }
    if (typeof when !== 'undefined' && typeof when !== 'string') {
      return { ok: false, error: { kind: 'whenInvalidType', index: i } };
    }
    if (typeof weight !== 'undefined') {
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        return { ok: false, error: { kind: 'weightInvalid', index: i } };
      }
    }

    if (typeof when === 'string' && when.trim()) {
      const parsed = parseWhenClause(when);
      if (parsed.error) {
        return { ok: false, error: { kind: 'whenParseFailed', index: i, message: parsed.error } };
      }
    }

    rules.push({
      key: key.trim(),
      command,
      ...(typeof when === 'string' && when.trim() ? { when } : {}),
      ...(typeof args !== 'undefined' ? { args } : {}),
      ...(typeof weight === 'number' ? { weight } : {}),
    });
  }

  return { ok: true, rules };
}

export const KeyboardShortcutsPage: React.FC = () => {
  const kernel = useKernel();
  const t = useT();
  const keybindings = kernel.services.get(KEYBINDINGS_SERVICE_TOKEN);
  const isMac = isMacPlatform();

  const [snapshot, setSnapshot] = useState<KeybindingsSnapshot>(() => keybindings.getSnapshot());
  const [registryRevision, setRegistryRevision] = useState(0);

  const [filterText, setFilterText] = useState('');
  const [userJson, setUserJson] = useState(() => toUserRuleJson(snapshot.user));
  const [userJsonDirty, setUserJsonDirty] = useState(false);
  const [userJsonError, setUserJsonError] = useState<string | null>(null);

  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => DEFAULT_COLUMN_WIDTHS);
  const [resizingColumn, setResizingColumn] = useState<ColumnKey | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);

  const stopResize = useCallback(() => {
    const state = resizeStateRef.current;
    if (!state) return;
    resizeStateRef.current = null;

    window.removeEventListener('mousemove', state.moveListener);
    window.removeEventListener('mouseup', state.upListener);
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
    }

    document.body.style.cursor = state.previousCursor;
    document.body.style.userSelect = state.previousUserSelect;
    setResizingColumn(null);
  }, []);

  const startResize = useCallback(
    (column: ColumnKey, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      stopResize();

      const startWidth = columnWidths[column];
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      setResizingColumn(column);

      const state: ResizeState = {
        column,
        startX: event.clientX,
        startWidth,
        pendingWidth: startWidth,
        rafId: null,
        moveListener: () => {},
        upListener: () => {},
        previousCursor,
        previousUserSelect,
      };

      state.moveListener = (moveEvent: MouseEvent) => {
        const current = resizeStateRef.current;
        if (!current) return;

        const delta = moveEvent.clientX - current.startX;
        const nextWidth = clamp(
          current.startWidth + delta,
          getMinColumnWidth(current.column),
          getMaxColumnWidth(current.column)
        );
        if (nextWidth === current.pendingWidth) return;

        current.pendingWidth = nextWidth;
        if (current.rafId !== null) return;
        current.rafId = requestAnimationFrame(() => {
          const latest = resizeStateRef.current;
          if (!latest) return;
          latest.rafId = null;
          const width = latest.pendingWidth;
          setColumnWidths((prev) => {
            if (prev[latest.column] === width) return prev;
            return { ...prev, [latest.column]: width };
          });
        });
      };

      state.upListener = () => {
        stopResize();
      };

      resizeStateRef.current = state;
      window.addEventListener('mousemove', state.moveListener);
      window.addEventListener('mouseup', state.upListener);
    },
    [columnWidths, stopResize]
  );

  const resetColumnWidth = useCallback((column: ColumnKey) => {
    setColumnWidths((prev) => {
      const next = DEFAULT_COLUMN_WIDTHS[column];
      if (prev[column] === next) return prev;
      return { ...prev, [column]: next };
    });
  }, []);

  useEffect(() => {
    setSnapshot(keybindings.getSnapshot());
    return kernel.events.on('keybindings/changed', (next) => {
      setSnapshot(next);
    });
  }, [kernel.events, keybindings]);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRegistryRevision((v) => v + 1));
  }, [kernel.contributions]);

  useEffect(() => {
    if (userJsonDirty) return;
    setUserJson(toUserRuleJson(snapshot.user));
  }, [snapshot.user, userJsonDirty]);

  useEffect(() => {
    return () => stopResize();
  }, [stopResize]);

  const commandsById = useMemo(() => {
    void registryRevision;
    const map = new Map<string, CommandContribution>();
    for (const cmd of kernel.contributions.list<CommandContribution>('command')) {
      map.set(cmd.id, cmd);
    }
    return map;
  }, [kernel.contributions, registryRevision]);

  const filteredBindings = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return snapshot.effective;

    return snapshot.effective.filter((b) => {
      const cmd = commandsById.get(b.rule.command);
      const haystacks = [
        b.normalizedKey,
        b.rule.command,
        cmd?.title ?? '',
        b.rule.when ?? '',
        b.rule.source,
      ];
      return haystacks.some((h) => h.toLowerCase().includes(q));
    });
  }, [commandsById, filterText, snapshot.effective]);

  const onApplyUserJson = useCallback(() => {
    const parsed = parseUserRulesJson(userJson);
    if (!parsed.ok) {
      const err = parsed.error;
      if (err.kind === 'invalidJson') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.invalidJson', { message: err.message }));
        return;
      }
      if (err.kind === 'expectedArray') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.expectedArray'));
        return;
      }
      if (err.kind === 'ruleNotObject') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.ruleNotObject', { index: err.index }));
        return;
      }
      if (err.kind === 'keyInvalid') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.keyInvalid', { index: err.index }));
        return;
      }
      if (err.kind === 'commandInvalid') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.commandInvalid', { index: err.index }));
        return;
      }
      if (err.kind === 'whenInvalidType') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.whenInvalidType', { index: err.index }));
        return;
      }
      if (err.kind === 'weightInvalid') {
        setUserJsonError(t('pages.keyboard-shortcuts.error.weightInvalid', { index: err.index }));
        return;
      }
      if (err.kind === 'whenParseFailed') {
        setUserJsonError(
          t('pages.keyboard-shortcuts.error.whenParseFailed', {
            index: err.index,
            message: err.message,
          })
        );
        return;
      }

      const _exhaustive: never = err;
      setUserJsonError(String(_exhaustive));
      return;
    }
    setUserJsonError(null);
    setUserJsonDirty(false);
    keybindings.setUserKeybindings(parsed.rules);
  }, [keybindings, t, userJson]);

  const onResetUserJson = useCallback(() => {
    setUserJsonError(null);
    setUserJsonDirty(false);
    keybindings.resetUserKeybindings();
  }, [keybindings]);

  const onReloadUserJson = useCallback(() => {
    setUserJsonError(null);
    setUserJsonDirty(false);
    setUserJson(toUserRuleJson(keybindings.getSnapshot().user));
  }, [keybindings]);

  return (
    <div className="page-keyboard-shortcuts" data-resizing={resizingColumn ? 'true' : 'false'}>
      <div className="keyboard-shortcuts-header">
        <div>
          <h1 className="keyboard-shortcuts-title">{t('pages.keyboard-shortcuts.title')}</h1>
          <p className="keyboard-shortcuts-subtitle">{t('pages.keyboard-shortcuts.subtitle')}</p>
        </div>
      </div>

      <div className="keyboard-shortcuts-toolbar">
        <input
          type="text"
          className="keyboard-shortcuts-search"
          placeholder={t('pages.keyboard-shortcuts.searchPlaceholder')}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <div className="keyboard-shortcuts-stats">
          {t('pages.keyboard-shortcuts.stats', {
            shown: filteredBindings.length,
            total: snapshot.effective.length,
          })}
        </div>
      </div>

      <div className="keyboard-shortcuts-layout">
        <section className="keyboard-shortcuts-card">
          <div className="keyboard-shortcuts-card-header">
            <h2 className="keyboard-shortcuts-card-title">
              {t('pages.keyboard-shortcuts.section.gestures.title')}
            </h2>
            <div className="keyboard-shortcuts-card-subtitle">
              {t('pages.keyboard-shortcuts.section.gestures.subtitle')}
            </div>
          </div>

          <div className="keyboard-shortcuts-gestures">
            <div className="keyboard-shortcuts-gesture-row">
              <div className="keyboard-shortcuts-gesture-key">
                <span className="kbd-sequence">
                  <span className="kbd-sequence-inner">
                    <span className="kbd-part">
                      <kbd className="kbd-key">
                        {formatKeycapToken(isMac ? 'meta' : 'ctrl', isMac)}
                      </kbd>
                      <span className="kbd-plus">+</span>
                    </span>
                    <span className="kbd-part">
                      <kbd className="kbd-key">
                        {t('pages.keyboard-shortcuts.gestures.token.leftClick')}
                      </kbd>
                    </span>
                  </span>
                </span>
              </div>
              <div className="keyboard-shortcuts-gesture-body">
                <div className="keyboard-shortcuts-gesture-title">
                  {t('pages.keyboard-shortcuts.gestures.focusMagnetInLibrary.title')}
                </div>
                <div className="keyboard-shortcuts-gesture-desc">
                  {t('pages.keyboard-shortcuts.gestures.focusMagnetInLibrary.desc')}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="keyboard-shortcuts-card">
          <div className="keyboard-shortcuts-card-header">
            <h2 className="keyboard-shortcuts-card-title">
              {t('pages.keyboard-shortcuts.section.bindings.title')}
            </h2>
            <div className="keyboard-shortcuts-card-subtitle">
              {t('pages.keyboard-shortcuts.section.bindings.subtitle')}
            </div>
          </div>

          <div className="keyboard-shortcuts-table-wrap">
            <table className="keyboard-shortcuts-table">
              <colgroup>
                <col style={{ width: columnWidths.key }} />
                <col style={{ width: columnWidths.command }} />
                <col style={{ width: columnWidths.when }} />
                <col style={{ width: columnWidths.source }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="keyboard-shortcuts-col keyboard-shortcuts-col--key">
                    <span className="keyboard-shortcuts-col-title">
                      {t('pages.keyboard-shortcuts.table.key')}
                    </span>
                    <div
                      className="keyboard-shortcuts-col-resizer"
                      data-active={resizingColumn === 'key' ? 'true' : 'false'}
                      onMouseDown={(e) => startResize('key', e)}
                      onDoubleClick={() => resetColumnWidth('key')}
                    />
                  </th>
                  <th className="keyboard-shortcuts-col keyboard-shortcuts-col--command">
                    <span className="keyboard-shortcuts-col-title">
                      {t('pages.keyboard-shortcuts.table.command')}
                    </span>
                    <div
                      className="keyboard-shortcuts-col-resizer"
                      data-active={resizingColumn === 'command' ? 'true' : 'false'}
                      onMouseDown={(e) => startResize('command', e)}
                      onDoubleClick={() => resetColumnWidth('command')}
                    />
                  </th>
                  <th className="keyboard-shortcuts-col keyboard-shortcuts-col--when">
                    <span className="keyboard-shortcuts-col-title">
                      {t('pages.keyboard-shortcuts.table.when')}
                    </span>
                    <div
                      className="keyboard-shortcuts-col-resizer"
                      data-active={resizingColumn === 'when' ? 'true' : 'false'}
                      onMouseDown={(e) => startResize('when', e)}
                      onDoubleClick={() => resetColumnWidth('when')}
                    />
                  </th>
                  <th className="keyboard-shortcuts-col keyboard-shortcuts-col--source">
                    <span className="keyboard-shortcuts-col-title">
                      {t('pages.keyboard-shortcuts.table.source')}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredBindings.map((b) => {
                  const cmd = commandsById.get(b.rule.command);
                  const title = cmd?.title ?? b.rule.command;
                  const whenText = (b.rule.when ?? '').trim() || 'true';
                  const sourceLabel =
                    b.rule.source === 'plugin'
                      ? t('common.source.plugin')
                      : b.rule.source === 'user'
                        ? t('common.source.user')
                        : t('common.source.builtin');
                  return (
                    <tr key={`${b.normalizedKey}/${b.rule.command}/${b.rule.source}/${whenText}`}>
                      <td className="keyboard-shortcuts-col keyboard-shortcuts-col--key">
                        <KeySequencePreview value={b.normalizedKey} />
                      </td>
                      <td className="keyboard-shortcuts-col keyboard-shortcuts-col--command" title={b.rule.command}>
                        <div className="cmd-title" title={title}>
                          {title}
                        </div>
                        <div className="cmd-id">
                          <code>{b.rule.command}</code>
                        </div>
                      </td>
                      <td className="keyboard-shortcuts-col keyboard-shortcuts-col--when">
                        <code className="when-code" title={whenText}>
                          {whenText}
                        </code>
                        {b.whenError ? (
                          <div className="when-error">{t('pages.keyboard-shortcuts.whenInvalid')}</div>
                        ) : null}
                      </td>
                      <td className="keyboard-shortcuts-col keyboard-shortcuts-col--source">
                        <span className={`source-tag source-tag--${b.rule.source}`}>{sourceLabel}</span>
                      </td>
                    </tr>
                  );
                })}

                {filteredBindings.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="keyboard-shortcuts-empty">
                      {t('pages.keyboard-shortcuts.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {snapshot.conflicts.length > 0 ? (
            <div className="keyboard-shortcuts-conflicts">
              <div className="keyboard-shortcuts-conflicts-title">
                {t('pages.keyboard-shortcuts.section.conflicts.title', { count: snapshot.conflicts.length })}
              </div>
              <ul className="keyboard-shortcuts-conflicts-list">
                {snapshot.conflicts.slice(0, 20).map((c) => (
                  <li key={`${c.normalizedKey}/${c.when}`}>
                    <code>{c.normalizedKey}</code> <span className="sep">{'\u2022'}</span>{' '}
                    <code>{c.when}</code> <span className="sep">{'\u2022'}</span>{' '}
                    <code>{c.commandIds.join(', ')}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="keyboard-shortcuts-card">
          <div className="keyboard-shortcuts-card-header">
            <h2 className="keyboard-shortcuts-card-title">
              {t('pages.keyboard-shortcuts.section.user.title')}
            </h2>
            <div className="keyboard-shortcuts-card-subtitle">
              {t('pages.keyboard-shortcuts.section.user.subtitle')}
            </div>
          </div>

          <textarea
            className="keyboard-shortcuts-editor"
            value={userJson}
            onChange={(e) => {
              setUserJson(e.target.value);
              setUserJsonDirty(true);
            }}
            spellCheck={false}
          />

          {userJsonError ? <div className="keyboard-shortcuts-error">{userJsonError}</div> : null}

          <div className="keyboard-shortcuts-actions">
            <button type="button" className="btn" onClick={onReloadUserJson}>
              {t('pages.keyboard-shortcuts.action.reload')}
            </button>
            <button type="button" className="btn btn-danger" onClick={onResetUserJson}>
              {t('pages.keyboard-shortcuts.action.reset')}
            </button>
            <button type="button" className="btn btn-primary" onClick={onApplyUserJson}>
              {t('pages.keyboard-shortcuts.action.apply')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};
