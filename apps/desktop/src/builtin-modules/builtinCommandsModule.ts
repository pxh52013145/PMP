import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { CommandContribution } from '../contracts/contributions';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../services/audio';
import { getTelemetryLogger } from '../services/telemetry/TelemetryService';
import { subscribeLocale, t } from '../i18n/core';
import type { EditorWindowType } from '../utils/editorWindows';
import {
  goBackBuiltinViaHostCapability,
  navigateBuiltinViaHostCapability,
  openBuiltinWindowViaHostCapability,
} from './builtinNavigationCapabilityBridge';

const telemetry = getTelemetryLogger('commands', 'builtinCommandsModule');

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readCommandOptions(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null;
  }
  return args as Record<string, unknown>;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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

      const registerWindowOpenCommand = (options: {
        id: string;
        titleKey: string;
        descriptionKey: string;
        group: string;
        order: number;
        windowId: 'keyboard-shortcuts' | 'vst-manager' | `editor:${EditorWindowType}`;
        defaultWindowTitleKey?: string;
      }) => {
        register({
          kind: 'command',
          id: options.id,
          title: t(options.titleKey),
          description: t(options.descriptionKey),
          source: 'builtin',
          group: options.group,
          order: options.order,
          run: async (args?: unknown) => {
            const commandOptions = readCommandOptions(args);
            await openBuiltinWindowViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              {
                windowId: options.windowId,
                title:
                  readOptionalTitle(commandOptions?.title) ??
                  (options.defaultWindowTitleKey ? t(options.defaultWindowTitleKey) : undefined),
                width: readFiniteNumber(commandOptions?.width),
                height: readFiniteNumber(commandOptions?.height),
                x: readFiniteNumber(commandOptions?.x),
                y: readFiniteNumber(commandOptions?.y),
              },
              options.id
            );
          },
        });
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

        registerWindowOpenCommand({
          id: 'app:open-keyboard-shortcuts-window',
          titleKey: 'commands.app.open-keyboard-shortcuts-window.title',
          descriptionKey: 'commands.app.open-keyboard-shortcuts-window.description',
          group: 'core',
          order: 3,
          windowId: 'keyboard-shortcuts',
        });

        registerWindowOpenCommand({
          id: 'app:open-theme-editor-window',
          titleKey: 'commands.app.open-theme-editor-window.title',
          descriptionKey: 'commands.app.open-theme-editor-window.description',
          group: 'core',
          order: 4,
          windowId: 'editor:theme',
        });

        registerWindowOpenCommand({
          id: 'app:open-debug-editor-window',
          titleKey: 'commands.app.open-debug-editor-window.title',
          descriptionKey: 'commands.app.open-debug-editor-window.description',
          group: 'debug',
          order: 5,
          windowId: 'editor:debug',
        });

        registerWindowOpenCommand({
          id: 'app:open-control-editor-window',
          titleKey: 'commands.app.open-control-editor-window.title',
          descriptionKey: 'commands.app.open-control-editor-window.description',
          group: 'editor',
          order: 6,
          windowId: 'editor:control',
        });

        registerWindowOpenCommand({
          id: 'app:open-creator-editor-window',
          titleKey: 'commands.app.open-creator-editor-window.title',
          descriptionKey: 'commands.app.open-creator-editor-window.description',
          group: 'editor',
          order: 7,
          windowId: 'editor:creator',
        });

        registerWindowOpenCommand({
          id: 'app:open-custom-background-editor-window',
          titleKey: 'commands.app.open-custom-background-editor-window.title',
          descriptionKey: 'commands.app.open-custom-background-editor-window.description',
          group: 'editor',
          order: 8,
          windowId: 'editor:custom-background',
        });

        registerWindowOpenCommand({
          id: 'app:open-statistics-editor-window',
          titleKey: 'commands.app.open-statistics-editor-window.title',
          descriptionKey: 'commands.app.open-statistics-editor-window.description',
          group: 'editor',
          order: 9,
          windowId: 'editor:statistics',
        });

        registerWindowOpenCommand({
          id: 'app:open-library-editor-window',
          titleKey: 'commands.app.open-library-editor-window.title',
          descriptionKey: 'commands.app.open-library-editor-window.description',
          group: 'editor',
          order: 10,
          windowId: 'editor:library',
        });

        registerWindowOpenCommand({
          id: 'app:open-style-editor-window',
          titleKey: 'commands.app.open-style-editor-window.title',
          descriptionKey: 'commands.app.open-style-editor-window.description',
          group: 'editor',
          order: 11,
          windowId: 'editor:style',
        });

        registerWindowOpenCommand({
          id: 'app:open-background-editor-window',
          titleKey: 'commands.app.open-background-editor-window.title',
          descriptionKey: 'commands.app.open-background-editor-window.description',
          group: 'editor',
          order: 12,
          windowId: 'editor:background',
        });

        registerWindowOpenCommand({
          id: 'app:open-style-pixel-editor-window',
          titleKey: 'commands.app.open-style-pixel-editor-window.title',
          descriptionKey: 'commands.app.open-style-pixel-editor-window.description',
          group: 'editor',
          order: 13,
          windowId: 'editor:style-pixel',
        });

        registerWindowOpenCommand({
          id: 'app:open-style-cover-color-editor-window',
          titleKey: 'commands.app.open-style-cover-color-editor-window.title',
          descriptionKey: 'commands.app.open-style-cover-color-editor-window.description',
          group: 'editor',
          order: 14,
          windowId: 'editor:style-cover-color',
        });

        registerWindowOpenCommand({
          id: 'app:open-style-background-effect-editor-window',
          titleKey: 'commands.app.open-style-background-effect-editor-window.title',
          descriptionKey: 'commands.app.open-style-background-effect-editor-window.description',
          group: 'editor',
          order: 15,
          windowId: 'editor:style-background-effect',
        });

        registerWindowOpenCommand({
          id: 'app:open-style-border-effect-editor-window',
          titleKey: 'commands.app.open-style-border-effect-editor-window.title',
          descriptionKey: 'commands.app.open-style-border-effect-editor-window.description',
          group: 'editor',
          order: 16,
          windowId: 'editor:style-border-effect',
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
          id: 'app:navigate-perf-monitor',
          title: t('commands.app.navigate-perf-monitor.title'),
          description: t('commands.app.navigate-perf-monitor.description'),
          source: 'builtin',
          group: 'debug',
          order: 85,
          run: async () => {
            await navigateBuiltinViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              'debug',
              { tab: 'perf-monitor' },
              'app:navigate-perf-monitor'
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
          run: async (args?: unknown) => {
            const commandOptions = readCommandOptions(args);
            await openBuiltinWindowViaHostCapability(
              services.get(NAVIGATION_SERVICE_TOKEN),
              {
                windowId: 'vst-manager',
                title:
                  readOptionalTitle(commandOptions?.title) ?? t('windows.vst-manager.title'),
                width: readFiniteNumber(commandOptions?.width),
                height: readFiniteNumber(commandOptions?.height),
                x: readFiniteNumber(commandOptions?.x),
                y: readFiniteNumber(commandOptions?.y),
              },
              'app:open-vst3-plugin-manager'
            );
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
