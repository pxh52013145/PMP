import React from 'react';
import './DebugCenterPage.css';
import { DebugCenter } from '../debug/DebugCenter';

export const DebugCenterPage: React.FC = () => {
  return (
    <div className="page-debug-center">
      <DebugCenter variant="page" />
    </div>
  );
};

