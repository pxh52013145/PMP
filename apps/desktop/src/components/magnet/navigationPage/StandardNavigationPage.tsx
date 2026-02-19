import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollisionAwarePopup } from '../../core/CollisionAwarePopup';
import type { PageContribution } from '../../../contracts/contributions';
import {
  MUSIC_LIBRARY_SOURCE_CHANGE_EVENT,
  type MusicLibrarySourceMode,
} from '../../../contracts/musicLibrarySource';
import { useKernel } from '../../../contexts/KernelContext';
import { useT } from '../../../i18n';
import { NavigationPageVariantProps } from './NavigationPageTypes';
import './NavigationPage.css';

export const StandardNavigationPage: React.FC<NavigationPageVariantProps> = ({ data }) => {
  const { currentPage } = data;
  const kernel = useKernel();
  const t = useT();
  const [registryRevision, setRegistryRevision] = useState(0);
  const [showSourcePopup, setShowSourcePopup] = useState(false);
  const [librarySourceMode, setLibrarySourceMode] = useState<MusicLibrarySourceMode>('local');
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
  }, [isMusicLibraryPage]);

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
    if (!isMusicLibraryPage) return;
    setShowSourcePopup((prev) => !prev);
  }, [isMusicLibraryPage]);

  const handleSelectLibrarySource = useCallback((mode: MusicLibrarySourceMode) => {
    setLibrarySourceMode(mode);
    setShowSourcePopup(false);
    window.dispatchEvent(
      new CustomEvent(MUSIC_LIBRARY_SOURCE_CHANGE_EVENT, {
        detail: { mode },
      })
    );
  }, []);

  return (
    <div className="navigation-page">
      <div className="navigation-content">
        {content ?? (
          <Placeholder
            icon="?"
            text={t('pages.navigation.unknownPage', { type: String(currentPage.type) })}
            cssClass="page-unknown"
          />
        )}
      </div>

      <div className={`navigation-footer ${isMusicLibraryPage ? 'navigation-footer-music-library' : ''}`}>
        {isMusicLibraryPage ? (
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
}: {
  icon: string;
  text: string;
  cssClass?: string;
}) {
  return (
    <div className={`page-placeholder ${cssClass || ''}`}>
      <div className="placeholder-icon">{icon}</div>
      <div className="placeholder-text">{text}</div>
    </div>
  );
}
