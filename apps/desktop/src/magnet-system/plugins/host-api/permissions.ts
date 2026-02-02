export const PLUGIN_PERMISSIONS = {
  host: 'api:host',

  audioState: 'api:audio-state',
  audioControl: 'api:audio-control',
  audioVisual: 'api:audio-visual',
  audioCover: 'api:audio-cover',

  navigation: 'api:navigation',
  window: 'api:window',

  configLocal: 'storage:local',

  netAll: 'net:all',
  netWildcard: 'net:*',
} as const;

export function hasPermission(permissions: Set<string>, capability: string): boolean {
  if (permissions.has(capability)) return true;
  if (capability.startsWith('net:') && (permissions.has(PLUGIN_PERMISSIONS.netWildcard) || permissions.has(PLUGIN_PERMISSIONS.netAll))) {
    return true;
  }
  return false;
}

