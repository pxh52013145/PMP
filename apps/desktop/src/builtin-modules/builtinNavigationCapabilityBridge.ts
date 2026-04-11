import type { NavigationPageType } from '../contracts/navigation';
import {
  invokePluginHostCapability,
  type HostNavigation,
  type PluginHostCapabilityResult,
} from '../magnet-system/plugins/pluginHostApi';
import type { NavigationService } from '../services/navigation';

const HOST_PMP_NAVIGATION_CAPABILITY_ID = 'host.pmp.navigation';
const BUILTIN_NAVIGATION_PLUGIN_ID = 'builtin-navigation';
const BUILTIN_NAVIGATION_PERMISSIONS = new Set<string>([
  'api:host',
  'api:host-capability',
  'api:navigation',
]);

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

  return new Error(`host.pmp.navigation ${method} failed`);
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

export async function navigateBuiltinViaHostCapability(
  navigation: NavigationService,
  page: NavigationPageType,
  params: Record<string, unknown> | undefined,
  commandId: string
): Promise<void> {
  await invokeBuiltinNavigationCapability(
    navigation,
    'navigateTo',
    {
      page,
      params,
    },
    commandId
  );
}

export async function goBackBuiltinViaHostCapability(
  navigation: NavigationService,
  commandId: string
): Promise<void> {
  await invokeBuiltinNavigationCapability(navigation, 'goBack', undefined, commandId);
}
