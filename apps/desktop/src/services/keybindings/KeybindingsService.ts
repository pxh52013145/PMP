import { createServiceToken } from '../../kernel';
import type { ContributionRegistryApi } from '../../kernel/ContributionRegistry';
import type { ScopedEventBus } from '../../kernel/EventBus';
import type { AppEvents } from '../../contracts/events';
import type { CommandsService } from '../commands/CommandsService';
import type { KeybindingContribution } from '../../contracts/contributions';
import {
  computeConflicts,
  formatChord,
  normalizeKeySequence,
  normalizeKeyToken,
  parseKeySequenceString,
  resolveKeybinding,
} from './KeybindingResolver';
import { loadUserKeybindings, saveUserKeybindings } from './KeybindingsStorage';
import type {
  KeybindingConflict,
  KeybindingContext,
  KeybindingRule,
  KeybindingsSnapshot,
  NormalizedChord,
  NormalizedKeybinding,
} from './types';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { parseWhenClause } from './WhenClause';

export interface KeybindingsService {
  getSnapshot(): KeybindingsSnapshot;
  setUserKeybindings(rules: Omit<KeybindingRule, 'source'>[]): void;
  resetUserKeybindings(): void;

  setContext(key: string, value: unknown): void;
  getContext(): Readonly<KeybindingContext>;

  /** Returns true if handled (preventDefault already applied). */
  handleKeyboardEvent(e: KeyboardEvent): boolean;
  destroy(): void;
}

export const KEYBINDINGS_SERVICE_TOKEN =
  createServiceToken<KeybindingsService>('service.keybindings');

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return target.isContentEditable;
}

function keyboardEventToChord(e: KeyboardEvent): NormalizedChord {
  const keyRaw = e.key;
  const key = (() => {
    if (keyRaw === ' ') return 'space';
    // Normalize common browser key names.
    const lowered = keyRaw.toLowerCase();
    return normalizeKeyToken(lowered);
  })();

  return {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    key,
  };
}

function normalizeRule(rule: KeybindingRule): NormalizedKeybinding | null {
  const chords = parseKeySequenceString(rule.key);
  if (!chords) return null;
  const whenParsed = parseWhenClause(rule.when);
  return {
    rule,
    chords,
    normalizedKey: normalizeKeySequence(chords),
    firstChord: formatChord(chords[0]!),
    whenExpr: whenParsed.expr,
    ...(whenParsed.error ? { whenError: whenParsed.error } : {}),
  };
}

function sortDefaults(rules: KeybindingRule[]): KeybindingRule[] {
  return [...rules].sort((a, b) => {
    const wa = a.weight ?? 0;
    const wb = b.weight ?? 0;
    if (wa !== wb) return wa - wb;
    return a.key.localeCompare(b.key);
  });
}

export class DefaultKeybindingsService implements KeybindingsService {
  private context: KeybindingContext = {};

  private defaults: KeybindingRule[] = [];
  private user: KeybindingRule[] = [];
  private effective: NormalizedKeybinding[] = [];
  private conflicts: KeybindingConflict[] = [];
  private byFirstChord = new Map<string, NormalizedKeybinding[]>();

  private chordBuffer: NormalizedChord[] = [];
  private chordTimer: number | null = null;

  private lastNonKeyboardKey: null | 'mouse4' | 'mouse5' = null;
  private lastNonKeyboardKeyAtMs = 0;

  private unlistenDomMouseSideButtons: null | (() => void) = null;
  private unlistenTauriMouseSideButton: null | (() => void) = null;
  private unlistenContribs: null | (() => void) = null;

  constructor(
    private readonly events: ScopedEventBus<AppEvents>,
    private readonly contributions: ContributionRegistryApi,
    private readonly commands: CommandsService
  ) {
    this.user = loadUserKeybindings();
    this.refreshDefaultsFromContributions();
    this.rebuildEffective();

    this.unlistenDomMouseSideButtons = this.setupDomMouseSideButtons();
    this.unlistenContribs = this.contributions.subscribe(() => {
      this.refreshDefaultsFromContributions();
      this.rebuildEffective();
      this.events.emit('keybindings/changed', this.getSnapshot());
    });

    void this.setupTauriMouseSideButtons();
  }

  getSnapshot(): KeybindingsSnapshot {
    return {
      defaults: [...this.defaults],
      user: [...this.user],
      effective: [...this.effective],
      conflicts: [...this.conflicts],
    };
  }

  setUserKeybindings(rules: Omit<KeybindingRule, 'source'>[]): void {
    this.user = rules.map((r) => ({ ...r, source: 'user' }));
    saveUserKeybindings(this.user);
    this.rebuildEffective();
    this.events.emit('keybindings/changed', this.getSnapshot());
  }

  resetUserKeybindings(): void {
    this.user = [];
    saveUserKeybindings(this.user);
    this.rebuildEffective();
    this.events.emit('keybindings/changed', this.getSnapshot());
  }

  setContext(key: string, value: unknown): void {
    if (this.context[key] === value) return;
    this.context[key] = value;
  }

  getContext(): Readonly<KeybindingContext> {
    return this.context;
  }

  handleKeyboardEvent(e: KeyboardEvent): boolean {
    if (isEditableTarget(e.target)) return false;

    const chord = keyboardEventToChord(e);

    // Ignore key repeat so "hold" doesn't spam commands / break chord mode.
    if (e.repeat && this.chordBuffer.length > 0) {
      const last = this.chordBuffer[this.chordBuffer.length - 1];
      if (
        last &&
        last.ctrl === chord.ctrl &&
        last.shift === chord.shift &&
        last.alt === chord.alt &&
        last.meta === chord.meta &&
        normalizeKeyToken(last.key) === normalizeKeyToken(chord.key)
      ) {
        e.preventDefault();
        return true;
      }
    }

    // Escape cancels chord mode, but may also be bound.
    if (normalizeKeyToken(chord.key) === 'escape' && this.chordBuffer.length > 0) {
      this.clearChordBuffer();
      e.preventDefault();
      return true;
    }

    const pressed = [...this.chordBuffer, chord];
    const result = this.resolve(pressed);
    if (result.kind === 'no-match') {
      // If we were in chord mode, reset and allow the key to propagate.
      if (this.chordBuffer.length > 0) {
        this.clearChordBuffer();
      }
      return false;
    }

    // We are handling it.
    e.preventDefault();

    if (result.kind === 'more-chords-needed') {
      this.chordBuffer = pressed;
      this.armChordTimeout();
      return true;
    }

    this.clearChordBuffer();

    const command = result.binding.rule.command;
    if (!command) return true;
    if (command.startsWith('-')) return true;
    if (command.trim().length === 0) return true;

    if (e.repeat) {
      // Swallow repeat without re-dispatching.
      return true;
    }

    void this.commands.dispatch(command, result.binding.rule.args).catch((error) => {
      console.warn(`[keybindings] command failed: ${command}`, error);
    });
    return true;
  }

  destroy(): void {
    this.clearChordBuffer();
    try {
      this.unlistenDomMouseSideButtons?.();
    } catch {
      // ignore
    } finally {
      this.unlistenDomMouseSideButtons = null;
    }

    try {
      this.unlistenTauriMouseSideButton?.();
    } catch {
      // ignore
    } finally {
      this.unlistenTauriMouseSideButton = null;
    }

    try {
      this.unlistenContribs?.();
    } catch {
      // ignore
    } finally {
      this.unlistenContribs = null;
    }
  }

  private refreshDefaultsFromContributions(): void {
    const contribs = this.contributions.list<KeybindingContribution>('keybinding');
    const defaults: KeybindingRule[] = [];
    for (const c of contribs) {
      // keybinding contributions are treated as defaults (builtin or plugin)
      defaults.push({
        key: c.key,
        command: c.command,
        when: c.when,
        args: c.args,
        source: c.source === 'plugin' ? 'plugin' : 'default',
        weight: c.weight,
      });
    }
    this.defaults = sortDefaults(defaults);
  }

  private rebuildEffective(): void {
    const normalized: NormalizedKeybinding[] = [];
    const merged = [...this.defaults, ...this.user];
    for (const rule of merged) {
      const n = normalizeRule(rule);
      if (!n) continue;
      normalized.push(n);
    }
    this.effective = normalized;
    const byFirstChord = new Map<string, NormalizedKeybinding[]>();
    for (const binding of normalized) {
      const list = byFirstChord.get(binding.firstChord) ?? [];
      list.push(binding);
      byFirstChord.set(binding.firstChord, list);
    }
    this.byFirstChord = byFirstChord;
    this.conflicts = computeConflicts(normalized);
  }

  private resolve(pressedChords: NormalizedChord[]) {
    const first = pressedChords[0];
    if (!first) return { kind: 'no-match' } as const;
    const firstKey = formatChord(first);
    const candidates = this.byFirstChord.get(firstKey);
    if (!candidates || candidates.length === 0) {
      return { kind: 'no-match' } as const;
    }
    return resolveKeybinding(candidates, pressedChords, this.context);
  }

  private armChordTimeout(): void {
    if (this.chordTimer !== null) return;
    this.chordTimer = window.setTimeout(() => {
      this.chordTimer = null;
      this.clearChordBuffer();
    }, 1500);
  }

  private clearChordBuffer(): void {
    this.chordBuffer = [];
    if (this.chordTimer !== null) {
      window.clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
  }

  private handleNonKeyboardKey(key: 'mouse4' | 'mouse5'): void {
    // De-dupe across DOM + Tauri sources (and down/up quirks).
    const now = Date.now();
    if (this.lastNonKeyboardKey === key && now - this.lastNonKeyboardKeyAtMs < 40) return;
    this.lastNonKeyboardKey = key;
    this.lastNonKeyboardKeyAtMs = now;

    // Mouse side buttons should not participate in chord mode.
    this.clearChordBuffer();

    const chord: NormalizedChord = { ctrl: false, shift: false, alt: false, meta: false, key };
    const result = this.resolve([chord]);
    if (result.kind !== 'matched') return;

    const command = result.binding.rule.command;
    if (!command || command.startsWith('-') || command.trim().length === 0) return;
    void this.commands.dispatch(command, result.binding.rule.args).catch((error) => {
      console.warn(`[keybindings] command failed: ${command}`, error);
    });
  }

  private setupDomMouseSideButtons(): null | (() => void) {
    if (typeof window === 'undefined') return null;
    if (isAuxWindowHash()) return null;

    let pressed: null | 3 | 4 = null;

    const stop = (event: MouseEvent) => {
      try {
        event.preventDefault();
      } catch {
        // ignore
      }
      try {
        event.stopPropagation();
      } catch {
        // ignore
      }
    };

    const onDown = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      stop(event);
      if (pressed === event.button) return;
      pressed = event.button as 3 | 4;
      const key = pressed === 3 ? 'mouse4' : 'mouse5';
      this.handleNonKeyboardKey(key);
    };

    const onUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      stop(event);
      if (pressed === null) {
        const key = event.button === 3 ? 'mouse4' : 'mouse5';
        this.handleNonKeyboardKey(key);
      }
      pressed = null;
    };

    window.addEventListener('mousedown', onDown, { capture: true, passive: false });
    window.addEventListener('mouseup', onUp, { capture: true, passive: false });

    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', onUp, true);
    };
  }

  private async setupTauriMouseSideButtons(): Promise<void> {
    if (!isTauriRuntime()) return;
    if (isAuxWindowHash()) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      type Payload = { button?: string };
      const unlisten = await listen<Payload>('mouse-side-button', (event) => {
        const btn = event.payload?.button;
        const key = btn === 'back' ? 'mouse4' : btn === 'forward' ? 'mouse5' : null;
        if (!key) return;
        try {
          console.debug('[keybindings] mouse-side-button', { button: btn, key });
        } catch {
          // ignore
        }
        this.handleNonKeyboardKey(key);
      });
      this.unlistenTauriMouseSideButton = unlisten;
    } catch (error) {
      console.warn('[keybindings] failed to listen mouse-side-button', error);
    }
  }
}

function isAuxWindowHash(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash ?? '';
  return (
    hash.startsWith('#/editor/') || hash.startsWith('#/plugin-window/') || hash.startsWith('#/vst-manager')
  );
}
