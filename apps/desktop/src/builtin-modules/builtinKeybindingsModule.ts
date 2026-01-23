import type { AppEvents } from '../contracts/events';
import type { KeybindingContribution } from '../contracts/contributions';
import type { KernelModule } from '../kernel';

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac');
}

export function createBuiltinKeybindingsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-keybindings',
    activate: ({ contributions }) => {
      const unregisters = new Map<string, () => void>();

      const register = (contribution: KeybindingContribution) => {
        const key = `${contribution.kind}/${contribution.id}`;
        const unregister = contributions.register(contribution, { replace: true });
        unregisters.set(key, unregister);
      };

      const isMac = isMacPlatform();

      // Command palette (migrates the existing hardcoded Ctrl/Cmd+Shift+P behavior)
      register({
        kind: 'keybinding',
        id: 'builtin:commandPalette:toggle',
        key: isMac ? 'meta+shift+p' : 'ctrl+shift+p',
        command: 'commandPalette:toggle',
        source: 'builtin',
        weight: 200,
      });

      // Keyboard shortcuts window (VSCode-like)
      register({
        kind: 'keybinding',
        id: 'builtin:keyboardShortcuts:open',
        key: isMac ? 'meta+k meta+s' : 'ctrl+k ctrl+s',
        command: 'app:open-keyboard-shortcuts-window',
        source: 'builtin',
        weight: 200,
      });

      // === Streaming / music player controls ===
      // Space (common in streaming apps) - avoid triggering when nothing can be played.
      register({
        kind: 'keybinding',
        id: 'builtin:audio:togglePlayPause:space',
        key: 'space',
        command: 'audio:toggle-play-pause',
        when: 'audio.hasQueue || audio.hasCurrentTrack',
        source: 'builtin',
        weight: 180,
      });

      // Media keys (when focused).
      register({
        kind: 'keybinding',
        id: 'builtin:audio:togglePlayPause:media',
        key: 'MediaPlayPause',
        command: 'audio:toggle-play-pause',
        source: 'builtin',
        weight: 180,
      });

      register({
        kind: 'keybinding',
        id: 'builtin:audio:nextTrack:media',
        key: 'MediaTrackNext',
        command: 'audio:next-track',
        source: 'builtin',
        weight: 180,
      });

      register({
        kind: 'keybinding',
        id: 'builtin:audio:previousTrack:media',
        key: 'MediaTrackPrevious',
        command: 'audio:previous-track',
        source: 'builtin',
        weight: 180,
      });

      // Mouse side buttons (best-effort via Tauri event on Windows).
      register({
        kind: 'keybinding',
        id: 'builtin:audio:previousTrack:mouse4',
        key: 'mouse4',
        command: 'audio:previous-track',
        source: 'builtin',
        weight: 180,
      });

      register({
        kind: 'keybinding',
        id: 'builtin:audio:nextTrack:mouse5',
        key: 'mouse5',
        command: 'audio:next-track',
        source: 'builtin',
        weight: 180,
      });

      return () => {
        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-keybindings] unregister failed', error);
          }
        }
        unregisters.clear();
      };
    },
  };
}
