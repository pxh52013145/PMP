import './SettingsPage.css';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PageContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { COMMANDS_SERVICE_TOKEN, dispatchCommandOrFallback } from '../../services/commands';
import { PmpButton, PmpChoiceButton } from '../primitives';

function sortPages(a: PageContribution, b: PageContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

type DebugSectionId = 'overview' | 'observability' | 'native';

type DebugSection = {
  id: DebugSectionId;
  title: string;
  order: number;
  pages: PageContribution[];
};

const DEBUG_TAB_IDS = new Set(['debug-center', 'observability', 'perf-monitor', 'native-debug']);
const DEBUG_PAGES_WITH_OWN_HEADER = new Set([
  'debug-center',
  'observability',
  'perf-monitor',
  'native-debug',
]);

function isDebugSectionId(value: string): value is DebugSectionId {
  return value === 'overview' || value === 'observability' || value === 'native';
}

function readDebugTabFromHash(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const hash = window.location.hash ?? '';
  if (!hash.startsWith('#/')) return undefined;

  const [pathPart, queryPart = ''] = hash.slice(2).split('?');
  const pathSegments = pathPart.split('/').filter(Boolean);
  const pageId = pathSegments[0];
  const tabFromPath = pathSegments[1];
  const search = new URLSearchParams(queryPart);
  const tab =
    pageId === 'debug'
      ? tabFromPath ?? search.get('tab') ?? undefined
      : pageId;

  return typeof tab === 'string' && DEBUG_TAB_IDS.has(tab) ? tab : undefined;
}

function resolveDebugSectionId(page: PageContribution): DebugSectionId {
  const sectionInMetadata = page.metadata?.debugSection;
  if (typeof sectionInMetadata === 'string') {
    const normalized = sectionInMetadata.trim();
    if (isDebugSectionId(normalized)) return normalized;
  }

  if (page.id === 'native-debug' || page.tags?.includes('native')) return 'native';
  if (
    page.id === 'observability' ||
    page.id === 'perf-monitor' ||
    page.tags?.includes('telemetry') ||
    page.tags?.includes('perf') ||
    page.tags?.includes('webview2')
  ) {
    return 'observability';
  }

  return 'overview';
}

function getDebugSectionLabel(section: DebugSection): string {
  if (section.pages.length === 1) {
    return section.pages[0]?.title ?? section.title;
  }
  return section.title;
}

export const DebugPage: React.FC = () => {
  const kernel = useKernel();
  const commands = kernel.services.getOptional(COMMANDS_SERVICE_TOKEN);
  const { navigateTo, currentPage } = useNavigation();
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const subTabsRef = React.useRef<HTMLDivElement | null>(null);

  const openDebugTab = useCallback(
    (pageId: string) => {
      const builtinCommandId =
        pageId === 'debug-center'
          ? 'app:navigate-debug-center'
          : pageId === 'native-debug'
            ? 'app:navigate-native-debug'
            : pageId === 'perf-monitor'
              ? 'app:navigate-perf-monitor'
              : null;

      if (!builtinCommandId) {
        navigateTo('debug', { tab: pageId });
        return;
      }

      void dispatchCommandOrFallback(commands, builtinCommandId, () =>
        navigateTo('debug', { tab: pageId })
      );
    },
    [commands, navigateTo]
  );

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const pages = useMemo(() => {
    void revision;
    return kernel.contributions
      .list<PageContribution>('page')
      .filter((page) => page.group === 'debug')
      .filter((page) => page.id !== 'debug')
      .sort(sortPages);
  }, [kernel.contributions, revision]);

  const sections = useMemo(() => {
    const baseSections: DebugSection[] = [
      {
        id: 'overview',
        title: t('pages.debug.sections.overview'),
        order: 10,
        pages: [],
      },
      {
        id: 'observability',
        title: t('pages.debug.sections.observability'),
        order: 20,
        pages: [],
      },
      {
        id: 'native',
        title: t('pages.debug.sections.native'),
        order: 30,
        pages: [],
      },
    ];

    const buckets = new Map<DebugSectionId, DebugSection>(
      baseSections.map((section) => [section.id, section])
    );

    for (const page of pages) {
      const section = buckets.get(resolveDebugSectionId(page));
      if (section) section.pages.push(page);
    }

    const sorted = baseSections.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });

    for (const section of sorted) {
      section.pages.sort(sortPages);
    }

    return sorted;
  }, [pages, t]);

  useEffect(() => {
    if (pages.length === 0) {
      if (activePageId !== null) setActivePageId(null);
      if (activeSectionId !== null) setActiveSectionId(null);
      return;
    }

    const requestedTabFromNavigation =
      currentPage.type === 'debug' && currentPage.params && typeof currentPage.params === 'object'
        ? (currentPage.params as { tab?: string }).tab
        : currentPage.type === 'debug'
          ? undefined
          : readDebugTabFromHash();
    const requestedTab =
      typeof requestedTabFromNavigation === 'string' ? requestedTabFromNavigation : undefined;
    const requestedPage =
      typeof requestedTab === 'string'
        ? pages.find((page) => page.id === requestedTab) ?? null
        : null;
    if (requestedPage) {
      if (requestedPage.id !== activePageId) setActivePageId(requestedPage.id);
      const nextSectionId = resolveDebugSectionId(requestedPage);
      if (nextSectionId !== activeSectionId) setActiveSectionId(nextSectionId);
      return;
    }

    let nextSection: DebugSection | null = null;
    if (activeSectionId) {
      nextSection = sections.find((section) => section.id === activeSectionId) ?? null;
    }
    if (!nextSection) {
      nextSection = sections.find((section) => section.pages.length > 0) ?? sections[0] ?? null;
    }

    const nextSectionId = nextSection?.id ?? null;
    const sectionPages = nextSection?.pages ?? [];
    const activeValid = activePageId && pages.some((page) => page.id === activePageId);
    const shouldHoldSectionLanding = nextSectionId === 'native' && activePageId === null;
    if (!activeValid) {
      const nextId = shouldHoldSectionLanding ? null : sectionPages[0]?.id ?? pages[0].id;
      if (nextId !== activePageId) setActivePageId(nextId);
    } else if (
      activePageId &&
      sectionPages.length > 0 &&
      !sectionPages.some((page) => page.id === activePageId)
    ) {
      const nextId = sectionPages[0]?.id ?? pages[0].id;
      if (nextId !== activePageId) setActivePageId(nextId);
    }
    if (nextSectionId !== activeSectionId) setActiveSectionId(nextSectionId);
  }, [activePageId, activeSectionId, currentPage, pages, sections]);

  const activePage = useMemo(() => {
    if (!activePageId) return null;
    return pages.find((page) => page.id === activePageId) ?? null;
  }, [activePageId, pages]);

  const activeSection = useMemo(() => {
    if (!activeSectionId) return null;
    return sections.find((section) => section.id === activeSectionId) ?? null;
  }, [activeSectionId, sections]);

  const activeSectionLabel = activeSection
    ? getDebugSectionLabel(activeSection)
    : t('pages.debug.title');
  const visiblePages = useMemo(() => {
    return activeSection?.pages ?? [];
  }, [activeSection]);
  const shouldShowSectionSubbar = visiblePages.length > 1;
  const shouldShowContentHeader =
    activePage !== null && !DEBUG_PAGES_WITH_OWN_HEADER.has(activePage.id);

  return (
    <div className="page-settings page-settings--deltaforce page-settings--debug">
      {pages.length === 0 ? (
        <div className="settings-card-note">{t('pages.debug.empty')}</div>
      ) : (
        <div className="settings-shell">
          <header className="settings-topbar">
            <div className="settings-topbar-left">
              {sections.length > 1 ? (
                <div className="settings-main-tabs" role="tablist" aria-label={t('pages.debug.title')}>
                  {sections.map((section, index) => {
                    const isActive = section.id === activeSectionId;
                    const sectionLabel = getDebugSectionLabel(section);
                    return (
                      <PmpChoiceButton
                        key={section.id}
                        type="button"
                        role="tab"
                        surfaceId="page.debug.main-tab"
                        className="settings-main-tab"
                        active={isActive}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        data-has-separator={index < sections.length - 1}
                        onClick={() => {
                          setActiveSectionId(section.id);
                          const pageInSection =
                            section.pages.find((page) => page.id === activePageId)?.id ??
                            section.pages[0]?.id ??
                            null;
                          if (pageInSection) {
                            openDebugTab(pageInSection);
                          }
                          setActivePageId(pageInSection);
                        }}
                      >
                        <span className="settings-main-tab-top">
                          <span className="settings-main-tab-ring-slot" aria-hidden="true">
                            <span className="settings-main-tab-spin" aria-hidden="true" />
                          </span>
                          <span className="settings-main-tab-label">{sectionLabel}</span>
                        </span>
                        <span className="settings-main-tab-active-corner-fx" aria-hidden="true" />
                        <span className="settings-main-tab-corner" aria-hidden="true" />
                      </PmpChoiceButton>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-topbar-title">
                  <div className="settings-title">{t('pages.debug.title')}</div>
                  <div className="settings-subtitle">{t('pages.debug.subtitle')}</div>
                </div>
              )}
            </div>

            <div className="settings-topbar-actions">
              <PmpButton
                type="button"
                className="settings-action-btn settings-action-btn--topbar"
                variant="default"
                onClick={() =>
                  void dispatchCommandOrFallback(commands, 'app:navigate-settings', () =>
                    navigateTo('settings')
                  )
                }
              >
                {t('pages.settings.title')}
              </PmpButton>
            </div>
          </header>

          <div className="settings-divider" />

          {shouldShowSectionSubbar ? (
            <>
              <nav className="settings-subbar" aria-label={t('pages.debug.title')}>
                <div
                  ref={subTabsRef}
                  className="settings-sub-tabs"
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
                  {visiblePages.map((page, index) => (
                    <PmpChoiceButton
                      key={page.id}
                      type="button"
                      role="tab"
                      surfaceId="page.debug.sub-tab"
                      className="settings-sub-tab"
                      active={page.id === activePageId}
                      aria-selected={page.id === activePageId}
                      tabIndex={page.id === activePageId ? 0 : -1}
                      data-has-separator={index < visiblePages.length - 1}
                      onClick={() => {
                        openDebugTab(page.id);
                        setActivePageId(page.id);
                        setActiveSectionId(resolveDebugSectionId(page));
                      }}
                      title={page.title}
                    >
                      <span className="settings-sub-tab-label">{page.title}</span>
                    </PmpChoiceButton>
                  ))}
                </div>
              </nav>

              <div className="settings-divider" />
            </>
          ) : null}

          <main className="settings-content">
            {activePage ? (
              <section className="settings-content-panel">
                {shouldShowContentHeader ? (
                  <div className="settings-content-header">
                    <p className="settings-content-meta">{activeSectionLabel.toUpperCase()}</p>
                    <h2 className="settings-content-title">{activePage.title}</h2>
                  </div>
                ) : null}
                <div className="settings-content-body">
                  {activePage.render({ type: activePage.id }) as React.ReactNode}
                </div>
              </section>
            ) : (
              <div className="settings-card-note">
                {t('pages.debug.emptySection', { section: activeSectionLabel })}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
