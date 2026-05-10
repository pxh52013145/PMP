import type { NavigationPageType } from '../contracts/navigation';
import type {
  PluginPageParams,
  PluginVisualizerParams,
} from '../contracts/navigationParams';
import {
  invokePluginHostCapability,
  type HostNavigation,
  type PluginHostCapabilityResult,
} from '../magnet-system/plugins/pluginHostApi';
import {
  calculateWindowPosition,
  openEditorWindow,
  closeEditorWindow,
  type EditorWindowType,
} from '../utils/editorWindows';
import { openPluginWindow } from '../utils/pluginWindows';
import { closeVstManagerWindow, openVstManagerWindow } from '../utils/vstManagerWindows';
import type { NavigationService } from '../services/navigation';

const HOST_PMP_NAVIGATION_CAPABILITY_ID = 'host.pmp.navigation';
const HOST_PMP_WINDOW_CAPABILITY_ID = 'host.pmp.shell.window';
const BUILTIN_NAVIGATION_PLUGIN_ID = 'builtin-navigation';
const BUILTIN_NAVIGATION_PERMISSIONS = new Set<string>([
  'api:host',
  'api:host-capability',
  'api:navigation',
]);
const BUILTIN_WINDOW_PERMISSIONS = new Set<string>([
  'api:host',
  'api:host-capability',
  'api:window',
]);

const BUILTIN_EDITOR_WINDOW_CAPABILITY_IDS: Record<EditorWindowType, string> = {
  control: 'editor-control',
  statistics: 'editor-statistics',
  library: 'editor-library',
  style: 'editor-style',
  'style-pixel': 'editor-style-pixel',
  'style-cover-color': 'editor-style-cover-color',
  'style-background-effect': 'editor-style-background-effect',
  'style-border-effect': 'editor-style-border-effect',
  background: 'editor-background',
  'custom-background': 'editor-custom-background',
  theme: 'editor-theme',
  debug: 'editor-debug',
};

const BUILTIN_EDITOR_WINDOW_TYPES_BY_CAPABILITY_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(BUILTIN_EDITOR_WINDOW_CAPABILITY_IDS).map(([type, capabilityId]) => [
      capabilityId,
      type as EditorWindowType,
    ])
  ) as Record<string, EditorWindowType>
);

function createHostNavigationBridge(navigation: NavigationService): HostNavigation {
  return {
    navigateTo: (page, params) => {
      navigation.navigateTo(page, params);
    },
    goBack: () => {
      navigation.goBack();
    },
    getSnapshot: () => navigation.getSnapshot(),
  };
}

function toCapabilityError(result: PluginHostCapabilityResult | unknown, method: string): Error {
  if (
    result &&
    typeof result === 'object' &&
    'ok' in result &&
    result.ok === false &&
    'error' in result &&
    result.error &&
    typeof result.error === 'object' &&
    'message' in result.error &&
    typeof result.error.message === 'string'
  ) {
    return new Error(result.error.message);
  }

  return new Error(`host capability ${method} failed`);
}

function encodeBuiltinWindowCapabilityId(windowId: string): string {
  if (windowId.startsWith('editor:')) {
    const editorType = windowId.slice('editor:'.length) as EditorWindowType;
    return BUILTIN_EDITOR_WINDOW_CAPABILITY_IDS[editorType] ?? windowId.replace(/:/g, '-');
  }
  return windowId;
}

function createBuiltinWindowBridge(
  navigation: NavigationService,
  hostLabel: string
) {
  return {
    open: async (
      windowId: string,
      options?: {
        title?: string;
        width?: number;
        height?: number;
        x?: number;
        y?: number;
        pluginId?: string;
        sourceKind?: 'extv2';
      }
    ) => {
      if (windowId === 'keyboard-shortcuts') {
        await invokeBuiltinNavigationCapability(
          navigation,
          'navigateTo',
          {
            page: 'keyboard-shortcuts',
          },
          `${hostLabel}:keyboard-shortcuts`
        );
        return;
      }

      if (windowId === 'vst-manager') {
        await openVstManagerWindow({
          title: options?.title,
          width: options?.width,
          height: options?.height,
          x: options?.x,
          y: options?.y,
        });
        return;
      }

      const editorType = BUILTIN_EDITOR_WINDOW_TYPES_BY_CAPABILITY_ID[windowId];
      if (editorType) {
        const position =
          typeof options?.x === 'number' &&
          typeof options?.y === 'number' &&
          typeof options?.width === 'number' &&
          typeof options?.height === 'number'
            ? {
                x: options.x,
                y: options.y,
                width: options.width,
                height: options.height,
              }
            : await calculateWindowPosition(editorType);
        await openEditorWindow({
          type: editorType,
          ...position,
        });
        return;
      }

      await openPluginWindow({
        sourceKind: options?.sourceKind ?? 'extv2',
        pluginId: options?.pluginId ?? '',
        windowId,
        title: options?.title,
        width: options?.width,
        height: options?.height,
        x: options?.x,
        y: options?.y,
      });
    },
    close: async (windowId: string) => {
      if (windowId === 'vst-manager') {
        await closeVstManagerWindow();
        return;
      }

      const editorType = BUILTIN_EDITOR_WINDOW_TYPES_BY_CAPABILITY_ID[windowId];
      if (editorType) {
        await closeEditorWindow(editorType);
        return;
      }
    },
  };
}

async function invokeBuiltinNavigationCapability(
  navigation: NavigationService,
  method: 'navigateTo' | 'goBack',
  payload: Record<string, unknown> | undefined,
  hostLabel: string
): Promise<void> {
  const result = (await invokePluginHostCapability(HOST_PMP_NAVIGATION_CAPABILITY_ID, {
    method,
    payload,
    context: {
      pluginId: BUILTIN_NAVIGATION_PLUGIN_ID,
      hostLabel,
      permissions: BUILTIN_NAVIGATION_PERMISSIONS,
      navigation: createHostNavigationBridge(navigation),
    },
  })) as PluginHostCapabilityResult;

  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
    throw toCapabilityError(result, method);
  }
}

async function invokeBuiltinWindowCapability(
  navigation: NavigationService,
  method: 'open',
  payload: {
    windowId: string;
    options?: Record<string, unknown>;
  },
  hostLabel: string
): Promise<void> {
  const result = (await invokePluginHostCapability(HOST_PMP_WINDOW_CAPABILITY_ID, {
    method,
    payload,
    context: {
      pluginId: BUILTIN_NAVIGATION_PLUGIN_ID,
      hostLabel,
      permissions: BUILTIN_WINDOW_PERMISSIONS,
      windowApi: createBuiltinWindowBridge(navigation, hostLabel),
    },
  })) as PluginHostCapabilityResult;

  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
    throw toCapabilityError(result, method);
  }
}

export async function navigateBuiltinViaHostCapability(
  navigation: NavigationService,
  page: NavigationPageType,
  params: Record<string, unknown> | undefined,
  hostLabel: string
): Promise<void> {
  await invokeBuiltinNavigationCapability(
    navigation,
    'navigateTo',
    {
      page,
      params,
    },
    hostLabel
  );
}

export async function goBackBuiltinViaHostCapability(
  navigation: NavigationService,
  hostLabel: string
): Promise<void> {
  await invokeBuiltinNavigationCapability(navigation, 'goBack', undefined, hostLabel);
}

export async function openBuiltinPluginPageViaHostCapability(
  navigation: NavigationService,
  params: PluginPageParams,
  hostLabel: string
): Promise<void> {
  await navigateBuiltinViaHostCapability(navigation, 'plugin-page', params, hostLabel);
}

export async function openBuiltinPluginVisualizerViaHostCapability(
  navigation: NavigationService,
  params: PluginVisualizerParams,
  hostLabel: string
): Promise<void> {
  await navigateBuiltinViaHostCapability(navigation, 'plugin-visualizer', params, hostLabel);
}

export async function openBuiltinPluginWindowViaHostCapability(
  navigation: NavigationService,
  params: {
    sourceKind: 'extv2';
    pluginId: string;
    windowId: string;
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  },
  hostLabel: string
): Promise<void> {
  await invokeBuiltinWindowCapability(
    navigation,
    'open',
    {
      windowId: params.windowId,
      options: {
        sourceKind: params.sourceKind,
        pluginId: params.pluginId,
        title: params.title,
        width: params.width,
        height: params.height,
        x: params.x,
        y: params.y,
      },
    },
    hostLabel
  );
}

export async function openBuiltinWindowViaHostCapability(
  navigation: NavigationService,
  params: {
    windowId:
      | 'keyboard-shortcuts'
      | 'vst-manager'
      | `editor:${EditorWindowType}`;
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  },
  hostLabel: string
): Promise<void> {
  await invokeBuiltinWindowCapability(
    navigation,
    'open',
    {
      windowId: encodeBuiltinWindowCapabilityId(params.windowId),
      options: {
        title: params.title,
        width: params.width,
        height: params.height,
        x: params.x,
        y: params.y,
      },
    },
    hostLabel
  );
}
