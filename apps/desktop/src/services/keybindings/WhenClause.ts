import type { KeybindingContext, WhenExpr, WhenValue } from './types';

type Token =
  | { kind: 'identifier'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: '!' | '&&' | '||' | '==' | '!=' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function isIdentChar(ch: string): boolean {
  return /[a-z0-9_.:-]/i.test(ch);
}

function tokenize(input: string): { tokens: Token[]; error: string | null } {
  const tokens: Token[] = [];
  let i = 0;

  const pushError = (message: string) => ({ tokens, error: message });

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === '&') {
      if (input.slice(i, i + 2) !== '&&') return pushError('Expected "&&"');
      tokens.push({ kind: 'op', value: '&&' });
      i += 2;
      continue;
    }
    if (ch === '|') {
      if (input.slice(i, i + 2) !== '||') return pushError('Expected "||"');
      tokens.push({ kind: 'op', value: '||' });
      i += 2;
      continue;
    }

    if (ch === '!') {
      if (input.slice(i, i + 2) === '!=') {
        tokens.push({ kind: 'op', value: '!=' });
        i += 2;
        continue;
      }
      tokens.push({ kind: 'op', value: '!' });
      i += 1;
      continue;
    }

    if (ch === '=') {
      if (input.slice(i, i + 2) !== '==') return pushError('Expected "=="');
      tokens.push({ kind: 'op', value: '==' });
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let value = '';
      let closed = false;
      while (i < input.length) {
        const c = input[i]!;
        if (c === '\\') {
          const next = input[i + 1];
          if (typeof next === 'undefined') return pushError('Unterminated string');
          value += next;
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          closed = true;
          break;
        }
        value += c;
        i += 1;
      }
      if (!closed) return pushError('Unterminated string');
      tokens.push({ kind: 'string', value });
      continue;
    }

    // number literal
    if (/[0-9]/.test(ch)) {
      let raw = ch;
      i += 1;
      while (i < input.length && /[0-9.]/.test(input[i]!)) {
        raw += input[i]!;
        i += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) return pushError(`Invalid number: ${raw}`);
      tokens.push({ kind: 'number', value });
      continue;
    }

    // identifier
    if (isIdentChar(ch)) {
      let raw = ch;
      i += 1;
      while (i < input.length && isIdentChar(input[i]!)) {
        raw += input[i]!;
        i += 1;
      }
      tokens.push({ kind: 'identifier', value: raw });
      continue;
    }

    return pushError(`Unexpected character: ${ch}`);
  }

  return { tokens, error: null };
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}

export function evaluateWhenExpr(expr: WhenExpr, context: KeybindingContext): boolean {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'key':
      return truthy(context[expr.key]);
    case 'equals':
      return context[expr.key] === expr.value;
    case 'notEquals':
      return context[expr.key] !== expr.value;
    case 'not':
      return !evaluateWhenExpr(expr.expr, context);
    case 'and':
      return evaluateWhenExpr(expr.left, context) && evaluateWhenExpr(expr.right, context);
    case 'or':
      return evaluateWhenExpr(expr.left, context) || evaluateWhenExpr(expr.right, context);
    default: {
      const _exhaustive: never = expr;
      return _exhaustive;
    }
  }
}

function parseValueToken(token: Token): WhenValue | null {
  if (token.kind === 'string') return token.value;
  if (token.kind === 'number') return token.value;
  if (token.kind === 'identifier') {
    const lowered = token.value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    // VSCode-like: unquoted identifiers on RHS are treated as string values.
    return token.value;
  }
  return null;
}

export type WhenParseResult = { expr: WhenExpr; error: string | null };

export function parseWhenClause(input: string | undefined): WhenParseResult {
  if (!input) return { expr: { kind: 'literal', value: true }, error: null };
  const raw = input.trim();
  if (!raw) return { expr: { kind: 'literal', value: true }, error: null };

  const lowered = raw.toLowerCase();
  if (lowered === 'true') return { expr: { kind: 'literal', value: true }, error: null };
  if (lowered === 'false') return { expr: { kind: 'literal', value: false }, error: null };

  const { tokens, error: tokenizeError } = tokenize(raw);
  if (tokenizeError) {
    return { expr: { kind: 'literal', value: false }, error: tokenizeError };
  }

  let index = 0;
  const peek = () => tokens[index] ?? null;
  const consume = () => {
    const token = tokens[index] ?? null;
    index += 1;
    return token;
  };

  const parseExpression = (): WhenExpr | null => parseOr();

  const parseOr = (): WhenExpr | null => {
    let left = parseAnd();
    if (!left) return null;
    let token = peek();
    while (token?.kind === 'op' && token.value === '||') {
      consume();
      const right = parseAnd();
      if (!right) return null;
      left = { kind: 'or', left, right };
      token = peek();
    }
    return left;
  };

  const parseAnd = (): WhenExpr | null => {
    let left = parseNot();
    if (!left) return null;
    let token = peek();
    while (token?.kind === 'op' && token.value === '&&') {
      consume();
      const right = parseNot();
      if (!right) return null;
      left = { kind: 'and', left, right };
      token = peek();
    }
    return left;
  };

  const parseNot = (): WhenExpr | null => {
    const token = peek();
    if (token?.kind === 'op' && token.value === '!') {
      consume();
      const expr = parseNot();
      if (!expr) return null;
      return { kind: 'not', expr };
    }
    return parsePrimary();
  };

  const parsePrimary = (): WhenExpr | null => {
    const token = peek();
    if (!token) return null;

    if (token.kind === 'lparen') {
      consume();
      const expr = parseExpression();
      const close = consume();
      if (!expr) return null;
      if (!close || close.kind !== 'rparen') return null;
      return expr;
    }

    if (token.kind === 'identifier') {
      const ident = token.value;
      consume();

      const next = peek();
      if (next?.kind === 'op' && (next.value === '==' || next.value === '!=')) {
        const op = next.value;
        consume();
        const valueToken = consume();
        if (!valueToken) return null;
        const value = parseValueToken(valueToken);
        if (value === null) return null;
        return op === '=='
          ? { kind: 'equals', key: ident, value }
          : { kind: 'notEquals', key: ident, value };
      }

      // identifier alone means truthy(key)
      if (ident.trim().toLowerCase() === 'true') return { kind: 'literal', value: true };
      if (ident.trim().toLowerCase() === 'false') return { kind: 'literal', value: false };
      return { kind: 'key', key: ident };
    }

    // Only identifiers / parentheses are supported as boolean atoms.
    return null;
  };

  const expr = parseExpression();
  if (!expr) {
    return { expr: { kind: 'literal', value: false }, error: 'Failed to parse when clause' };
  }

  if (index !== tokens.length) {
    return { expr: { kind: 'literal', value: false }, error: 'Unexpected trailing tokens' };
  }

  return { expr, error: null };
}
