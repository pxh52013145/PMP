import type { AppEvents } from '../../contracts/events';
import type { KernelModule } from '../../kernel';
import { COMMANDS_SERVICE_TOKEN } from '../commands/CommandsService';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../audio';
import type { AudioState } from '../audio';
import { NAVIGATION_SERVICE_TOKEN } from '../navigation';
import { DefaultKeybindingsService, KEYBINDINGS_SERVICE_TOKEN } from './KeybindingsService';

export function createKeybindingsModule(): KernelModule<AppEvents> {
  return {
    id: 'keybindings',
    activate: ({ services, events, contributions }) => {
      const commands = services.get(COMMANDS_SERVICE_TOKEN);
      const service = new DefaultKeybindingsService(events, contributions, commands);

      // === Context state machine (VSCode-like ContextKeyService, minimal set) ===
      const windowType = resolveWindowTypeFromHash();
      service.setContext('app.windowType', windowType);
      service.setContext('app.isMainWindow', windowType === 'main');

      const navigation = services.getOptional(NAVIGATION_SERVICE_TOKEN);
      if (navigation) {
        const snap = navigation.getSnapshot();
        service.setContext('navigation.page', snap.currentPage.type);
        service.setContext('navigation.canGoBack', snap.currentIndex > 0);
      }

      const applyAudioContext = (state: AudioState) => {
        service.setContext('audio.playbackState', state.playbackState);
        service.setContext('audio.hasCurrentTrack', Boolean(state.currentTrack));
        service.setContext('audio.hasQueue', Array.isArray(state.queue) && state.queue.length > 0);
      };

      const audioEngine = services.getOptional(AUDIO_ENGINE_SERVICE_TOKEN);
      if (audioEngine) {
        applyAudioContext(audioEngine.getSnapshot().audioService.getState());
      }

      let commandPaletteOpen = false;
      service.setContext('ui.commandPaletteOpen', commandPaletteOpen);

      events.on('navigation/changed', (payload) => {
        service.setContext('navigation.page', payload.currentPage.type);
        service.setContext('navigation.canGoBack', payload.currentIndex > 0);
      });

      events.on('audio/stateChanged', (payload) => {
        applyAudioContext(payload);
      });

      events.on('ui/commandPaletteToggleRequested', () => {
        commandPaletteOpen = !commandPaletteOpen;
        service.setContext('ui.commandPaletteOpen', commandPaletteOpen);
      });

      events.on('ui/commandPaletteCloseRequested', () => {
        commandPaletteOpen = false;
        service.setContext('ui.commandPaletteOpen', commandPaletteOpen);
      });

      const unregister = services.register(KEYBINDINGS_SERVICE_TOKEN, service);
      return () => {
        unregister();
        service.destroy();
      };
    },
  };
}

function resolveWindowTypeFromHash(): 'main' | 'editor' | 'plugin-window' | 'vst-manager' {
  if (typeof window === 'undefined') return 'main';
  const hash = window.location.hash ?? '';
  if (hash.startsWith('#/editor/')) return 'editor';
  if (hash.startsWith('#/plugin-window/')) return 'plugin-window';
  if (hash.startsWith('#/vst-manager')) return 'vst-manager';
  return 'main';
}
