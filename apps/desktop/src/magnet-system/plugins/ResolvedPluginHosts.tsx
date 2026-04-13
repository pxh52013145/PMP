import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import {
  InstalledExtensionDesktopWidgetHost,
  InstalledExtensionOverlayHost,
  InstalledExtensionPageHost,
  InstalledExtensionVisualizerHost,
  InstalledExtensionWindowHost,
} from './InstalledExtensionSurfaceHost';

type ResolvedHostProps = {
  preferredKind?: PluginSurfaceSourceKind;
};

export function ResolvedPluginPageHost({
  pluginId,
  pageId,
}: {
  pluginId: string;
  pageId: string;
} & ResolvedHostProps) {
  return <InstalledExtensionPageHost pluginId={pluginId} pageId={pageId} />;
}

export function ResolvedPluginVisualizerHost({
  pluginId,
  visualizerId,
}: {
  pluginId: string;
  visualizerId: string;
} & ResolvedHostProps) {
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
} & ResolvedHostProps) {
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
} & ResolvedHostProps) {
  return surfaceType === 'overlay' ? (
    <InstalledExtensionOverlayHost pluginId={pluginId} surfaceId={surfaceId} />
  ) : (
    <InstalledExtensionDesktopWidgetHost
      pluginId={pluginId}
      surfaceId={surfaceId}
    />
  );
}
