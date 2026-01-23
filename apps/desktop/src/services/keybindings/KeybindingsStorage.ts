import { readJson, writeJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import type { KeybindingRule } from './types';

type PersistedRule = {
  key: unknown;
  command: unknown;
  when?: unknown;
  args?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRule(raw: unknown): Omit<KeybindingRule, 'source'> | null {
  if (!isRecord(raw)) return null;
  const key = raw.key;
  const command = raw.command;
  if (typeof key !== 'string' || key.trim().length === 0) return null;
  if (typeof command !== 'string') return null;

  const when = raw.when;
  const args = raw.args;
  return {
    key: key.trim(),
    command,
    when: typeof when === 'string' ? when : undefined,
    args,
  };
}

export function loadUserKeybindings(): KeybindingRule[] {
  const raw = readJson<unknown>(STORAGE_KEYS.KEYBINDINGS_USER_V1, []);
  if (!Array.isArray(raw)) return [];

  const result: KeybindingRule[] = [];
  for (const item of raw as PersistedRule[]) {
    const parsed = parseRule(item);
    if (!parsed) continue;
    result.push({ ...parsed, source: 'user' });
  }
  return result;
}

export function saveUserKeybindings(rules: KeybindingRule[]): void {
  const persisted = rules
    .filter((r) => r.source === 'user')
    .map((r) => ({
      key: r.key,
      command: r.command,
      ...(r.when ? { when: r.when } : {}),
      ...(typeof r.args !== 'undefined' ? { args: r.args } : {}),
    }));
  writeJson(STORAGE_KEYS.KEYBINDINGS_USER_V1, persisted);
}
