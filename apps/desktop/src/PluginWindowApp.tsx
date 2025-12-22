import { useMemo } from 'react';
import { NavigationProvider } from './contexts/NavigationContext';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { PluginWindowHost } from './magnet-system/plugins/PluginWindowHost';
import './PluginWindowApp.css';

function parsePluginWindowHash(): { pluginId: string; windowId: string } | null {
  const hash = window.location.hash;
  const match = hash.match(/#\/plugin-window\/([\w-]+)\/([\w-]+)/);
  if (!match) return null;
  return { pluginId: match[1], windowId: match[2] };
}

export function PluginWindowApp() {
  const parsed = useMemo(() => parsePluginWindowHash(), []);

  if (!parsed) {
    return (
      <div className="plugin-window-root">
        <div className="plugin-window-error">Invalid plugin window route.</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <NavigationProvider>
          <div className="plugin-window-root">
            <PluginWindowHost pluginId={parsed.pluginId} windowId={parsed.windowId} />
          </div>
        </NavigationProvider>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}
