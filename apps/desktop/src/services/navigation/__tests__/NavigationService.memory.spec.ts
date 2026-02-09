import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { InMemoryNavigationService } from '../NavigationService';
import type { NavigationPageType } from '../../../contracts/navigation';

describe('InMemoryNavigationService memory guard', () => {
  it('sanitizes legacy track payload to lightweight trackId params', () => {
    const events = new EventBus<AppEvents>();
    const service = new InMemoryNavigationService(events.withSource('test'));

    const hugePayload = {
      type: 'track',
      params: {
        track: {
          id: 'track-001',
          title: 'very large payload entry',
          lyrics: 'x'.repeat(10_000),
          artwork: 'y'.repeat(10_000),
        },
      },
    };

    service.navigateTo(hugePayload.type as NavigationPageType, hugePayload.params as Record<string, unknown>);
    const snapshot = service.getSnapshot();

    expect(snapshot.currentPage.type).toBe('track');
    expect(snapshot.currentPage.params).toEqual({ trackId: 'track-001' });
  });
});
