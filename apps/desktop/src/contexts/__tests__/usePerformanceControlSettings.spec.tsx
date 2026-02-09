import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { AppEvents } from '../../contracts/events';
import {
  DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
  type PerformanceControlSnapshot,
} from '../../contracts/performanceControl';
import { usePerformanceControlSettings } from '../usePerformanceControlSettings';

const getServiceMock = vi.fn();
const onEventMock = vi.fn();
const kernelMock = {
  services: {
    get: (...args: unknown[]) => getServiceMock(...args),
  },
  events: {
    on: (...args: unknown[]) => onEventMock(...args),
  },
};

vi.mock('../KernelContext', () => ({
  useKernel: () => kernelMock,
}));

function HookProbe(props: {
  onRender: (value: ReturnType<typeof usePerformanceControlSettings>) => void;
}) {
  const value = usePerformanceControlSettings();
  props.onRender(value);
  return null;
}

describe('usePerformanceControlSettings', () => {
  afterEach(() => {
    getServiceMock.mockReset();
    onEventMock.mockReset();
  });

  it('tracks settings through performance-control/changed event', async () => {
    let listener: ((snapshot: AppEvents['performance-control/changed']) => void) | null = null;

    const baseSnapshot: PerformanceControlSnapshot = {
      ...DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT,
      updatedAtMs: 10,
      settings: {
        ...DEFAULT_PERFORMANCE_CONTROL_SNAPSHOT.settings,
        backgroundRenderPolicy: 'pause',
      },
    };

    const service = {
      getSnapshot: vi.fn(() => baseSnapshot),
      getSettingsSnapshot: vi.fn(() => baseSnapshot.settings),
      refreshSettingsFromStorage: vi.fn(() => baseSnapshot.settings),
      refreshNow: vi.fn(async () => baseSnapshot),
      syncEditorEffectsFromSettings: vi.fn(async () => {}),
      setRuntimeProfile: vi.fn(async () => {}),
      setEditorLowPerformanceMode: vi.fn(async () => {}),
      setGifImportMaxFps: vi.fn(async () => {}),
      setCoverMaxEdgePx: vi.fn(async () => {}),
      setBackgroundRenderPolicy: vi.fn(async () => {}),
      setMemoryGovernanceAutoEnabled: vi.fn(async () => {}),
      setUiQualitySettings: vi.fn(async () => {}),
      updateUiQualitySettings: vi.fn(async () => {}),
    };

    getServiceMock.mockReturnValue(service);
    onEventMock.mockImplementation(
      (eventName: string, cb: (payload: AppEvents['performance-control/changed']) => void) => {
        if (eventName === 'performance-control/changed') {
          listener = cb;
        }
        return () => {
          listener = null;
        };
      }
    );

    const renders: Array<ReturnType<typeof usePerformanceControlSettings>> = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<HookProbe onRender={(value) => renders.push(value)} />);
    });

    expect(renders.at(-1)?.settings.backgroundRenderPolicy).toBe('pause');
    expect(renders.at(-1)?.snapshot.updatedAtMs).toBe(10);

    const nextSnapshot: PerformanceControlSnapshot = {
      ...baseSnapshot,
      updatedAtMs: 11,
      settings: {
        ...baseSnapshot.settings,
        backgroundRenderPolicy: 'throttle',
      },
    };

    await act(async () => {
      listener?.(nextSnapshot);
    });

    expect(renders.at(-1)?.settings.backgroundRenderPolicy).toBe('throttle');
    expect(renders.at(-1)?.snapshot.updatedAtMs).toBe(11);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
