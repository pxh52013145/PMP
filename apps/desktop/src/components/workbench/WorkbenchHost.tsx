import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchContribution } from '../../contracts/contributions';
import type { ContributionListener } from '../../kernel';
import { useKernel } from '../../contexts/KernelContext';
import { useT } from '../../i18n/react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { resolveActiveWorkbenchId, sortWorkbenches } from '../../workbenches/workbenchSelection';

export function WorkbenchHost() {
  const kernel = useKernel();
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = usePersistentSetting(STORAGE_KEYS.WORKBENCH_ID, '', {
    format: 'string',
  });

  useEffect(() => {
    const listener: ContributionListener = () => setRevision((v) => v + 1);
    return kernel.contributions.subscribe(listener);
  }, [kernel.contributions]);

  const workbenches = useMemo(() => {
    void revision;
    return kernel.contributions.list<WorkbenchContribution>('workbench').sort(sortWorkbenches);
  }, [kernel.contributions, revision]);

  const activeWorkbenchId = useMemo(() => {
    return resolveActiveWorkbenchId(workbenches, selectedId);
  }, [selectedId, workbenches]);

  useEffect(() => {
    if (!activeWorkbenchId) return;
    if (activeWorkbenchId === selectedId) return;
    setSelectedId(activeWorkbenchId);
  }, [activeWorkbenchId, selectedId, setSelectedId]);

  const activeWorkbench = useMemo(() => {
    if (!activeWorkbenchId) return null;
    return workbenches.find((wb) => wb.id === activeWorkbenchId) ?? null;
  }, [activeWorkbenchId, workbenches]);

  if (!activeWorkbench) {
    return (
      <div style={{ width: '100%', height: '100%', padding: 18, color: 'rgba(255,255,255,0.78)' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{t('workbench.host.noWorkbench.title')}</div>
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          {t('workbench.host.noWorkbench.note')}
        </div>
      </div>
    );
  }

  return activeWorkbench.render() as React.ReactNode;
}
