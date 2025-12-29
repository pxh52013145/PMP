import { useMemo } from 'react';
import { ThemeProvider } from './themes/contexts/ThemeContextWithSync';
import { AudioEngineProvider } from './contexts/AudioEngineContext';
import { VstManagerWindow } from './components/vst/VstManagerWindow';
import './VstManagerWindowApp.css';

function isVstManagerRoute(): boolean {
  const hash = window.location.hash;
  return hash === '#/vst-manager' || hash.startsWith('#/vst-manager?');
}

export function VstManagerWindowApp() {
  const ok = useMemo(() => isVstManagerRoute(), []);

  if (!ok) {
    return (
      <div className="vst-manager-window-root">
        <div className="vst-manager-window-error">Invalid VST manager window route.</div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <AudioEngineProvider>
        <div className="vst-manager-window-root">
          <VstManagerWindow />
        </div>
      </AudioEngineProvider>
    </ThemeProvider>
  );
}

