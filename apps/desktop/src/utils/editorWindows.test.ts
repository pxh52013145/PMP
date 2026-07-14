import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorWindowsCloseReport, EditorWindowsDebugState } from './editorWindows';
import { ensureEditorWindowsClosed } from './editorWindows';

const mocks = vi.hoisted(() => ({
  invokeWithTelemetry: vi.fn(),
  telemetry: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./tauriRuntime', () => ({
  isTauriRuntime: () => true,
}));

vi.mock('../services/telemetry/tauriInvokeTelemetry', () => ({
  invokeWithTelemetry: mocks.invokeWithTelemetry,
}));

vi.mock('../services/telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => mocks.telemetry,
}));

vi.mock('./windowPinRuntime', () => ({
  getEffectiveWindowPinPolicy: () => ({ editorWindowsPinned: false }),
}));

vi.mock('./editorWindowEffects', () => ({
  readEditorLowPerformanceMode: () => false,
}));

const creatorWindow = { windowType: 'creator', exists: true, visible: true };
const emptyState: EditorWindowsDebugState = { windows: [] };
const closeReport: EditorWindowsCloseReport = {
  requestedWindowTypes: ['creator'],
  closeRequestedWindowTypes: ['creator'],
  alreadyClosedWindowTypes: [],
  failures: [],
  remainingWindows: [creatorWindow],
};

describe('ensureEditorWindowsClosed', () => {
  beforeEach(() => {
    mocks.invokeWithTelemetry.mockReset();
  });

  it('retries through the native destroy delay and verifies that no Editor window remains', async () => {
    mocks.invokeWithTelemetry.mockImplementation((command: string) => {
      if (command === 'debug_get_editor_windows_state') {
        const verificationCount = mocks.invokeWithTelemetry.mock.calls.filter(
          ([candidate]) => candidate === 'debug_get_editor_windows_state'
        ).length;
        return Promise.resolve(
          verificationCount === 1 ? { windows: [creatorWindow] } : emptyState
        );
      }
      if (command === 'close_all_editor_windows') return Promise.resolve(closeReport);
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await ensureEditorWindowsClosed([0, 0]);

    expect(result).toMatchObject({
      verificationCount: 2,
      remainingWindows: [],
      closeReport,
    });
    expect(mocks.invokeWithTelemetry).toHaveBeenCalledWith(
      'close_all_editor_windows',
      undefined,
      expect.any(Object)
    );
  });

  it('reports a survivor after exhausting every verification attempt', async () => {
    mocks.invokeWithTelemetry.mockImplementation((command: string) => {
      if (command === 'debug_get_editor_windows_state') {
        return Promise.resolve({ windows: [creatorWindow] });
      }
      if (command === 'close_all_editor_windows') return Promise.resolve(closeReport);
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await ensureEditorWindowsClosed([0, 0, 0]);

    expect(result.verificationCount).toBe(3);
    expect(result.remainingWindows).toEqual([creatorWindow]);
    expect(mocks.invokeWithTelemetry).toHaveBeenCalledTimes(6);
  });
});
