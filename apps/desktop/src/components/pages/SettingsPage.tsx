import './SettingsPage.css';
import React, { useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import type { SettingsPanelContribution } from '../../contracts/contributions';

function sortPanels(a: SettingsPanelContribution, b: SettingsPanelContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export const SettingsPage: React.FC = () => {
  const kernel = useKernel();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const panels = useMemo(() => {
    void revision;
    return kernel.contributions.list<SettingsPanelContribution>('settings-panel').sort(sortPanels);
  }, [kernel.contributions, revision]);

  return (
    <div className="page-settings">
      <div className="settings-header">
        <div>
          <h1 className="settings-title">设置</h1>
          <p className="settings-subtitle">在这里管理全局配置、插件与可视化入口</p>
        </div>
      </div>

      <div className="settings-sections">
        {panels.length === 0 ? (
          <div className="settings-card-note">No settings panels registered.</div>
        ) : (
          panels.map((panel) => (
            <section key={panel.id} className="settings-section">
              <h2 className="settings-section-title">{panel.title}</h2>
              {panel.render() as React.ReactNode}
            </section>
          ))
        )}
      </div>
    </div>
  );
};
