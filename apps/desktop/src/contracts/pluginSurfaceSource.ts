export type PluginSurfaceSourceKind = 'pmpm' | 'extv2';

export function isPluginSurfaceSourceKind(value: unknown): value is PluginSurfaceSourceKind {
  return value === 'pmpm' || value === 'extv2';
}
