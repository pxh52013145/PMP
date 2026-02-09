import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { DefaultQualityService } from '../QualityService';

const readJsonMock = vi.fn((_key: string, fallback: unknown) => fallback);
const readStringMock = vi.fn<[string], string | null>((_key: string) => null);

vi.mock('../../../modules/storage', () => ({
  readJson: (key: string, fallback: unknown) => readJsonMock(key, fallback),
  readString: (key: string) => readStringMock(key),
}));

vi.mock('../../../utils/windowCommunication', () => ({
  STORAGE_KEYS: {
    UI_QUALITY_SETTINGS_V1: 'pixel-matrix-ui-quality-settings-v1',
    PERFORMANCE_RUNTIME_PROFILE: 'pixel-matrix-performance-runtime-profile',
  },
}));

describe('DefaultQualityService', () => {
  beforeEach(() => {
    readJsonMock.mockReset();
    readJsonMock.mockImplementation((_key: string, fallback: unknown) => fallback);
    readStringMock.mockReset();
    readStringMock.mockImplementation((key: string) =>
      key === 'pixel-matrix-ui-quality-settings-v1' ? 'persisted' : null
    );
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

  it('uses runtime profile fallback when quality key is absent', () => {
    readJsonMock.mockImplementation((key: string, fallback: unknown) => {
      if (key === 'pixel-matrix-performance-runtime-profile') return 'minimal';
      return fallback;
    });
    readStringMock.mockImplementation((_key: string) => null);

    const bus = new EventBus<AppEvents>();
    const service = new DefaultQualityService(bus.withSource('test'));

    const snapshot = service.getSnapshot();
    expect(snapshot.settings.mode).toBe('fixed');
    expect(snapshot.settings.fixedLevel).toBe('potato');
    expect(snapshot.effective.level).toBe('potato');
  });
});
