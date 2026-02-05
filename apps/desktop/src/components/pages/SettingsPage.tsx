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

function resolveSettingsSectionId(panel: SettingsPanelContribution): 'system' | 'plugins' | 'visualizers' {
  if (panel.id === 'plugins' || panel.source === 'plugin' || panel.id.startsWith('pmpm:')) return 'plugins';
  if (panel.id === 'visualizers') return 'visualizers';
  return 'system';
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
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const panels = useMemo(() => {
    void revision;
    return kernel.contributions.list<SettingsPanelContribution>('settings-panel').sort(sortPanels);
  }, [kernel.contributions, revision]);

  const sections = useMemo(() => {
    const resolveSection = (panel: SettingsPanelContribution): Omit<SettingsSection, 'panels'> => {
      const id = resolveSettingsSectionId(panel);
      switch (id) {
        case 'plugins':
          return { id, title: t('settings.sections.plugins'), order: 20 };
        case 'visualizers':
          return { id, title: t('settings.sections.visualizers'), order: 30 };
        case 'system':
        default:
          return { id: 'system', title: t('settings.sections.system'), order: 10 };
      }
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
      if (activeSectionId !== null) setActiveSectionId(null);
      return;
    }

    const validSectionId = activeSectionId && sections.some((section) => section.id === activeSectionId);
    const nextSectionId = validSectionId ? activeSectionId : sections[0]?.id ?? null;

    let nextPanelId = activePanelId && panels.some((panel) => panel.id === activePanelId) ? activePanelId : null;
    if (!nextPanelId) {
      const targetSection = nextSectionId ? sections.find((section) => section.id === nextSectionId) : null;
      nextPanelId = targetSection?.panels[0]?.id ?? panels[0].id;
    }

    const derivedSectionId =
      sections.find((section) => section.panels.some((panel) => panel.id === nextPanelId))?.id ?? nextSectionId;

    if (nextPanelId !== activePanelId) setActivePanelId(nextPanelId);
    if (derivedSectionId && derivedSectionId !== activeSectionId) setActiveSectionId(derivedSectionId);
  }, [activePanelId, activeSectionId, panels, sections]);

  const activePanel = useMemo(() => {
    if (!activePanelId) return null;
    return panels.find((panel) => panel.id === activePanelId) ?? null;
  }, [activePanelId, panels]);

  const activeSection = useMemo(() => {
    if (!activeSectionId) return null;
    return sections.find((section) => section.id === activeSectionId) ?? null;
  }, [activeSectionId, sections]);

  const visiblePanels = useMemo(() => {
    return activeSection?.panels ?? panels;
  }, [activeSection, panels]);

  return (
    <div className="page-settings page-settings--deltaforce">
      {panels.length === 0 ? (
        <div className="settings-card-note">{t('pages.settings.empty')}</div>
      ) : (
        <div className="settings-shell">
          <header className="settings-topbar">
            <div className="settings-topbar-left">
              {sections.length > 1 ? (
                <div className="settings-main-tabs" role="tablist" aria-label={t('pages.settings.title')}>
                  {sections.map((section, index) => {
                    const isActive = section.id === activeSectionId;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        className="settings-main-tab"
                        data-active={isActive}
                        data-has-separator={index < sections.length - 1}
                        onClick={() => {
                          setActiveSectionId(section.id);
                          const panelInSection =
                            section.panels.find((panel) => panel.id === activePanelId)?.id ??
                            section.panels[0]?.id ??
                            null;
                          if (panelInSection) setActivePanelId(panelInSection);
                        }}
                      >
                        <span className="settings-main-tab-label">{section.title}</span>
                        <span className="settings-main-tab-count">{section.panels.length}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-topbar-title">
                  <div className="settings-title">{t('pages.settings.title')}</div>
                  <div className="settings-subtitle">{t('pages.settings.subtitle')}</div>
                </div>
              )}
            </div>

            <div className="settings-topbar-actions">
              <button
                type="button"
                className="settings-action-btn settings-action-btn--topbar"
                onClick={() => navigateTo('keyboard-shortcuts')}
              >
                {t('pages.keyboard-shortcuts.title')}
              </button>
            </div>
          </header>

          <div className="settings-divider" />

          <nav className="settings-subbar" aria-label={t('pages.settings.title')}>
            <div className="settings-sub-tabs">
              {visiblePanels.map((panel, index) => (
                <button
                  key={panel.id}
                  type="button"
                  className="settings-sub-tab"
                  data-active={panel.id === activePanelId}
                  data-has-separator={index < visiblePanels.length - 1}
                  onClick={() => {
                    setActivePanelId(panel.id);
                    setActiveSectionId(resolveSettingsSectionId(panel));
                  }}
                  title={panel.title}
                >
                  <span className="settings-sub-tab-label">{panel.title}</span>
                  {panel.source === 'plugin' && (
                    <span className="settings-sub-tab-tag">{t('common.source.plugin')}</span>
                  )}
                </button>
              ))}
            </div>
          </nav>

          <div className="settings-divider" />

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
