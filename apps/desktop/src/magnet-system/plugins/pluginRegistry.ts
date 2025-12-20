import { getPluginRendererDefinition, loadInstalledPmpmPlugins } from './pmpm';
import { registerMagnetRenderer, unregisterMagnetRenderer } from '../registry';

const registeredPluginIds = new Set<string>();

export function syncPmpmPluginRenderers(): void {
  if (typeof window === 'undefined') return;

  const installed = loadInstalledPmpmPlugins();
  const nextIds = new Set(installed.map((plugin) => plugin.manifest.metadata.id));

  for (const id of Array.from(registeredPluginIds)) {
    if (nextIds.has(id)) continue;
    unregisterMagnetRenderer(id);
    registeredPluginIds.delete(id);
  }

  for (const id of nextIds) {
    const def = getPluginRendererDefinition(id);
    if (!def) continue;
    registerMagnetRenderer(def, { overwrite: true });
    registeredPluginIds.add(id);
  }
}

