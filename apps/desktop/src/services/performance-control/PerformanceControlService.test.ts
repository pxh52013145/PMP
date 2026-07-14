import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { readPerformanceControlSettingsFromStorage } from './PerformanceControlService';

describe('readPerformanceControlSettingsFromStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('preserves the persisted balanced Editor appearance without a live service', () => {
    window.localStorage.setItem(
      STORAGE_KEYS.PERFORMANCE_RUNTIME_PROFILE,
      JSON.stringify('balanced')
    );
    window.localStorage.setItem(
      STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
      JSON.stringify(false)
    );
    window.localStorage.setItem(
      STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
      JSON.stringify('throttle')
    );

    const settings = readPerformanceControlSettingsFromStorage();

    expect(settings.runtimeProfile).toBe('balanced');
    expect(settings.editorLowPerformanceMode).toBe(false);
    expect(settings.backgroundRenderPolicy).toBe('throttle');
  });
});
