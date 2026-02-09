import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernel, ModuleLoader } from '../../../kernel';
import type { AppEvents } from '../../../contracts/events';
import { createMemoryGovernanceModule } from '../memoryGovernanceModule';
import { createLifecycleModule, APP_LIFECYCLE_SERVICE_TOKEN } from '../../lifecycle';
import { createNavigationModule, NAVIGATION_SERVICE_TOKEN } from '../../navigation';
import { STORAGE_KEYS } from '../../../utils/windowCommunication';
import { MEMORY_GOVERNANCE_SERVICE_TOKEN } from '../MemoryGovernanceService';

const readJsonMock = vi.fn((_key: string, fallback: unknown) => fallback);

vi.mock('../../../modules/storage', () => ({
  readJson: (key: string, fallback: unknown) => readJsonMock(key, fallback),
  flushStorageWrites: vi.fn(async () => {}),
}));

describe('createMemoryGovernanceModule', () => {
  beforeEach(() => {
    readJsonMock.mockReset();
    readJsonMock.mockImplementation((_key: string, fallback: unknown) => fallback);
  });

  it('uses runtime profile fallback when governance key is absent', () => {
    readJsonMock.mockImplementation((key: string, fallback: unknown) => {
      if (key === STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE) return 'minimal';
      return fallback;
    });

    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockReturnValue(1 as unknown as ReturnType<typeof window.setInterval>);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => {});

    const kernel = createKernel<AppEvents>();
    const loader = new ModuleLoader<AppEvents>(kernel.services, kernel.events, kernel.contributions);

    loader.activate([createLifecycleModule(), createNavigationModule(), createMemoryGovernanceModule()]);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(kernel.services.get(NAVIGATION_SERVICE_TOKEN)).toBeTruthy();
    expect(kernel.services.get(APP_LIFECYCLE_SERVICE_TOKEN)).toBeTruthy();
    expect(kernel.services.get(MEMORY_GOVERNANCE_SERVICE_TOKEN)).toBeTruthy();

    loader.deactivateAll();
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});
