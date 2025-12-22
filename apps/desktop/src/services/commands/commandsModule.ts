import type { KernelModule } from '../../kernel';
import type { AppEvents } from '../../contracts/events';
import { DefaultCommandsService, COMMANDS_SERVICE_TOKEN } from './CommandsService';

export function createCommandsModule(): KernelModule<AppEvents> {
  return {
    id: 'commands',
    activate: ({ services, contributions }) => {
      const service = new DefaultCommandsService(contributions);
      const unregister = services.register(COMMANDS_SERVICE_TOKEN, service);
      return () => unregister();
    },
  };
}

