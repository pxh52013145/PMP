import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { DefaultQualityService } from '../QualityService';

vi.mock('../../../modules/storage', () => ({
  readJson: vi.fn((_key: string, fallback: unknown) => fallback),
}));

describe('DefaultQualityService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('immediately downgrades one level on high memory tier in auto mode', () => {
    const bus = new EventBus<AppEvents>();
    const service = new DefaultQualityService(bus.withSource('test'));

    const before = service.getSnapshot().effective.level;
    service.setLastMemoryTier(2);
    const after = service.getSnapshot().effective.level;

    expect(before).toBe('high');
    expect(after).toBe('balanced');
    expect(service.getSnapshot().lastDecision?.reason.kind).toBe('auto-downgrade');
  });

  it('does not downgrade below minimum quality bound', () => {
    const bus = new EventBus<AppEvents>();
    const service = new DefaultQualityService(bus.withSource('test'));

    // Downgrade step-by-step until potato, then keep at potato.
    service.setLastMemoryTier(2);
    service.setLastMemoryTier(2);
    service.setLastMemoryTier(2);

    expect(service.getSnapshot().effective.level).toBe('potato');
  });
});
