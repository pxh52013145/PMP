import { useMemo, useSyncExternalStore } from 'react';
import type { PluginSurfaceSourceKind } from '../../contracts/pluginSurfaceSource';
import {
  getInstalledPmpmPlugin,
  getPmpmPluginsRevision,
  subscribePmpmPlugins,
} from './pmpm';
import {
  getInstalledExtensionRecord,
  getInstalledExtensionsRevision,
  subscribeInstalledExtensions,
} from './extensions';
import { PluginPageHost } from './PluginPageHost';
import {
  PluginDesktopWidgetHost,
  PluginOverlayHost,
} from './PluginShellSurfaceHost';
import { PluginVisualizerHost } from './PluginVisualizerHost';
import { PluginWindowHost } from './PluginWindowHost';
import {
  InstalledExtensionDesktopWidgetHost,
  InstalledExtensionOverlayHost,
  InstalledExtensionPageHost,
  InstalledExtensionVisualizerHost,
  InstalledExtensionWindowHost,
} from './InstalledExtensionSurfaceHost';

function shouldUsePmpmHost(
  preferredKind: PluginSurfaceSourceKind | undefined,
  hasPmpm: boolean,
  hasExtension: boolean
): boolean {
  if (preferredKind === 'pmpm') {
    return hasPmpm || !hasExtension;
  }
  if (preferredKind === 'extv2') {
    return !hasExtension && hasPmpm;
  }
  return hasPmpm || !hasExtension;
}

export function ResolvedPluginPageHost({
  pluginId,
  pageId,
  preferredKind,
}: {
  pluginId: string;
  pageId: string;
  preferredKind?: PluginSurfaceSourceKind;
}) {
  const pmpmRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );
  const extensionRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const hasPmpm = useMemo(() => {
    void pmpmRevision;
    return Boolean(getInstalledPmpmPlugin(pluginId));
  }, [pluginId, pmpmRevision]);
  const hasExtension = useMemo(() => {
    void extensionRevision;
    return Boolean(getInstalledExtensionRecord(pluginId));
  }, [extensionRevision, pluginId]);

  if (shouldUsePmpmHost(preferredKind, hasPmpm, hasExtension)) {
    return <PluginPageHost pluginId={pluginId} pageId={pageId} />;
  }
  return <InstalledExtensionPageHost pluginId={pluginId} pageId={pageId} />;
}

export function ResolvedPluginVisualizerHost({
  pluginId,
  visualizerId,
  preferredKind,
}: {
  pluginId: string;
  visualizerId: string;
  preferredKind?: PluginSurfaceSourceKind;
}) {
  const pmpmRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );
  const extensionRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const hasPmpm = useMemo(() => {
    void pmpmRevision;
    return Boolean(getInstalledPmpmPlugin(pluginId));
  }, [pluginId, pmpmRevision]);
  const hasExtension = useMemo(() => {
    void extensionRevision;
    return Boolean(getInstalledExtensionRecord(pluginId));
  }, [extensionRevision, pluginId]);

  if (shouldUsePmpmHost(preferredKind, hasPmpm, hasExtension)) {
    return <PluginVisualizerHost pluginId={pluginId} visualizerId={visualizerId} />;
  }
  return <InstalledExtensionVisualizerHost pluginId={pluginId} visualizerId={visualizerId} />;
}

export function ResolvedPluginWindowHost({
  pluginId,
  windowId,
  preferredKind,
}: {
  pluginId: string;
  windowId: string;
  preferredKind?: PluginSurfaceSourceKind;
}) {
  const pmpmRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );
  const extensionRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const hasPmpm = useMemo(() => {
    void pmpmRevision;
    return Boolean(getInstalledPmpmPlugin(pluginId));
  }, [pluginId, pmpmRevision]);
  const hasExtension = useMemo(() => {
    void extensionRevision;
    return Boolean(getInstalledExtensionRecord(pluginId));
  }, [extensionRevision, pluginId]);

  if (shouldUsePmpmHost(preferredKind, hasPmpm, hasExtension)) {
    return <PluginWindowHost pluginId={pluginId} windowId={windowId} />;
  }
  return <InstalledExtensionWindowHost pluginId={pluginId} windowId={windowId} />;
}

export function ResolvedPluginShellSurfaceHost({
  pluginId,
  surfaceId,
  surfaceType,
  preferredKind,
}: {
  pluginId: string;
  surfaceId: string;
  surfaceType: 'overlay' | 'desktop-widget';
  preferredKind?: PluginSurfaceSourceKind;
}) {
  const pmpmRevision = useSyncExternalStore(
    subscribePmpmPlugins,
    getPmpmPluginsRevision,
    getPmpmPluginsRevision
  );
  const extensionRevision = useSyncExternalStore(
    subscribeInstalledExtensions,
    getInstalledExtensionsRevision,
    getInstalledExtensionsRevision
  );

  const hasPmpm = useMemo(() => {
    void pmpmRevision;
    return Boolean(getInstalledPmpmPlugin(pluginId));
  }, [pluginId, pmpmRevision]);
  const hasExtension = useMemo(() => {
    void extensionRevision;
    return Boolean(getInstalledExtensionRecord(pluginId));
  }, [extensionRevision, pluginId]);

  if (shouldUsePmpmHost(preferredKind, hasPmpm, hasExtension)) {
    return surfaceType === 'overlay' ? (
      <PluginOverlayHost pluginId={pluginId} surfaceId={surfaceId} />
    ) : (
      <PluginDesktopWidgetHost pluginId={pluginId} surfaceId={surfaceId} />
    );
  }

  return surfaceType === 'overlay' ? (
    <InstalledExtensionOverlayHost pluginId={pluginId} surfaceId={surfaceId} />
  ) : (
    <InstalledExtensionDesktopWidgetHost pluginId={pluginId} surfaceId={surfaceId} />
  );
}
