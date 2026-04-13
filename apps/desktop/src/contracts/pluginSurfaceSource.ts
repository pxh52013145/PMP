export type PluginSurfaceSourceKind = 'extv2';

export function isPluginSurfaceSourceKind(value: unknown): value is PluginSurfaceSourceKind {
  return value === 'extv2';
}
