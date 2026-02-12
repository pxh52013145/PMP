import { useEffect, useMemo, useState } from 'react';
import type {
  WorkbenchContribution,
  WorkbenchLayoutContribution,
  WorkbenchNavigationContribution,
  WorkbenchPageContainerContribution,
} from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n/react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  resolveActiveContributionId,
  resolveActiveWorkbenchId,
  sortByOrderThenTitle,
  sortWorkbenches,
} from '../../workbenches/workbenchSelection';

type TFunction = (key: string, params?: Record<string, unknown>) => string;

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatSourceLabel(source: string, t: TFunction): string {
  if (source === 'builtin') return t('common.source.builtin');
  if (source === 'plugin') return t('common.source.plugin');
  if (source === 'runtime') return t('common.source.runtime');
  return source;
}

export function WorkbenchSettingsPanel() {
  const kernel = useKernel();
  const t = useT();
  const [revision, setRevision] = useState(0);

  const [selectedWorkbenchId, setSelectedWorkbenchId] = usePersistentSetting(
    STORAGE_KEYS.WORKBENCH_ID,
    '',
    { format: 'string' }
  );
  const [selectedLayoutId, setSelectedLayoutId] = usePersistentSetting(
    STORAGE_KEYS.WORKBENCH_LAYOUT_ID,
    '',
    { format: 'string' }
  );
  const [selectedNavigationId, setSelectedNavigationId] = usePersistentSetting(
    STORAGE_KEYS.WORKBENCH_NAVIGATION_ID,
    '',
    { format: 'string' }
  );
  const [selectedPageContainerId, setSelectedPageContainerId] = usePersistentSetting(
    STORAGE_KEYS.WORKBENCH_PAGE_CONTAINER_ID,
    '',
    { format: 'string' }
  );

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((value) => value + 1));
  }, [kernel.contributions]);

  const workbenches = useMemo(() => {
    void revision;
    return kernel.contributions.list<WorkbenchContribution>('workbench').sort(sortWorkbenches);
  }, [kernel.contributions, revision]);

  const layouts = useMemo(() => {
    void revision;
    return kernel.contributions
      .list<WorkbenchLayoutContribution>('workbench-layout')
      .sort(sortByOrderThenTitle);
  }, [kernel.contributions, revision]);

  const navigations = useMemo(() => {
    void revision;
    return kernel.contributions
      .list<WorkbenchNavigationContribution>('workbench-navigation')
      .sort(sortByOrderThenTitle);
  }, [kernel.contributions, revision]);

  const pageContainers = useMemo(() => {
    void revision;
    return kernel.contributions
      .list<WorkbenchPageContainerContribution>('workbench-page-container')
      .sort(sortByOrderThenTitle);
  }, [kernel.contributions, revision]);

  const activeWorkbenchId = useMemo(() => {
    return resolveActiveWorkbenchId(workbenches, selectedWorkbenchId);
  }, [selectedWorkbenchId, workbenches]);

  const activeLayoutId = useMemo(() => {
    return resolveActiveContributionId(layouts, selectedLayoutId);
  }, [layouts, selectedLayoutId]);

  const activeNavigationId = useMemo(() => {
    return resolveActiveContributionId(navigations, selectedNavigationId);
  }, [navigations, selectedNavigationId]);

  const activePageContainerId = useMemo(() => {
    return resolveActiveContributionId(pageContainers, selectedPageContainerId);
  }, [pageContainers, selectedPageContainerId]);

  return (
    <>
      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.workbench.workbench.label')}</p>
            <p className="settings-card-desc">{t('settings.workbench.workbench.desc')}</p>
          </div>
          <span className="settings-card-badge">{workbenches.length}</span>
        </div>

        {workbenches.length === 0 ? (
          <div className="settings-card-note">{t('settings.workbench.workbench.empty')}</div>
        ) : (
          <div className="settings-plugin-list">
            {workbenches.map((wb) => {
              const isActive = wb.id === activeWorkbenchId;
              const metadata = wb.metadata as Record<string, unknown> | undefined;
              const experimental = Boolean(metadata?.experimental);
              const description = readMetadataString(metadata, 'description');
              return (
                <label key={wb.id} className="settings-plugin-item">
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {wb.title} <span className="settings-plugin-subtitle">({wb.id})</span>
                    </div>
                    {description ? <div className="settings-plugin-desc">{description}</div> : null}
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">{t('common.tag.current')}</span>}
                      {wb.source && (
                        <span className="settings-plugin-tag">
                          {formatSourceLabel(wb.source, t)}
                        </span>
                      )}
                      {experimental && (
                        <span className="settings-plugin-tag">{t('common.tag.experimental')}</span>
                      )}
                    </div>
                  </div>

                  <div className="settings-plugin-actions">
                    <input
                      type="radio"
                      name="workbench"
                      checked={isActive}
                      onChange={() => setSelectedWorkbenchId(wb.id)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.workbench.layout.label')}</p>
            <p className="settings-card-desc">{t('settings.workbench.layout.desc')}</p>
          </div>
          <span className="settings-card-badge">{layouts.length}</span>
        </div>

        {layouts.length === 0 ? (
          <div className="settings-card-note">{t('settings.workbench.layout.empty')}</div>
        ) : (
          <div className="settings-plugin-list">
            {layouts.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              const metadata = layout.metadata as Record<string, unknown> | undefined;
              const experimental = Boolean(metadata?.experimental);
              const description = readMetadataString(metadata, 'description');
              return (
                <label key={layout.id} className="settings-plugin-item">
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {layout.title} <span className="settings-plugin-subtitle">({layout.id})</span>
                    </div>
                    {description ? <div className="settings-plugin-desc">{description}</div> : null}
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">{t('common.tag.current')}</span>}
                      {layout.source && (
                        <span className="settings-plugin-tag">
                          {formatSourceLabel(layout.source, t)}
                        </span>
                      )}
                      {experimental && (
                        <span className="settings-plugin-tag">{t('common.tag.experimental')}</span>
                      )}
                    </div>
                  </div>

                  <div className="settings-plugin-actions">
                    <input
                      type="radio"
                      name="workbench-layout"
                      checked={isActive}
                      onChange={() => setSelectedLayoutId(layout.id)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.workbench.navigation.label')}</p>
            <p className="settings-card-desc">{t('settings.workbench.navigation.desc')}</p>
          </div>
          <span className="settings-card-badge">{navigations.length}</span>
        </div>

        {navigations.length === 0 ? (
          <div className="settings-card-note">{t('settings.workbench.navigation.empty')}</div>
        ) : (
          <div className="settings-plugin-list">
            {navigations.map((nav) => {
              const isActive = nav.id === activeNavigationId;
              const metadata = nav.metadata as Record<string, unknown> | undefined;
              const experimental = Boolean(metadata?.experimental);
              const description = readMetadataString(metadata, 'description');
              return (
                <label key={nav.id} className="settings-plugin-item">
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {nav.title} <span className="settings-plugin-subtitle">({nav.id})</span>
                    </div>
                    {description ? <div className="settings-plugin-desc">{description}</div> : null}
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">{t('common.tag.current')}</span>}
                      {nav.source && (
                        <span className="settings-plugin-tag">
                          {formatSourceLabel(nav.source, t)}
                        </span>
                      )}
                      {experimental && (
                        <span className="settings-plugin-tag">{t('common.tag.experimental')}</span>
                      )}
                    </div>
                  </div>

                  <div className="settings-plugin-actions">
                    <input
                      type="radio"
                      name="workbench-navigation"
                      checked={isActive}
                      onChange={() => setSelectedNavigationId(nav.id)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.workbench.content.label')}</p>
            <p className="settings-card-desc">{t('settings.workbench.content.desc')}</p>
          </div>
          <span className="settings-card-badge">{pageContainers.length}</span>
        </div>

        {pageContainers.length === 0 ? (
          <div className="settings-card-note">{t('settings.workbench.content.empty')}</div>
        ) : (
          <div className="settings-plugin-list">
            {pageContainers.map((container) => {
              const isActive = container.id === activePageContainerId;
              const metadata = container.metadata as Record<string, unknown> | undefined;
              const experimental = Boolean(metadata?.experimental);
              const description = readMetadataString(metadata, 'description');
              return (
                <label key={container.id} className="settings-plugin-item">
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {container.title}{' '}
                      <span className="settings-plugin-subtitle">({container.id})</span>
                    </div>
                    {description ? <div className="settings-plugin-desc">{description}</div> : null}
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">{t('common.tag.current')}</span>}
                      {container.source && (
                        <span className="settings-plugin-tag">
                          {formatSourceLabel(container.source, t)}
                        </span>
                      )}
                      {experimental && (
                        <span className="settings-plugin-tag">{t('common.tag.experimental')}</span>
                      )}
                    </div>
                  </div>

                  <div className="settings-plugin-actions">
                    <input
                      type="radio"
                      name="workbench-page-container"
                      checked={isActive}
                      onChange={() => setSelectedPageContainerId(container.id)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
