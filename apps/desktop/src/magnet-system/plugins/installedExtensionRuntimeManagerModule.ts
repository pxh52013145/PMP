import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { AUDIO_ENGINE_SERVICE_TOKEN } from '../../services/audio';
import { COMMANDS_SERVICE_TOKEN } from '../../services/commands';
import { KEYBINDINGS_SERVICE_TOKEN } from '../../services/keybindings';
import { NAVIGATION_SERVICE_TOKEN } from '../../services/navigation';
import {
  DefaultInstalledExtensionRuntimeManager,
  INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN,
} from './installedExtensionRuntimeManager';

export function createInstalledExtensionRuntimeManagerModule(): KernelModule<AppEvents> {
  return {
    id: 'installed-extension-runtime-manager',
    activate: ({ services }) => {
      const service = new DefaultInstalledExtensionRuntimeManager({
        audioEngine: services.get(AUDIO_ENGINE_SERVICE_TOKEN),
        commands: services.getOptional(COMMANDS_SERVICE_TOKEN),
        navigation: services.get(NAVIGATION_SERVICE_TOKEN),
        keybindings: services.getOptional(KEYBINDINGS_SERVICE_TOKEN),
      });

      service.start();
      const unregister = services.register(INSTALLED_EXTENSION_RUNTIME_MANAGER_TOKEN, service);
      return () => {
        unregister();
        service.dispose();
      };
    },
  };
}
