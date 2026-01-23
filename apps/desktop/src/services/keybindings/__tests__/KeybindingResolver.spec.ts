import { describe, expect, it } from 'vitest';
import {
  formatChord,
  normalizeKeySequence,
  parseKeySequenceString,
  resolveKeybinding,
} from '../KeybindingResolver';
import { parseWhenClause } from '../WhenClause';
import type { KeybindingRule, NormalizedKeybinding } from '../types';

function makeBinding(rule: KeybindingRule): NormalizedKeybinding {
  const chords = parseKeySequenceString(rule.key);
  if (!chords) {
    throw new Error(`Invalid key sequence: ${rule.key}`);
  }
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

describe('KeybindingResolver', () => {
  it('matches single chord bindings', () => {
    const bindings = [
      makeBinding({ key: 'space', command: 'a', source: 'default' }),
      makeBinding({ key: 'ctrl+shift+p', command: 'b', source: 'default' }),
    ];

    const pressed = parseKeySequenceString('space')!;
    const result = resolveKeybinding(bindings, pressed, {});
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') {
      expect(result.binding.rule.command).toBe('a');
    }
  });

  it('supports chord sequences (more-chords-needed)', () => {
    const bindings = [makeBinding({ key: 'ctrl+k ctrl+s', command: 'open', source: 'default' })];
    const first = parseKeySequenceString('ctrl+k')!;
    const r1 = resolveKeybinding(bindings, first, {});
    expect(r1.kind).toBe('more-chords-needed');

    const full = parseKeySequenceString('ctrl+k ctrl+s')!;
    const r2 = resolveKeybinding(bindings, full, {});
    expect(r2.kind).toBe('matched');
    if (r2.kind === 'matched') {
      expect(r2.binding.rule.command).toBe('open');
    }
  });

  it('respects when clause evaluation', () => {
    const bindings = [
      makeBinding({ key: 'space', command: 'a', when: 'flag', source: 'default' }),
      makeBinding({ key: 'space', command: 'b', when: '!flag', source: 'default' }),
    ];

    const pressed = parseKeySequenceString('space')!;
    const r1 = resolveKeybinding(bindings, pressed, { flag: true });
    expect(r1.kind).toBe('matched');
    if (r1.kind === 'matched') expect(r1.binding.rule.command).toBe('a');

    const r2 = resolveKeybinding(bindings, pressed, { flag: false });
    expect(r2.kind).toBe('matched');
    if (r2.kind === 'matched') expect(r2.binding.rule.command).toBe('b');
  });

  it('scans from bottom to top (last wins)', () => {
    const bindings = [
      makeBinding({ key: 'space', command: 'first', source: 'default' }),
      makeBinding({ key: 'space', command: 'last', source: 'user' }),
    ];
    const pressed = parseKeySequenceString('space')!;
    const result = resolveKeybinding(bindings, pressed, {});
    expect(result.kind).toBe('matched');
    if (result.kind === 'matched') expect(result.binding.rule.command).toBe('last');
  });
});

