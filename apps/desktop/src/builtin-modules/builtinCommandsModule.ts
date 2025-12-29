import type { KernelModule } from '../kernel';
import type { AppEvents } from '../contracts/events';
import type { CommandContribution } from '../contracts/contributions';
import { NAVIGATION_SERVICE_TOKEN } from '../services/navigation';
import { openVstManagerWindow } from '../utils/vstManagerWindows';

export function createBuiltinCommandsModule(): KernelModule<AppEvents> {
  return {
    id: 'builtin-commands',
    activate: ({ contributions, services }) => {
      const unregisters: Array<() => void> = [];

      const register = (contribution: CommandContribution) => {
        unregisters.push(contributions.register(contribution));
      };

      register({
        kind: 'command',
        id: 'app:navigate-home',
        title: '导航：首页',
        description: '跳转到首页',
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
        title: '导航：设置',
        description: '跳转到设置页',
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
        title: '导航：音乐库',
        description: '跳转到音乐库',
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
        title: '导航：DSP Rack',
        description: '打开 DSP Rack（管理 DSP Graph）',
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
        title: '导航：Native Debug',
        description: '跳转到原生引擎调试页',
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
        title: '窗口：VST3 Plugin Manager',
        description: '打开 VST3 插件管理窗口',
        source: 'builtin',
        group: 'audio',
        order: 60,
        run: async () => {
          await openVstManagerWindow({ title: 'VST3 Plugin Manager' });
        },
      });

      register({
        kind: 'command',
        id: 'app:go-back',
        title: '导航：返回',
        description: '返回上一页',
        source: 'builtin',
        group: 'navigation',
        order: 40,
        run: async () => {
          services.get(NAVIGATION_SERVICE_TOKEN).goBack();
        },
      });

      return () => {
        for (const unregister of unregisters.splice(0)) {
          try {
            unregister();
          } catch (error) {
            console.warn('[builtin-commands] unregister failed', error);
          }
        }
      };
    },
  };
}
