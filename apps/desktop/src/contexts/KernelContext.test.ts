import { describe, expect, it } from 'vitest';
import { resolveKernelWindowProfile } from './kernelWindowProfile';

describe('resolveKernelWindowProfile', () => {
  it('keeps lightweight editor windows on the minimal kernel profile', () => {
    for (const type of ['control', 'statistics', 'style', 'background']) {
      expect(resolveKernelWindowProfile(`#/editor/${type}`)).toMatchObject({
        isEditorWindow: true,
        canUsePluginModules: false,
        needsRuntimeCapsuleManager: false,
        needsEditorRuntimeServices: false,
        needsBuiltinMagnetRenderers: false,
      });
    }
  });

  it('loads renderers without process governance for the Magnet creator', () => {
    expect(resolveKernelWindowProfile('#/editor/creator')).toMatchObject({
      isEditorWindow: true,
      canUsePluginModules: false,
      needsRuntimeCapsuleManager: false,
      needsEditorRuntimeServices: false,
      needsBuiltinMagnetRenderers: true,
    });
  });

  it('reserves plugin runtime infrastructure for the registration editor', () => {
    expect(resolveKernelWindowProfile('#/editor/registration')).toMatchObject({
      isEditorWindow: true,
      isRegistrationWindow: true,
      canUsePluginModules: true,
      needsRuntimeCapsuleManager: true,
      needsEditorRuntimeServices: false,
      needsBuiltinMagnetRenderers: true,
    });
  });

  it('preserves the full runtime profile for the main window', () => {
    expect(resolveKernelWindowProfile('#/library')).toMatchObject({
      isEditorWindow: false,
      isAuxWindow: false,
      needsRuntimeCapsuleManager: true,
      needsEditorRuntimeServices: true,
      needsBuiltinMagnetRenderers: true,
    });
  });
});
