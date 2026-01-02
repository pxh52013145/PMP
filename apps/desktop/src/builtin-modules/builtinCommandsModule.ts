import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { CommandContribution } from '../contracts/contributions';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { openVstManagerWindow } from '../utils/vstManagerWindows';
import { subscribeLocale, t } from '../i18n/core';

export function createBuiltinCommandsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-commands',
    activate: ({ contributions, services }) => {
      const unregisters = new Map<string, () => void>();

      const register = (contribution: CommandContribution) => {
        const key = `${contribution.kind}/${contribution.id}`;
        const unregister = contributions.register(contribution, { replace: true });
        unregisters.set(key, unregister);
      };

      const sync = () => {
        register({
          kind: 'command',
          id: 'app:navigate-home',
          title: t('commands.app.navigate-home.title'),
          description: t('commands.app.navigate-home.description'),
          source: 'builtin',
          group: 'navigation',
          order: 10,
          run: async () => {
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('home');
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
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('settings');
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
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('music-library');
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
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('dsp-rack');
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
            services.get(NAVIGATION_SERVICE_TOKEN).navigateTo('native-debug');
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
            services.get(NAVIGATION_SERVICE_TOKEN).goBack();
          },
        });
      };

      sync();
      const unsubscribeLocale = subscribeLocale(() => sync());

      return () => {
        try {
          unsubscribeLocale();
        } catch (error) {
          console.warn('[builtin-commands] locale subscription cleanup failed', error);
        }

        for (const unregister of unregisters.values()) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-commands] unregister failed', error);
          }
        }
        unregisters.clear();
      };
    },
  };
}
