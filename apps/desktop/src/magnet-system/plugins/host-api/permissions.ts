export const PLUGIN_PERMISSIONS = {
  host: 'api:host',
  hostCapabilityInvoke: 'api:host-capability',

  audioState: 'api:audio-state',
  audioControl: 'api:audio-control',
  audioVisual: 'api:audio-visual',
  audioCover: 'api:audio-cover',

  aiRuntime: 'api:ai-runtime',
  desktopPet: 'api:desktop-pet',
  voiceTraining: 'api:voice-training',

  navigation: 'api:navigation',
  window: 'api:window',

  configLocal: 'storage:local',

  netAll: 'net:all',
  netWildcard: 'net:*',
} as const;

function wildcardMatch(grantedCapability: string, requestedCapability: string): boolean {
  if (!grantedCapability.endsWith('*')) return false;
  const prefix = grantedCapability.slice(0, -1);
  return prefix.length > 0 && requestedCapability.startsWith(prefix);
}

export function hasPermission(permissions: Set<string>, capability: string): boolean {
  if (permissions.has(capability)) return true;
  if (
    capability.startsWith('net:') &&
    (permissions.has(PLUGIN_PERMISSIONS.netWildcard) || permissions.has(PLUGIN_PERMISSIONS.netAll))
  ) {
    return true;
  }

  for (const grantedCapability of permissions) {
    if (wildcardMatch(grantedCapability, capability)) {
      return true;
    }
  }

  return false;
}

