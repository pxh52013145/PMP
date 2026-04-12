import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import {
  InstalledExtensionDesktopWidgetHost,
  InstalledExtensionOverlayHost,
  InstalledExtensionPageHost,
  InstalledExtensionVisualizerHost,
  InstalledExtensionWindowHost,
} from './InstalledExtensionSurfaceHost';

type LegacyResolvedHostProps = {
  preferredKind?: PluginSurfaceSourceKind;
};

export function ResolvedPluginPageHost({
  pluginId,
  pageId,
}: {
  pluginId: string;
  pageId: string;
} & LegacyResolvedHostProps) {
  return <InstalledExtensionPageHost pluginId={pluginId} pageId={pageId} />;
}

export function ResolvedPluginVisualizerHost({
  pluginId,
  visualizerId,
}: {
  pluginId: string;
  visualizerId: string;
} & LegacyResolvedHostProps) {
  return (
    <InstalledExtensionVisualizerHost
      pluginId={pluginId}
      visualizerId={visualizerId}
    />
  );
}

export function ResolvedPluginWindowHost({
  pluginId,
  windowId,
}: {
  pluginId: string;
  windowId: string;
} & LegacyResolvedHostProps) {
  return <InstalledExtensionWindowHost pluginId={pluginId} windowId={windowId} />;
}

export function ResolvedPluginShellSurfaceHost({
  pluginId,
  surfaceId,
  surfaceType,
}: {
  pluginId: string;
  surfaceId: string;
  surfaceType: 'overlay' | 'desktop-widget';
} & LegacyResolvedHostProps) {
  return surfaceType === 'overlay' ? (
    <InstalledExtensionOverlayHost pluginId={pluginId} surfaceId={surfaceId} />
  ) : (
    <InstalledExtensionDesktopWidgetHost
      pluginId={pluginId}
      surfaceId={surfaceId}
    />
  );
}
