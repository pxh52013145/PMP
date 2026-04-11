import type { CommandsService } from './CommandsService';

function getDefaultUnavailableMessage(commandId: string): string {
  return `Command service is not available for ${commandId}.`;
}

export function canDispatchCommand(
  commands: CommandsService | null | undefined,
  commandId: string
): boolean {
  return Boolean(commands?.get(commandId));
}

export async function dispatchRequiredCommand(
  commands: CommandsService | null | undefined,
  commandId: string,
  unavailableMessage = getDefaultUnavailableMessage(commandId),
  args?: unknown
): Promise<void> {
  if (!commands) {
    throw new Error(unavailableMessage);
  }
  await commands.dispatch(commandId, args);
}

export async function dispatchCommandOrFallback(
  commands: CommandsService | null | undefined,
  commandId: string,
  fallback: () => void | Promise<void>,
  args?: unknown
): Promise<void> {
  if (commands && canDispatchCommand(commands, commandId)) {
    await commands.dispatch(commandId, args);
    return;
  }
  await fallback();
}
