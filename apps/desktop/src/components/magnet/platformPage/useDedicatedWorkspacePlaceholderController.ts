import { useMemo } from 'react';

import type { PlatformWorkspaceDescriptor } from './platformWorkspaceModes';
import type {
  DedicatedWorkspacePlaceholderProps,
  DedicatedWorkspacePlaceholderToolbarProps,
} from './DedicatedWorkspacePlaceholderAdapter';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface UseDedicatedWorkspacePlaceholderControllerParams {
  activeWorkspaceDescriptor: PlatformWorkspaceDescriptor | null;
  t: Translator;
}

export interface DedicatedWorkspacePlaceholderControllerResult {
  placeholderToolbarProps: DedicatedWorkspacePlaceholderToolbarProps;
  placeholderWorkspaceProps: DedicatedWorkspacePlaceholderProps;
}

export function useDedicatedWorkspacePlaceholderController(
  params: UseDedicatedWorkspacePlaceholderControllerParams
): DedicatedWorkspacePlaceholderControllerResult {
  const { activeWorkspaceDescriptor, t } = params;

  const connectorDisplayName =
    activeWorkspaceDescriptor?.displayName?.trim() || t('magnet.platform.mode.generic');

  const placeholderToolbarProps = useMemo<DedicatedWorkspacePlaceholderToolbarProps>(
    () => ({ t }),
    [t]
  );

  const placeholderWorkspaceProps = useMemo<DedicatedWorkspacePlaceholderProps>(
    () => ({
      connectorDisplayName,
      t,
    }),
    [connectorDisplayName, t]
  );

  return {
    placeholderToolbarProps,
    placeholderWorkspaceProps,
  };
}

