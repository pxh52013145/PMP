import { createServiceToken } from '../../kernel';
import type { ContributionRegistryApi } from '../../kernel';
import type { CommandContribution } from '../../contracts/contributions';

export type CommandsService = {
  list: () => CommandContribution[];
  get: (id: string) => CommandContribution | null;
  dispatch: (id: string, args?: unknown) => Promise<void>;
};

export const COMMANDS_SERVICE_TOKEN = createServiceToken<CommandsService>('CommandsService');

export class DefaultCommandsService implements CommandsService {
  constructor(private readonly contributions: ContributionRegistryApi) {}

  list(): CommandContribution[] {
    return this.contributions.list<CommandContribution>('command');
  }

  get(id: string): CommandContribution | null {
    return this.contributions.get<CommandContribution>('command', id);
  }

  async dispatch(id: string, args?: unknown): Promise<void> {
    const command = this.get(id);
    if (!command) {
      throw new Error(`[CommandsService] Command not registered: ${id}`);
    }
    await command.run(args);
  }
}
