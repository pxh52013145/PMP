import { useEffect, useMemo, useState } from 'react';
import type {
  WorkbenchContribution,
  WorkbenchLayoutContribution,
  WorkbenchNavigationContribution,
  WorkbenchPageContainerContribution,
} from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import {
  resolveActiveContributionId,
  resolveActiveWorkbenchId,
  sortByOrderThenTitle,
  sortWorkbenches,
} from '../../workbenches/workbenchSelection';

export function WorkbenchSettingsPanel() {
  const kernel = useKernel();
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
            <p className="settings-card-label">Workbench</p>
            <p className="settings-card-desc">Select the main window UI Workbench (R4).</p>
          </div>
          <span className="settings-card-badge">{workbenches.length}</span>
        </div>

        {workbenches.length === 0 ? (
          <div className="settings-card-note">No workbenches registered.</div>
        ) : (
          <div className="settings-plugin-list">
            {workbenches.map((wb) => {
              const isActive = wb.id === activeWorkbenchId;
              const experimental = Boolean(
                (wb.metadata as Record<string, unknown> | undefined)?.experimental
              );
              return (
                <label key={wb.id} className="settings-plugin-item" style={{ cursor: 'pointer' }}>
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {wb.title} <span className="settings-plugin-subtitle">({wb.id})</span>
                    </div>
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">active</span>}
                      {wb.source && <span className="settings-plugin-tag">{wb.source}</span>}
                      {experimental && <span className="settings-plugin-tag">experimental</span>}
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
            <p className="settings-card-label">Workbench Layout</p>
            <p className="settings-card-desc">Workbench 子贡献点：布局（R4）。</p>
          </div>
          <span className="settings-card-badge">{layouts.length}</span>
        </div>

        {layouts.length === 0 ? (
          <div className="settings-card-note">No layouts registered.</div>
        ) : (
          <div className="settings-plugin-list">
            {layouts.map((layout) => {
              const isActive = layout.id === activeLayoutId;
              const experimental = Boolean(
                (layout.metadata as Record<string, unknown> | undefined)?.experimental
              );
              return (
                <label key={layout.id} className="settings-plugin-item" style={{ cursor: 'pointer' }}>
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {layout.title} <span className="settings-plugin-subtitle">({layout.id})</span>
                    </div>
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">active</span>}
                      {layout.source && <span className="settings-plugin-tag">{layout.source}</span>}
                      {experimental && <span className="settings-plugin-tag">experimental</span>}
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
            <p className="settings-card-label">Workbench Navigation</p>
            <p className="settings-card-desc">Workbench 子贡献点：导航（R4）。</p>
          </div>
          <span className="settings-card-badge">{navigations.length}</span>
        </div>

        {navigations.length === 0 ? (
          <div className="settings-card-note">No navigation contributions registered.</div>
        ) : (
          <div className="settings-plugin-list">
            {navigations.map((nav) => {
              const isActive = nav.id === activeNavigationId;
              const experimental = Boolean(
                (nav.metadata as Record<string, unknown> | undefined)?.experimental
              );
              return (
                <label key={nav.id} className="settings-plugin-item" style={{ cursor: 'pointer' }}>
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {nav.title} <span className="settings-plugin-subtitle">({nav.id})</span>
                    </div>
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">active</span>}
                      {nav.source && <span className="settings-plugin-tag">{nav.source}</span>}
                      {experimental && <span className="settings-plugin-tag">experimental</span>}
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
            <p className="settings-card-label">Workbench Content</p>
            <p className="settings-card-desc">Workbench 子贡献点：页面容器（R4）。</p>
          </div>
          <span className="settings-card-badge">{pageContainers.length}</span>
        </div>

        {pageContainers.length === 0 ? (
          <div className="settings-card-note">No page containers registered.</div>
        ) : (
          <div className="settings-plugin-list">
            {pageContainers.map((container) => {
              const isActive = container.id === activePageContainerId;
              const experimental = Boolean(
                (container.metadata as Record<string, unknown> | undefined)?.experimental
              );
              return (
                <label
                  key={container.id}
                  className="settings-plugin-item"
                  style={{ cursor: 'pointer' }}
                >
                  <div className="settings-plugin-meta">
                    <div className="settings-plugin-title">
                      {container.title}{' '}
                      <span className="settings-plugin-subtitle">({container.id})</span>
                    </div>
                    <div className="settings-plugin-tags">
                      {isActive && <span className="settings-plugin-tag">active</span>}
                      {container.source && <span className="settings-plugin-tag">{container.source}</span>}
                      {experimental && <span className="settings-plugin-tag">experimental</span>}
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
