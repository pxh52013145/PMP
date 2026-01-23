import type {
  KeybindingContext,
  KeybindingConflict,
  NormalizedChord,
  NormalizedKeybinding,
} from './types';
import { evaluateWhenExpr } from './WhenClause';

export type ResolveResult =
  | { kind: 'no-match' }
  | { kind: 'more-chords-needed' }
  | { kind: 'matched'; binding: NormalizedKeybinding };

export function normalizeKeyToken(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (!token) return token;
  if (token === 'esc') return 'escape';
  if (token === ' ') return 'space';
  return token;
}

export function formatChord(chord: NormalizedChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('ctrl');
  if (chord.shift) parts.push('shift');
  if (chord.alt) parts.push('alt');
  if (chord.meta) parts.push('meta');
  parts.push(normalizeKeyToken(chord.key));
  return parts.join('+');
}

export function normalizeKeySequence(chords: NormalizedChord[]): string {
  return chords.map((c) => formatChord(c)).join(' ');
}

export function parseChordString(input: string): NormalizedChord | null {
  const parts = input
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key: string | null = null;

  for (const raw of parts) {
    const token = raw.toLowerCase();
    if (token === 'ctrl' || token === 'control') {
      ctrl = true;
      continue;
    }
    if (token === 'shift') {
      shift = true;
      continue;
    }
    if (token === 'alt' || token === 'option') {
      alt = true;
      continue;
    }
    if (
      token === 'meta' ||
      token === 'cmd' ||
      token === 'command' ||
      token === 'win' ||
      token === 'super'
    ) {
      meta = true;
      continue;
    }

    // treat the first non-modifier as key; ignore extras for now.
    if (!key) {
      key = token;
    }
  }

  if (!key) return null;
  return { ctrl, shift, alt, meta, key: normalizeKeyToken(key) };
}

export function parseKeySequenceString(input: string): NormalizedChord[] | null {
  const chordStrings = input
    .trim()
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (chordStrings.length === 0) return null;

  const chords: NormalizedChord[] = [];
  for (const chordString of chordStrings) {
    const chord = parseChordString(chordString);
    if (!chord) return null;
    chords.push(chord);
  }
  return chords;
}

function isPrefixOf(pressed: NormalizedChord[], candidate: NormalizedChord[]): boolean {
  if (pressed.length > candidate.length) return false;
  for (let i = 0; i < pressed.length; i += 1) {
    const a = pressed[i];
    const b = candidate[i];
    if (!a || !b) return false;
    if (a.ctrl !== b.ctrl) return false;
    if (a.shift !== b.shift) return false;
    if (a.alt !== b.alt) return false;
    if (a.meta !== b.meta) return false;
    if (normalizeKeyToken(a.key) !== normalizeKeyToken(b.key)) return false;
  }
  return true;
}

export function resolveKeybinding(
  bindings: NormalizedKeybinding[],
  pressedChords: NormalizedChord[],
  context: KeybindingContext
): ResolveResult {
  // VSCode-like: scan from bottom to top; first match wins.
  for (let i = bindings.length - 1; i >= 0; i -= 1) {
    const candidate = bindings[i];
    if (!candidate) continue;
    if (!isPrefixOf(pressedChords, candidate.chords)) continue;
    if (!evaluateWhenExpr(candidate.whenExpr, context)) continue;

    if (pressedChords.length < candidate.chords.length) {
      return { kind: 'more-chords-needed' };
    }
    return { kind: 'matched', binding: candidate };
  }
  return { kind: 'no-match' };
}

export function computeConflicts(bindings: NormalizedKeybinding[]): KeybindingConflict[] {
  const byKey = new Map<string, Map<string, Set<string>>>();

  for (const b of bindings) {
    const command = b.rule.command;
    if (!command) continue;
    if (command.startsWith('-')) continue;

    const when = (b.rule.when ?? '').trim() || 'true';
    let byWhen = byKey.get(b.normalizedKey);
    if (!byWhen) {
      byWhen = new Map();
      byKey.set(b.normalizedKey, byWhen);
    }
    let set = byWhen.get(when);
    if (!set) {
      set = new Set();
      byWhen.set(when, set);
    }
    set.add(command);
  }

  const result: KeybindingConflict[] = [];
  for (const [normalizedKey, byWhen] of byKey.entries()) {
    for (const [when, commandSet] of byWhen.entries()) {
      if (commandSet.size <= 1) continue;
      result.push({
        normalizedKey,
        when,
        commandIds: Array.from(commandSet.values()).sort(),
      });
    }
  }
  return result.sort((a, b) => a.normalizedKey.localeCompare(b.normalizedKey));
}
