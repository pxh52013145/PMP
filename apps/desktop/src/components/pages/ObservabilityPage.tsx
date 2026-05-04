import React from 'react';
import './ObservabilityPage.css';
import { useT } from '../../i18n';
import { DebugCenter } from '../debug/DebugCenter';

export const ObservabilityPage: React.FC = () => {
  const t = useT();

  return (
    <div className="page-observability">
      <DebugCenter
        variant="page"
        initialWorkspace="telemetry"
        title={t('pages.observability.title')}
        subtitle={t('pages.observability.subtitle')}
      />
    </div>
  );
};
