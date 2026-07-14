import './SettingsPage.css';
import React, { useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelApiContext';
import type { SettingsPanelContribution } from '../../contracts/contributions';
import { useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { useSkinSurfaceModel } from '../../themes/skinSurface';
import {
  buildThemePresenceAnimationStyle,
  getThemeMotionTotalMs,
  pickThemeMotionChannel,
  useThemePresenceState,
} from '../../themes/surfaceMotion';
import { PmpChoiceButton } from '../primitives';

function sortPanels(a: SettingsPanelContribution, b: SettingsPanelContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return value === 'system' || value === 'audio' || value === 'plugins' || value === 'visualizers';
}

function resolveSettingsSectionId(panel: SettingsPanelContribution): SettingsSectionId {
  const sectionInMetadata = panel.metadata?.settingsSection;
  if (typeof sectionInMetadata === 'string') {
    const normalized = sectionInMetadata.trim();
    if (isSettingsSectionId(normalized)) return normalized;
  }

  if (panel.id === 'plugins' || panel.source === 'plugin' || panel.group === 'plugin') {
    return 'plugins';
  }

  if (panel.id === 'visualizers' || panel.group === 'visualizer') return 'visualizers';

  if (
    panel.id === 'audio' ||
    panel.id === 'audio-components' ||
    panel.id === 'audio-buffer' ||
    panel.group === 'audio'
  ) {
    return 'audio';
  }

  return 'system';
}

type SettingsSectionId = 'system' | 'audio' | 'plugins' | 'visualizers';

type SettingsSection = {
  id: SettingsSectionId;
  title: string;
  order: number;
  panels: SettingsPanelContribution[];
};

export const SettingsPage: React.FC = () => {
  const kernel = useKernel();
  const t = useT();
  const telemetry = useMemo(() => getTelemetryLogger('settings', 'SettingsPage'), []);
  const pageSurface = useSkinSurfaceModel('page.settings');
  const pageEnterMotion = useMemo(
    () => pickThemeMotionChannel(pageSurface.root.motion, ['enter']),
    [pageSurface.root.motion]
  );
  const pagePresence = useThemePresenceState({
    open: true,
    enterDurationMs: getThemeMotionTotalMs(pageEnterMotion?.spec),
    unmountOnExit: false,
  });
  const pageMotionStyle =
    pagePresence.phase === 'enter'
      ? buildThemePresenceAnimationStyle(pageEnterMotion?.spec, 'enter')
      : undefined;
  const [revision, setRevision] = useState(0);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const subTabsRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const panels = useMemo(() => {
    void revision;
    return kernel.contributions.list<SettingsPanelContribution>('settings-panel').sort(sortPanels);
  }, [kernel.contributions, revision]);

  const sections = useMemo(() => {
    const baseSections: SettingsSection[] = [
      {
        id: 'system',
        title: t('settings.sections.system'),
        order: 10,
        panels: [],
      },
      {
        id: 'audio',
        title: t('settings.sections.audio'),
        order: 20,
        panels: [],
      },
      {
        id: 'plugins',
        title: t('settings.sections.plugins'),
        order: 30,
        panels: [],
      },
      {
        id: 'visualizers',
        title: t('settings.sections.visualizers'),
        order: 40,
        panels: [],
      },
    ];

    const buckets = new Map<SettingsSectionId, SettingsSection>(
      baseSections.map((section) => [section.id, section])
    );
    for (const panel of panels) {
      const sectionId = resolveSettingsSectionId(panel);
      const section = buckets.get(sectionId);
      if (section) section.panels.push(panel);
    }

    const sorted = baseSections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });

    for (const section of sorted) {
      section.panels.sort(sortPanels);
    }

    return sorted.filter((section) => section.panels.length > 0);
  }, [panels, t]);

  useEffect(() => {
    if (sections.length === 0) {
      if (activePanelId !== null) setActivePanelId(null);
      if (activeSectionId !== null) setActiveSectionId(null);
      return;
    }

    let nextSection: SettingsSection | null = null;
    if (activeSectionId) {
      nextSection = sections.find((section) => section.id === activeSectionId) ?? null;
    }
    if (!nextSection) {
      nextSection = sections.find((section) => section.panels.length > 0) ?? sections[0] ?? null;
    }

    const nextSectionId = nextSection?.id ?? null;
    const sectionPanels = nextSection?.panels ?? [];

    const nextPanelId =
      sectionPanels.length === 0
        ? null
        : sectionPanels.some((panel) => panel.id === activePanelId)
          ? activePanelId
          : (sectionPanels[0]?.id ?? null);

    if (nextSectionId !== activeSectionId) setActiveSectionId(nextSectionId);
    if (nextPanelId !== activePanelId) setActivePanelId(nextPanelId);
  }, [activePanelId, activeSectionId, sections]);

  const activePanel = useMemo(() => {
    if (!activePanelId) return null;
    return panels.find((panel) => panel.id === activePanelId) ?? null;
  }, [activePanelId, panels]);

  const activeSection = useMemo(() => {
    if (!activeSectionId) return null;
    return sections.find((section) => section.id === activeSectionId) ?? null;
  }, [activeSectionId, sections]);

  const visiblePanels = useMemo(() => {
    return activeSection?.panels ?? [];
  }, [activeSection]);

  const rootProps = pageSurface.getElementProps({
    bindingId: 'page.settings',
    className: ['page-settings', 'page-settings--deltaforce'].join(' '),
    style: pageMotionStyle,
  });

  useEffect(() => {
    telemetry.info('settings.page.enter');
    return () => {
      telemetry.info('settings.page.leave');
    };
  }, [telemetry]);

  useEffect(() => {
    if (!activeSectionId) return;
    telemetry.info('settings.section.changed', {
      fields: {
        sectionId: activeSectionId,
        panelCount: visiblePanels.length,
      },
    });
  }, [activeSectionId, telemetry, visiblePanels.length]);

  useEffect(() => {
    if (!activePanelId) return;
    telemetry.info('settings.panel.changed', {
      fields: {
        sectionId: activeSectionId,
        panelId: activePanelId,
      },
    });
  }, [activePanelId, activeSectionId, telemetry]);

  return (
    <div
      {...rootProps}
      data-surface-id="page.settings"
      data-surface-variant={pageSurface.variant}
      data-pmp-motion-phase={pagePresence.phase}
      {...(pageEnterMotion?.name ? { 'data-pmp-motion-channel': pageEnterMotion.name } : {})}
      {...(pageEnterMotion?.spec.preset
        ? { 'data-pmp-motion-preset': pageEnterMotion.spec.preset }
        : {})}
    >
      {panels.length === 0 ? (
        <div className="settings-card-note">{t('pages.settings.empty')}</div>
      ) : (
        <div className="settings-shell" data-pmp-part="shell">
          <header className="settings-topbar" data-pmp-part="header">
            <div className="settings-topbar-left" data-pmp-part="header-main">
              {sections.length > 1 ? (
                <div
                  className="settings-main-tabs"
                  data-pmp-part="main-tabs"
                  role="tablist"
                  aria-label={t('pages.settings.title')}
                >
                  {sections.map((section, index) => {
                    const isActive = section.id === activeSectionId;
                    return (
                      <PmpChoiceButton
                        key={section.id}
                        type="button"
                        role="tab"
                        surfaceId="page.settings.main-tab"
                        className="settings-main-tab"
                        active={isActive}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        data-has-separator={index < sections.length - 1}
                        onClick={() => {
                          setActiveSectionId(section.id);
                          const panelInSection =
                            section.panels.find((panel) => panel.id === activePanelId)?.id ??
                            section.panels[0]?.id ??
                            null;
                          setActivePanelId(panelInSection);
                        }}
                      >
                        <span className="settings-main-tab-top">
                          <span className="settings-main-tab-ring-slot" aria-hidden="true">
                            <span className="settings-main-tab-spin" aria-hidden="true" />
                          </span>
                          <span className="settings-main-tab-label">{section.title}</span>
                        </span>
                        <span className="settings-main-tab-active-corner-fx" aria-hidden="true" />
                        <span className="settings-main-tab-corner" aria-hidden="true" />
                      </PmpChoiceButton>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-topbar-title" data-pmp-part="header-title">
                  <div className="settings-title">{t('pages.settings.title')}</div>
                  <div className="settings-subtitle">{t('pages.settings.subtitle')}</div>
                </div>
              )}
            </div>
          </header>

          <div className="settings-divider" data-pmp-part="divider" />

          <nav
            className="settings-subbar"
            data-pmp-part="subbar"
            aria-label={t('pages.settings.title')}
          >
            <div
              ref={subTabsRef}
              className="settings-sub-tabs"
              data-pmp-part="sub-tabs"
              onWheel={(e) => {
                const el = subTabsRef.current;
                if (!el) return;
                const hasOverflow = el.scrollWidth > el.clientWidth + 1;
                if (!hasOverflow) return;
                if (e.shiftKey) return;
                if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                el.scrollLeft += e.deltaY;
                e.preventDefault();
              }}
            >
              {visiblePanels.map((panel, index) => (
                <PmpChoiceButton
                  key={panel.id}
                  type="button"
                  role="tab"
                  surfaceId="page.settings.sub-tab"
                  className="settings-sub-tab"
                  active={panel.id === activePanelId}
                  aria-selected={panel.id === activePanelId}
                  tabIndex={panel.id === activePanelId ? 0 : -1}
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
                </PmpChoiceButton>
              ))}
            </div>
          </nav>

          <div className="settings-divider" />

          <main className="settings-content">
            {activePanel ? (
              <section className="settings-content-panel">
                <div className="settings-content-header">
                  <p className="settings-content-meta">{t('pages.settings.title').toUpperCase()}</p>
                  <h2 className="settings-content-title">{activePanel.title}</h2>
                  {activePanel.description && (
                    <p className="settings-content-desc">{activePanel.description}</p>
                  )}
                </div>
                <div className="settings-content-body">
                  {activePanel.render() as React.ReactNode}
                </div>
              </section>
            ) : (
              <div className="settings-card-note">
                {t('pages.settings.emptySection', {
                  section: activeSection?.title ?? t('pages.settings.title'),
                })}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
