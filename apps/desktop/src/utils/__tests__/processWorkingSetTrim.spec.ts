import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn().mockResolvedValue({
    timestampMs: Date.now(),
    rootPid: 1,
    target: 'tree',
    attemptedPids: [1],
    trimmedPids: [1],
    failedPids: [],
  }),
}));

import { invoke } from '@tauri-apps/api/tauri';
import {
  cancelScheduledProcessWorkingSetTrim,
  scheduleProcessWorkingSetTrim,
} from '../processWorkingSetTrim';

function enableMockTauriRuntime(): () => void {
  const runtimeWindow = window as Window & { __TAURI__?: unknown };
  const previousValue = runtimeWindow.__TAURI__;
  runtimeWindow.__TAURI__ = previousValue ?? {};
  return () => {
    runtimeWindow.__TAURI__ = previousValue;
  };
}

describe('processWorkingSetTrim', () => {
  let restoreRuntime: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    restoreRuntime = enableMockTauriRuntime();
  });

  afterEach(() => {
    cancelScheduledProcessWorkingSetTrim();
    restoreRuntime?.();
    restoreRuntime = null;
    vi.useRealTimers();
  });

  it('coalesces repeated schedules for the same target', async () => {
    scheduleProcessWorkingSetTrim('tree', { delaysMs: [120, 400] });
    scheduleProcessWorkingSetTrim('tree', { delaysMs: [240] });

    await vi.advanceTimersByTimeAsync(239);
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('debug_trim_process_working_set', {
      target: 'tree',
    });
  });

  it('cancels pending trims when requested', async () => {
    scheduleProcessWorkingSetTrim('webview2', { delaysMs: [100] });
    cancelScheduledProcessWorkingSetTrim('webview2');

    await vi.advanceTimersByTimeAsync(100);
    expect(invoke).not.toHaveBeenCalled();
  });
});
