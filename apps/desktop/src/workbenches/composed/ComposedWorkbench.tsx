import { useEffect, useMemo, useState } from 'react';
import type {
  WorkbenchLayoutContribution,
  WorkbenchNavigationContribution,
  WorkbenchPageContainerContribution,
} from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n/react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { resolveActiveContributionId, sortByOrderThenTitle } from '../workbenchSelection';

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div style={{ width: '100%', height: '100%', padding: 18, color: 'rgba(255,255,255,0.78)' }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{note}</div>
    </div>
  );
}

export function ComposedWorkbench() {
  const kernel = useKernel();
  const t = useT();
  const [revision, setRevision] = useState(0);

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

  const activeLayoutId = useMemo(
    () => resolveActiveContributionId(layouts, selectedLayoutId),
    [layouts, selectedLayoutId]
  );
  const activeNavigationId = useMemo(
    () => resolveActiveContributionId(navigations, selectedNavigationId),
    [navigations, selectedNavigationId]
  );
  const activePageContainerId = useMemo(
    () => resolveActiveContributionId(pageContainers, selectedPageContainerId),
    [pageContainers, selectedPageContainerId]
  );

  useEffect(() => {
    if (!activeLayoutId) return;
    if (activeLayoutId === selectedLayoutId) return;
    setSelectedLayoutId(activeLayoutId);
  }, [activeLayoutId, selectedLayoutId, setSelectedLayoutId]);

  useEffect(() => {
    if (!activeNavigationId) return;
    if (activeNavigationId === selectedNavigationId) return;
    setSelectedNavigationId(activeNavigationId);
  }, [activeNavigationId, selectedNavigationId, setSelectedNavigationId]);

  useEffect(() => {
    if (!activePageContainerId) return;
    if (activePageContainerId === selectedPageContainerId) return;
    setSelectedPageContainerId(activePageContainerId);
  }, [activePageContainerId, selectedPageContainerId, setSelectedPageContainerId]);

  const layout = useMemo(() => {
    if (!activeLayoutId) return null;
    return layouts.find((entry) => entry.id === activeLayoutId) ?? null;
  }, [activeLayoutId, layouts]);

  const navigation = useMemo(() => {
    if (!activeNavigationId) return null;
    return navigations.find((entry) => entry.id === activeNavigationId) ?? null;
  }, [activeNavigationId, navigations]);

  const pageContainer = useMemo(() => {
    if (!activePageContainerId) return null;
    return pageContainers.find((entry) => entry.id === activePageContainerId) ?? null;
  }, [activePageContainerId, pageContainers]);

  if (!layout) {
    return (
      <Placeholder
        title={t('workbench.composed.noLayout.title')}
        note={t('workbench.composed.noLayout.note')}
      />
    );
  }

  if (!pageContainer) {
    return (
      <Placeholder
        title={t('workbench.composed.noPageContainer.title')}
        note={t('workbench.composed.noPageContainer.note')}
      />
    );
  }

  const navigationNode = navigation ? (navigation.render() as React.ReactNode) : null;
  const contentNode = pageContainer.render() as React.ReactNode;

  return layout.render({ navigation: navigationNode, content: contentNode }) as React.ReactNode;
}
