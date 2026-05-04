import React from 'react';
import './ObservabilityPage.css';
import { PerfMonitorPage } from './PerfMonitorPage';

export const ObservabilityPage: React.FC = () => {
  return (
    <div className="page-observability">
      <PerfMonitorPage />
    </div>
  );
};
