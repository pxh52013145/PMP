export type KeybindingSource = 'default' | 'plugin' | 'user';

export type KeybindingRule = {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  source: KeybindingSource;
  /**
   * Higher weight = higher precedence among defaults before user overrides are applied.
   * (User overrides are always appended and therefore win.)
   */
  weight?: number;
};

export type WhenValue = string | number | boolean;

/**
 * VSCode-like "when" clause expression (subset).
 * - Identifiers read from KeybindingContext by key name.
 * - `key` means truthy(context[key])
 * - `key == value` / `key != value` compares strictly (=== / !==)
 * - boolean ops: !, &&, || with parentheses
 */
export type WhenExpr =
  | { kind: 'literal'; value: boolean }
  | { kind: 'key'; key: string }
  | { kind: 'equals'; key: string; value: WhenValue }
  | { kind: 'notEquals'; key: string; value: WhenValue }
  | { kind: 'not'; expr: WhenExpr }
  | { kind: 'and'; left: WhenExpr; right: WhenExpr }
  | { kind: 'or'; left: WhenExpr; right: WhenExpr };

export type NormalizedChord = {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
};

export type NormalizedKeybinding = {
  rule: KeybindingRule;
  /** Space-separated chord list */
  chords: NormalizedChord[];
  /** Canonical string for quick comparisons */
  normalizedKey: string;
  /** Canonical string for the first chord (for indexing) */
  firstChord: string;
  /** Parsed when-clause (invalid when => literal false) */
  whenExpr: WhenExpr;
  /** Parse error for display/debugging (optional) */
  whenError?: string;
};

export type KeybindingConflict = {
  normalizedKey: string;
  when: string;
  commandIds: string[];
};

export type KeybindingContext = Record<string, unknown>;

export type KeybindingsSnapshot = {
  defaults: KeybindingRule[];
  user: KeybindingRule[];
  effective: NormalizedKeybinding[];
  conflicts: KeybindingConflict[];
};
