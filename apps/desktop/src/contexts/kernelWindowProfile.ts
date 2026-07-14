export type KernelWindowProfile = {
  isEditorWindow: boolean;
  isRegistrationWindow: boolean;
  isAuxWindow: boolean;
  canUsePluginModules: boolean;
  needsRuntimeCapsuleManager: boolean;
  needsEditorRuntimeServices: boolean;
  needsBuiltinMagnetRenderers: boolean;
};

export function resolveKernelWindowProfile(hash: string): KernelWindowProfile {
  const isEditorWindow = hash.startsWith('#/editor/');
  const editorWindowType = isEditorWindow
    ? hash.slice('#/editor/'.length).split(/[/?#]/, 1)[0]
    : '';
  const isRegistrationWindow =
    editorWindowType === 'registration' || editorWindowType === 'theme';
  const isPluginWindow = hash.startsWith('#/plugin-window/');
  const isPluginShellSurfaceWindow = hash.startsWith('#/plugin-shell-surface/');
  const isVstManagerWindow = hash.startsWith('#/vst-manager');
  const isAuxWindow =
    isEditorWindow || isPluginWindow || isPluginShellSurfaceWindow || isVstManagerWindow;
  const canUsePluginModules = !isEditorWindow || isRegistrationWindow;
  const needsBuiltinMagnetRenderers =
    !isEditorWindow ||
    editorWindowType === 'library' ||
    editorWindowType === 'creator' ||
    editorWindowType === 'debug' ||
    isRegistrationWindow;

  return {
    isEditorWindow,
    isRegistrationWindow,
    isAuxWindow,
    canUsePluginModules,
    needsRuntimeCapsuleManager: !isEditorWindow || isRegistrationWindow,
    needsEditorRuntimeServices: !isEditorWindow,
    needsBuiltinMagnetRenderers,
  };
}
