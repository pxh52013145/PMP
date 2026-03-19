import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import type { PageContribution } from '../../../contracts/contributions';
import {
  MUSIC_LIBRARY_SOURCE_CHANGE_EVENT,
  MUSIC_LIBRARY_STATS_CHANGE_EVENT,
  type MusicLibraryStatsChangeDetail,
  type MusicLibrarySourceMode,
} from '../../../contracts/musicLibrarySource';
import { useKernel } from '../../../contexts/KernelContext';
import { useT } from '../../../i18n';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import { NavigationPageVariantProps } from './NavigationPageTypes';
import { parseNavigationPageSkinProps } from './navigationPageSkin';
import './NavigationPage.css';

export const StandardNavigationPage: React.FC<NavigationPageVariantProps> = ({
  data,
  variantConfig,
}) => {
  const { currentPage } = data;
  const kernel = useKernel();
  const t = useT();
  const telemetry = useMemo(() => getTelemetryLogger('navigation', 'StandardNavigationPage'), []);
  const skinProps = useMemo(() => parseNavigationPageSkinProps(variantConfig), [variantConfig]);
  const [registryRevision, setRegistryRevision] = useState(0);
  const [showSourcePopup, setShowSourcePopup] = useState(false);
  const [librarySourceMode, setLibrarySourceMode] = useState<MusicLibrarySourceMode>('local');
  const [musicLibraryStats, setMusicLibraryStats] = useState<MusicLibraryStatsChangeDetail | null>(null);
  const sourceSwitcherRef = useRef<HTMLDivElement | null>(null);
  const sourcePopupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRegistryRevision((value) => value + 1));
  }, [kernel.contributions]);

  const contribution = useMemo(() => {
    void registryRevision;
    return kernel.contributions.get<PageContribution>('page', currentPage.type);
  }, [currentPage.type, kernel.contributions, registryRevision]);

  const content = contribution ? (contribution.render(currentPage) as React.ReactNode) : null;
  const title = contribution?.title ?? currentPage.type;
  const isMusicLibraryPage = currentPage.type === 'music-library';

  useEffect(() => {
    if (isMusicLibraryPage) return;
    setShowSourcePopup(false);
    setMusicLibraryStats(null);
  }, [isMusicLibraryPage]);

  useEffect(() => {
    if (skinProps.sourceSwitcherMode !== 'popup') {
      setShowSourcePopup(false);
    }
  }, [skinProps.sourceSwitcherMode]);

  useEffect(() => {
    if (!isMusicLibraryPage || skinProps.sourceSwitcherMode !== 'popup') return;
    telemetry.info(showSourcePopup ? 'navigation.library-source.popup.opened' : 'navigation.library-source.popup.closed', {
      fields: {
        page: currentPage.type,
        sourceMode: librarySourceMode,
      },
    });
  }, [currentPage.type, isMusicLibraryPage, librarySourceMode, showSourcePopup, skinProps.sourceSwitcherMode, telemetry]);

  useEffect(() => {
    const onStatsChange = (event: Event) => {
      const customEvent = event as CustomEvent<MusicLibraryStatsChangeDetail>;
      const detail = customEvent.detail;
      if (!detail || !Array.isArray(detail.items)) return;
      setMusicLibraryStats(detail);
    };

    window.addEventListener(MUSIC_LIBRARY_STATS_CHANGE_EVENT, onStatsChange as EventListener);
    return () => {
      window.removeEventListener(MUSIC_LIBRARY_STATS_CHANGE_EVENT, onStatsChange as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!showSourcePopup) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (sourceSwitcherRef.current?.contains(target)) return;
      if (sourcePopupRef.current?.contains(target)) return;
      setShowSourcePopup(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowSourcePopup(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showSourcePopup]);

  const handleToggleSourcePopup = useCallback(() => {
    if (!isMusicLibraryPage || skinProps.sourceSwitcherMode !== 'popup') return;
    setShowSourcePopup((prev) => !prev);
  }, [isMusicLibraryPage, skinProps.sourceSwitcherMode]);

  const handleSelectLibrarySource = useCallback((mode: MusicLibrarySourceMode) => {
    setLibrarySourceMode(mode);
    setShowSourcePopup(false);
    telemetry.info('navigation.library-source.selected', {
      fields: {
        page: currentPage.type,
        mode,
      },
    });
    window.dispatchEvent(
      new CustomEvent(MUSIC_LIBRARY_SOURCE_CHANGE_EVENT, {
        detail: { mode },
      })
    );
  }, [currentPage.type, telemetry]);

  return (
    <div className="navigation-page">
      <div className="navigation-content">
        {content ?? (
          <Placeholder
            icon="?"
            text={t('pages.navigation.unknownPage', { type: String(currentPage.type) })}
            cssClass="page-unknown"
            mode={skinProps.placeholderMode}
          />
        )}
      </div>

      <div className={`navigation-footer ${isMusicLibraryPage ? 'navigation-footer-music-library' : ''}`}>
        {isMusicLibraryPage ? (
          <div className="navigation-footer-music-library-row">
            {skinProps.sourceSwitcherMode === 'inline' ? (
              <div className="page-info-inline-group" role="group" aria-label={title}>
                <button
                  className={`page-info-inline-option ${librarySourceMode === 'local' ? 'active' : ''}`}
                  onClick={() => handleSelectLibrarySource('local')}
                >
                  {t('pages.music-library.source.local')}
                </button>
                <button
                  className={`page-info-inline-option ${librarySourceMode === 'stable' ? 'active' : ''}`}
                  onClick={() => handleSelectLibrarySource('stable')}
                >
                  {t('pages.music-library.source.stable')}
                </button>
              </div>
            ) : (
              <div className="page-info-switcher" ref={sourceSwitcherRef}>
                <button className="page-info page-info-button" onClick={handleToggleSourcePopup}>
                  {title}
                </button>
                <CollisionAwarePopup
                  ref={sourcePopupRef}
                  open={showSourcePopup}
                  anchorRef={sourceSwitcherRef}
                  placement="top-start"
                  className="page-info-popup"
                  role="dialog"
                >
                  <button
                    className={`page-info-popup-option ${librarySourceMode === 'local' ? 'active' : ''}`}
                    onClick={() => handleSelectLibrarySource('local')}
                  >
                    {t('pages.music-library.source.local')}
                  </button>
                  <button
                    className={`page-info-popup-option ${librarySourceMode === 'stable' ? 'active' : ''}`}
                    onClick={() => handleSelectLibrarySource('stable')}
                  >
                    {t('pages.music-library.source.stable')}
                  </button>
                </CollisionAwarePopup>
              </div>
            )}
            {skinProps.showLibraryStats ? (
              <div className="navigation-footer-music-library-stats">
                {(musicLibraryStats?.items || []).map((item, index) => (
                  <div
                    className="navigation-footer-music-library-stat"
                    key={`${item.value}-${item.unit ?? 'none'}-${index}`}
                  >
                    <strong>{item.value}</strong>
                    {item.unit ? <span>{item.unit}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="page-info">{title}</div>
        )}
      </div>
    </div>
  );
};

function Placeholder({
  icon,
  text,
  cssClass,
  mode,
}: {
  icon: string;
  text: string;
  cssClass?: string;
  mode: 'icon' | 'minimal';
}) {
  return (
    <div className={`page-placeholder ${cssClass || ''} ${mode === 'minimal' ? 'page-placeholder-minimal' : ''}`}>
      {mode === 'icon' ? <div className="placeholder-icon">{icon}</div> : null}
      <div className="placeholder-text">{text}</div>
    </div>
  );
}
