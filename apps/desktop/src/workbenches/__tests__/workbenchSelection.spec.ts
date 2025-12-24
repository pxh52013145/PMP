import { describe, expect, it } from 'vitest';
import type { WorkbenchContribution } from '../../contracts/contributions';
import { resolveActiveWorkbenchId } from '../workbenchSelection';

function wb(id: string, title: string, order?: number): WorkbenchContribution {
  return { kind: 'workbench', id, title, render: () => null, order };
}

describe('workbenchSelection', () => {
  it('returns preferred workbench when registered', () => {
    const workbenches = [wb('default', 'Default'), wb('minimal', 'Minimal')];
    expect(resolveActiveWorkbenchId(workbenches, 'minimal')).toBe('minimal');
  });

  it('falls back to lowest order workbench when preferred missing', () => {
    const workbenches = [wb('default', 'Default', 20), wb('minimal', 'Minimal', 10)];
    expect(resolveActiveWorkbenchId(workbenches, 'missing')).toBe('minimal');
  });

  it('returns null when no workbenches registered', () => {
    expect(resolveActiveWorkbenchId([], 'default')).toBeNull();
  });
});

