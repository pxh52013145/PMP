import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { CommandContribution, WindowContribution } from '../contracts/contributions';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../services/audio';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { openVstManagerWindow } from '../utils/vstManagerWindows';
import { subscribeLocale, t } from '../i18n/core';
import {
  goBackBuiltinViaHostCapability,
  navigateBuiltinViaHostCapability,
} from './builtinNavigationCapabilityBridge';

const telemetry = getTelemetryLogger('commands', 'builtinCommandsModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createBuiltinCommandsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-commands',
    activate: ({ contributions, services, events }) => {
      const unregisters = new Map<string, () => void>();

      const register = (contribution: CommandContribution) => {
        const key = `${contribution.kind}/${contribution.id}`;
        const unregister = contributions.register(contribution, { replace: true });
        unregisters.set(key, unregister);
      };

      const sync = () => {
        register({
          kind: 'command',
          id: 'commandPalette:toggle',
          title: t('commands.commandPalette.toggle.title'),
          description: t('commands.commandPalette.toggle.description'),
          source: 'builtin',
          group: 'core',
          order: 1,
          run: async () => {
            events.emit('ui/commandPaletteToggleRequested', null);
          },
        });

        register({
          kind: 'command',
          id: 'commandPalette:close',
          title: t('commands.commandPalette.close.title'),
          description: t('commands.commandPalette.close.description'),
          source: 'builtin',
          group: 'core',
          order: 2,
          run: async () => {
            events.emit('ui/commandPaletteCloseRequested', null);
          },
        });

        register({
          kind: 'command',
          id: 'app:open-keyboard-shortcuts-window',
          title: t('commands.app.open-keyboard-shortcuts-window.title'),
          description: t('commands.app.open-keyboard-shortcuts-window.description'),
          source: 'builtin',
          group: 'core',
          order: 3,
          run: async () => {
            const win = contributions.get<WindowContribution>('window', 'keyboard-shortcuts');
            if (!win) {
              telemetry.warn('command.keyboard_shortcuts_window.not_registered');
              return;
            }
            await win.open();
          },
        });

        register({
          kind: 'command',
          id: 'audio:previous-track',
          title: t('commands.audio.previous-track.title'),
          description: t('commands.audio.previous-track.description'),
          source: 'builtin',
          group: 'audio',
          order: 300,
          run: async () => {
            const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
            const audioService = audioEngine.getSnapshot().audioService;
            await audioService.playPrevious();
          },
        });

        register({
          kind: 'command',
          id: 'audio:next-track',
          title: t('commands.audio.next-track.title'),
          description: t('commands.audio.next-track.description'),
          source: 'builtin',
          group: 'audio',
          order: 310,
          run: async () => {
            const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
            const audioService = audioEngine.getSnapshot().audioService;
            await audioService.playNext();
          },
        });

        register({
          kind: 'command',
          id: 'audio:toggle-play-pause',
          title: t('commands.audio.toggle-play-pause.title'),
          description: t('commands.audio.toggle-play-pause.description'),
          source: 'builtin',
          group: 'audio',
          order: 320,
          run: async () => {
            const audioEngine = services.get(AUDIO_ENGINE_SERVICE_TOKEN);
            const audioService = audioEngine.getSnapshot().audioService;
            const state = audioService.getState();
            if (state.playbackState === 'playing' || state.playbackState === 'buffering') {
              audioService.pause();
              return;
            }
            if (!state.currentTrack && state.queue.length > 0) {
              const index =
                typeof state.currentIndex === 'number' &&
                state.currentIndex >= 0 &&
                state.currentIndex < state.queue.length
                  ? state.currentIndex
                  : 0;
              await audioService.playTrackAtIndex(index);
              return;
            }
            await audioService.play();
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-home',
          title: t('commands.app.navigate-home.title'),
          description: t('commands.app.navigate-home.description'),
          source: 'builtin',
          group: 'navigation',
          order: 10,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'home',
              undefined,
              'app:navigate-home'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-settings',
          title: t('commands.app.navigate-settings.title'),
          description: t('commands.app.navigate-settings.description'),
          source: 'builtin',
          group: 'navigation',
          order: 20,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'settings',
              undefined,
              'app:navigate-settings'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-music-library',
          title: t('commands.app.navigate-music-library.title'),
          description: t('commands.app.navigate-music-library.description'),
          source: 'builtin',
          group: 'navigation',
          order: 30,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'music-library',
              undefined,
              'app:navigate-music-library'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-dsp-rack',
          title: t('commands.app.navigate-dsp-rack.title'),
          description: t('commands.app.navigate-dsp-rack.description'),
          source: 'builtin',
          group: 'audio',
          order: 50,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'dsp-rack',
              undefined,
              'app:navigate-dsp-rack'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-native-debug',
          title: t('commands.app.navigate-native-debug.title'),
          description: t('commands.app.navigate-native-debug.description'),
          source: 'builtin',
          group: 'debug',
          order: 90,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'debug',
              { tab: 'native-debug' },
              'app:navigate-native-debug'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:navigate-debug-center',
          title: t('commands.app.navigate-debug-center.title'),
          description: t('commands.app.navigate-debug-center.description'),
          source: 'builtin',
          group: 'debug',
          order: 80,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'debug',
              { tab: 'debug-center' },
              'app:navigate-debug-center'
            );
          },
        });

        register({
          kind: 'command',
          id: 'app:open-vst3-plugin-manager',
          title: t('commands.app.open-vst3-plugin-manager.title'),
          description: t('commands.app.open-vst3-plugin-manager.description'),
          source: 'builtin',
          group: 'audio',
          order: 60,
          run: async () => {
            await openVstManagerWindow({ title: t('windows.vst-manager.title') });
          },
        });

        register({
          kind: 'command',
          id: 'app:go-back',
          title: t('commands.app.go-back.title'),
          description: t('commands.app.go-back.description'),
          source: 'builtin',
          group: 'navigation',
          order: 40,
          run: async () => {
            await goBackBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'app:go-back'
            );
          },
        });
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          telemetry.warn('command.locale_subscription.cleanup_failed', {
            message: readErrorMessage(error),
          });
        }

        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            telemetry.warn('command.unregister.failed', {
              message: readErrorMessage(error),
            });
          }
        }
        unregisters.clear();
      };
    },
  };
}
