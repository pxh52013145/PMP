import './SettingsPage.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PageContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { PmpButton, PmpChoiceButton } from '../primitives';

function sortPages(a: PageContribution, b: PageContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export const DebugPage: React.FC = () => {
  const kernel = useKernel();
  const { navigateTo, currentPage } = useNavigation();
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const subTabsRef = React.useRef<HTMLDivElement | null>(null);
  const lastRequestedTabRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (pages.length === 0) {
      if (activePageId !== null) setActivePageId(null);
      return;
    }
    const requestedTab =
      currentPage.type === 'debug' && currentPage.params && typeof currentPage.params === 'object'
        ? (currentPage.params as { tab?: string }).tab
        : undefined;
    const requestedValid =
      typeof requestedTab === 'string' && pages.some((page) => page.id === requestedTab);

    const requestedChanged =
      (requestedValid ? requestedTab : null) !== lastRequestedTabRef.current;

    if (requestedValid && requestedChanged) {
      lastRequestedTabRef.current = requestedTab ?? null;
      if (requestedTab !== activePageId) setActivePageId(requestedTab);
      return;
    }

    lastRequestedTabRef.current = requestedValid ? requestedTab ?? null : null;
    const activeValid = activePageId && pages.some((page) => page.id === activePageId);
    if (!activeValid) {
      const nextId = pages[0].id;
      if (nextId !== activePageId) setActivePageId(nextId);
    }
  }, [activePageId, currentPage, pages]);

  const activePage = useMemo(() => {
    if (!activePageId) return null;
    return pages.find((page) => page.id === activePageId) ?? null;
  }, [activePageId, pages]);

  return (
    <div className="page-settings page-settings--deltaforce page-settings--debug">
      {pages.length === 0 ? (
        <div className="settings-card-note">{t('pages.debug.empty')}</div>
      ) : (
        <div className="settings-shell">
          <header className="settings-topbar">
            <div className="settings-topbar-left">
              <div className="settings-topbar-title">
                <div className="settings-title">{t('pages.debug.title')}</div>
                <div className="settings-subtitle">{t('pages.debug.subtitle')}</div>
              </div>
            </div>

            <div className="settings-topbar-actions">
              <PmpButton
                type="button"
                className="settings-action-btn settings-action-btn--topbar"
                variant="default"
                onClick={() => navigateTo('settings')}
              >
                {t('pages.settings.title')}
              </PmpButton>
            </div>
          </header>

          <div className="settings-divider" />

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
              {pages.map((page, index) => (
                <PmpChoiceButton
                  key={page.id}
                  type="button"
                  role="tab"
                  surfaceId="page.debug.sub-tab"
                  className="settings-sub-tab"
                  active={page.id === activePageId}
                  aria-selected={page.id === activePageId}
                  tabIndex={page.id === activePageId ? 0 : -1}
                  data-has-separator={index < pages.length - 1}
                  onClick={() => {
                    navigateTo('debug', { tab: page.id });
                    setActivePageId(page.id);
                  }}
                  title={page.title}
                >
                  <span className="settings-sub-tab-label">{page.title}</span>
                </PmpChoiceButton>
              ))}
            </div>
          </nav>

          <div className="settings-divider" />

          <main className="settings-content">
            {activePage ? (
              <section className="settings-content-panel">
                <div className="settings-content-header">
                  <h2 className="settings-content-title">{activePage.title}</h2>
                </div>
                <div className="settings-content-body">
                  {activePage.render({ type: activePage.id }) as React.ReactNode}
                </div>
              </section>
            ) : (
              <div className="settings-card-note">{t('pages.debug.empty')}</div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
