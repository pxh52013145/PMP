import { describe, expect, it, vi } from 'vitest';
import type { MemoryGovernanceRequest } from '../../contracts/memoryGovernance';
import type { AppEvents } from '../../contracts/events';
import { EventBus } from '../../kernel';
import { InMemoryNavigationService } from './NavigationService';

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createService() {
  const events = new EventBus<AppEvents>();
  const memoryRequests: MemoryGovernanceRequest[] = [];
  events.on('memory-governance/requested', (request) => {
    memoryRequests.push(request);
  });
  return {
    service: new InMemoryNavigationService(events),
    memoryRequests,
  };
}

describe('InMemoryNavigationService', () => {
  it('requests memory governance after page navigation', () => {
    const { service, memoryRequests } = createService();

    service.navigateTo('settings');

    expect(memoryRequests).toEqual([
      {
        reason: 'runtime-release',
        source: 'navigation:navigate:home->settings',
        delaysMs: [1_200, 6_000],
        minIntervalMs: 2_500,
      },
    ]);
  });

  it('requests memory governance when replacing page params', () => {
    const { service, memoryRequests } = createService();

    service.navigateTo('debug', { tab: 'perf-monitor' });
    service.navigateTo('debug', { tab: 'native-debug' });

    expect(memoryRequests.at(-1)).toEqual({
      reason: 'runtime-release',
      source: 'navigation:replace-current:debug->debug',
      delaysMs: [1_200, 6_000],
      minIntervalMs: 2_500,
    });
  });

  it('requests memory governance when navigating back', () => {
    const { service, memoryRequests } = createService();

    service.navigateTo('settings');
    service.goBack();

    expect(memoryRequests.at(-1)).toEqual({
      reason: 'runtime-release',
      source: 'navigation:back:settings->home',
      delaysMs: [1_200, 6_000],
      minIntervalMs: 2_500,
    });
  });

  it('does not request governance for an identical navigation target', () => {
    const { service, memoryRequests } = createService();

    service.navigateTo('settings');
    service.navigateTo('settings');

    expect(memoryRequests).toHaveLength(1);
  });
});
