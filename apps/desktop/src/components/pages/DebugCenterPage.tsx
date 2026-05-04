import React from 'react';
import './DebugCenterPage.css';
import { DebugCenter, type DebugWorkspaceId } from '../debug/DebugCenter';

type DebugCenterPageProps = {
  activeWorkspace?: DebugWorkspaceId;
  onWorkspaceChange?: (workspace: DebugWorkspaceId) => void;
  hideWorkspaceNav?: boolean;
};

export const DebugCenterPage: React.FC<DebugCenterPageProps> = ({
  activeWorkspace,
  onWorkspaceChange,
  hideWorkspaceNav,
}) => {
  return (
    <div className="page-debug-center">
      <DebugCenter
        variant="page"
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={onWorkspaceChange}
        hideWorkspaceNav={hideWorkspaceNav}
      />
    </div>
  );
};

