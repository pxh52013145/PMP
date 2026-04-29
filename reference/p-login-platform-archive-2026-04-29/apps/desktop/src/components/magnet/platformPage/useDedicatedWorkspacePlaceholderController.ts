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

  const connectorDisplayName = useMemo(() => {
    if (!activeWorkspaceDescriptor) {
      return t('magnet.platform.mode.generic');
    }
    if (activeWorkspaceDescriptor.labelKey) {
      return t(activeWorkspaceDescriptor.labelKey);
    }
    const displayName = activeWorkspaceDescriptor.displayName?.trim();
    return displayName || t('magnet.platform.mode.generic');
  }, [activeWorkspaceDescriptor, t]);

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
