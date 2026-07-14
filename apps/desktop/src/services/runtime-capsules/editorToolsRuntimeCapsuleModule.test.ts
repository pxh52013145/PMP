import { describe, expect, it, vi } from 'vitest';

import type { EditorToolsRuntimeActivity } from './editorToolsRuntimeCapsuleModule';
import { DefaultEditorToolsRuntimeCapsuleService } from './editorToolsRuntimeCapsuleModule';
import { DefaultRuntimeCapsuleManagerService } from './RuntimeCapsuleManagerService';

vi.mock('../../utils/tauriRuntime', () => ({
  isTauriRuntime: () => false,
}));

vi.mock('../telemetry/TelemetryService', () => ({
  getTelemetryLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function createActivity(
  override: Partial<EditorToolsRuntimeActivity> = {}
): EditorToolsRuntimeActivity {
  return {
    isEditing: false,
    editorMode: 'view',
    selectedMagnetId: null,
    selectedPixelCount: 0,
    isEditorAuxWindowFocused: false,
    isMainWindowFocused: true,
    isMainWindowVisible: true,
    isDocumentVisible: true,
    isMainWindowMinimized: false,
    isPageFrozen: false,
    isWindowActive: true,
    shouldPollEditorAuxFocus: false,
    ...override,
  };
}

describe('DefaultEditorToolsRuntimeCapsuleService', () => {
  it('releases the Editor lease and rejects stale auxiliary focus after teardown', () => {
    const manager = new DefaultRuntimeCapsuleManagerService(() => 1_000);
    manager.registerCapsule({
      id: 'editor.tools',
      kind: 'editor',
      memoryTier: 'heavy',
      startup: 'manual',
      backgroundPolicy: 'while-active',
      warmRetentionMs: 10_000,
      hibernateAfterMs: 60_000,
      provides: ['editor.tools'],
    });
    const service = new DefaultEditorToolsRuntimeCapsuleService(manager);

    service.updateActivity(createActivity({ isEditing: true, editorMode: 'edit' }));
    expect(manager.collectSnapshot().activeLeaseCount).toBe(1);

    service.teardown('test edit exit');
    expect(manager.collectSnapshot().activeLeaseCount).toBe(0);

    service.updateActivity(createActivity({ isEditorAuxWindowFocused: true }));
    expect(manager.collectSnapshot().activeLeaseCount).toBe(0);

    service.updateActivity(createActivity({ isEditing: true, editorMode: 'edit' }));
    expect(manager.collectSnapshot().activeLeaseCount).toBe(1);
  });
});
