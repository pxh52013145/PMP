import { describe, expect, it, vi } from 'vitest';
import { createKernel, ModuleLoader } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { createNavigationModule } from '../navigationModule';
import { NAVIGATION_SERVICE_TOKEN } from '../NavigationService';

describe('navigationModule', () => {
  it('registers NavigationService and emits navigation/changed', () => {
    const kernel = createKernel<AppEvents>();
    const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);
    loader.activate([createNavigationModule()]);

    const service = kernel.services.get(NAVIGATION_SERVICE_TOKEN);
    const listener = vi.fn();
    const unsubscribe = kernel.events.on('navigation/changed', listener);

    service.navigateTo('music-library');

    expect(listener).toHaveBeenCalled();
    const [payload, meta] = listener.mock.calls[0] ?? [];
    expect(payload.currentPage.type).toBe('music-library');
    expect(meta.source).toBe('navigation');

    unsubscribe();
    loader.deactivateAll();
  });
});
