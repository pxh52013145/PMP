import { describe, expect, it, vi } from 'vitest';
import { ContributionRegistry } from '../ContributionRegistry';

type TestContribution = { kind: 'page'; id: string; title: string };

describe('ContributionRegistry', () => {
  it('registers and lists contributions by kind', () => {
    const registry = new ContributionRegistry();

    registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    registry.register<TestContribution>({ kind: 'page', id: 'settings', title: 'Settings' });

    const pages = registry.list<TestContribution>('page');
    expect(pages.map((c) => c.id).sort()).toEqual(['home', 'settings']);
  });

  it('supports get(kind, id)', () => {
    const registry = new ContributionRegistry();
    registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    expect(registry.get<TestContribution>('page', 'home')?.title).toBe('Home');
    expect(registry.get<TestContribution>('page', 'missing')).toBeNull();
  });

  it('returns an unregister function', () => {
    const registry = new ContributionRegistry();
    const unregister = registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    expect(registry.list<TestContribution>('page')).toHaveLength(1);
    unregister();
    expect(registry.list<TestContribution>('page')).toHaveLength(0);
  });

  it('throws on duplicate registration without replace', () => {
    const registry = new ContributionRegistry();
    registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    expect(() => registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home 2' })).toThrow(
      /already registered/i
    );
  });

  it('supports replace option', () => {
    const registry = new ContributionRegistry();
    registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home 2' }, { replace: true });
    expect(registry.get<TestContribution>('page', 'home')?.title).toBe('Home 2');
  });

  it('notifies subscribers on changes', () => {
    const registry = new ContributionRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    const unregister = registry.register<TestContribution>({ kind: 'page', id: 'home', title: 'Home' });
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registry.register<TestContribution>({ kind: 'page', id: 'settings', title: 'Settings' });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

