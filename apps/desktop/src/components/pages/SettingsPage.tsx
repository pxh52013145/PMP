import './SettingsPage.css';
import React, { useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import type { SettingsPanelContribution } from '../../contracts/contributions';
import { useT } from '../../i18n';

function sortPanels(a: SettingsPanelContribution, b: SettingsPanelContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

type SettingsSection = {
  id: string;
  title: string;
  order: number;
  panels: SettingsPanelContribution[];
};

export const SettingsPage: React.FC = () => {
  const kernel = useKernel();
  const { navigateTo } = useNavigation();
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const panels = useMemo(() => {
    void revision;
    return kernel.contributions.list<SettingsPanelContribution>('settings-panel').sort(sortPanels);
  }, [kernel.contributions, revision]);

  const sections = useMemo(() => {
    const resolveSection = (
      panel: SettingsPanelContribution
    ): Omit<SettingsSection, 'panels'> => {
      if (panel.id === 'plugins' || panel.source === 'plugin' || panel.id.startsWith('pmpm:')) {
        return { id: 'plugins', title: t('settings.sections.plugins'), order: 20 };
      }

      if (panel.id === 'visualizers') {
        return { id: 'visualizers', title: t('settings.sections.visualizers'), order: 30 };
      }

      return { id: 'system', title: t('settings.sections.system'), order: 10 };
    };

    const buckets = new Map<string, SettingsSection>();
    for (const panel of panels) {
      const sectionDef = resolveSection(panel);
      const existing = buckets.get(sectionDef.id);
      if (existing) {
        existing.panels.push(panel);
        continue;
      }
      buckets.set(sectionDef.id, { ...sectionDef, panels: [panel] });
    }

    const sorted = Array.from(buckets.values()).sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });

    for (const section of sorted) {
      section.panels.sort(sortPanels);
    }

    return sorted;
  }, [panels, t]);

  useEffect(() => {
    if (panels.length === 0) {
      if (activePanelId !== null) setActivePanelId(null);
      return;
    }

    if (activePanelId && panels.some((panel) => panel.id === activePanelId)) return;
    setActivePanelId(panels[0].id);
  }, [activePanelId, panels]);

  const activePanel = useMemo(() => {
    if (!activePanelId) return null;
    return panels.find((panel) => panel.id === activePanelId) ?? null;
  }, [activePanelId, panels]);

  return (
    <div className="page-settings">
      <div className="settings-header">
        <div>
          <h1 className="settings-title">{t('pages.settings.title')}</h1>
          <p className="settings-subtitle">{t('pages.settings.subtitle')}</p>
        </div>
        <div className="settings-header-actions">
          <button
            type="button"
            className="settings-action-btn"
            onClick={() => navigateTo('keyboard-shortcuts')}
          >
            {t('pages.keyboard-shortcuts.title')}
          </button>
        </div>
      </div>

      {panels.length === 0 ? (
        <div className="settings-card-note">{t('pages.settings.empty')}</div>
      ) : (
        <div className="settings-layout">
          <aside className="settings-sidebar">
            {sections.map((section) => (
              <div key={section.id} className="settings-sidebar-section">
                <div className="settings-sidebar-section-title">{section.title}</div>
                <div className="settings-sidebar-section-items">
                  {section.panels.map((panel) => (
                    <button
                      key={panel.id}
                      type="button"
                      className="settings-sidebar-item"
                      data-active={panel.id === activePanelId}
                      onClick={() => setActivePanelId(panel.id)}
                    >
                      <span className="settings-sidebar-item-title">{panel.title}</span>
                      {panel.source === 'plugin' && (
                        <span className="settings-sidebar-item-tag">{t('common.source.plugin')}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          <main className="settings-content">
            {activePanel ? (
              <section className="settings-content-panel">
                <div className="settings-content-header">
                  <h2 className="settings-content-title">{activePanel.title}</h2>
                  {activePanel.description && (
                    <p className="settings-content-desc">{activePanel.description}</p>
                  )}
                </div>
                <div className="settings-content-body">{activePanel.render() as React.ReactNode}</div>
              </section>
            ) : (
              <div className="settings-card-note">{t('pages.settings.empty')}</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
