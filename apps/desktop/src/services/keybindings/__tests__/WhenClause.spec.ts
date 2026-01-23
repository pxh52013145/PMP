import { describe, expect, it } from 'vitest';
import { evaluateWhenExpr, parseWhenClause } from '../WhenClause';

describe('WhenClause', () => {
  it('treats empty as true', () => {
    expect(parseWhenClause(undefined)).toEqual({ expr: { kind: 'literal', value: true }, error: null });
    expect(parseWhenClause('')).toEqual({ expr: { kind: 'literal', value: true }, error: null });
    expect(parseWhenClause('   ')).toEqual({ expr: { kind: 'literal', value: true }, error: null });
  });

  it('supports key truthiness and negation', () => {
    const parsed = parseWhenClause('!audio.hasQueue');
    expect(parsed.error).toBeNull();
    expect(evaluateWhenExpr(parsed.expr, { 'audio.hasQueue': true })).toBe(false);
    expect(evaluateWhenExpr(parsed.expr, { 'audio.hasQueue': false })).toBe(true);
  });

  it('supports &&, ||, parentheses', () => {
    const parsed = parseWhenClause('(a && !b) || c');
    expect(parsed.error).toBeNull();
    expect(evaluateWhenExpr(parsed.expr, { a: true, b: false, c: false })).toBe(true);
    expect(evaluateWhenExpr(parsed.expr, { a: true, b: true, c: false })).toBe(false);
    expect(evaluateWhenExpr(parsed.expr, { a: false, b: false, c: true })).toBe(true);
  });

  it('supports == / != with unquoted string values', () => {
    const eq = parseWhenClause('audio.playbackState == playing');
    expect(eq.error).toBeNull();
    expect(evaluateWhenExpr(eq.expr, { 'audio.playbackState': 'playing' })).toBe(true);
    expect(evaluateWhenExpr(eq.expr, { 'audio.playbackState': 'paused' })).toBe(false);

    const ne = parseWhenClause('audio.playbackState != paused');
    expect(ne.error).toBeNull();
    expect(evaluateWhenExpr(ne.expr, { 'audio.playbackState': 'playing' })).toBe(true);
    expect(evaluateWhenExpr(ne.expr, { 'audio.playbackState': 'paused' })).toBe(false);
  });

  it('returns error for invalid clauses', () => {
    const parsed = parseWhenClause('a && (');
    expect(parsed.error).not.toBeNull();
    expect(evaluateWhenExpr(parsed.expr, { a: true })).toBe(false);
  });
});

