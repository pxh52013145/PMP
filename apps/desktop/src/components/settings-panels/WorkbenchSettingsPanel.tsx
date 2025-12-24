import { useEffect, useMemo, useState } from 'react';
import type { WorkbenchContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { resolveActiveWorkbenchId, sortWorkbenches } from '../../workbenches/workbenchSelection';

export function WorkbenchSettingsPanel() {
  const kernel = useKernel();
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = usePersistentSetting(STORAGE_KEYS.WORKBENCH_ID, '', {
    format: 'string',
  });

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const workbenches = useMemo(() => {
    void revision;
    return kernel.contributions.list<WorkbenchContribution>('workbench').sort(sortWorkbenches);
  }, [kernel.contributions, revision]);

  const activeWorkbenchId = useMemo(() => {
    return resolveActiveWorkbenchId(workbenches, selectedId);
  }, [selectedId, workbenches]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">Workbench</p>
          <p className="settings-card-desc">选择主窗口的 UI Workbench（R4）。</p>
        </div>
        <span className="settings-card-badge">{workbenches.length}</span>
      </div>

      {workbenches.length === 0 ? (
        <div className="settings-card-note">No workbenches registered.</div>
      ) : (
        <div className="settings-plugin-list">
          {workbenches.map((wb) => {
            const isActive = wb.id === activeWorkbenchId;
            const experimental = Boolean((wb.metadata as Record<string, unknown> | undefined)?.experimental);
            return (
              <label key={wb.id} className="settings-plugin-item" style={{ cursor: 'pointer' }}>
                <div className="settings-plugin-meta">
                  <div className="settings-plugin-title">
                    {wb.title}{' '}
                    <span className="settings-plugin-subtitle">
                      ({wb.id})
                    </span>
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
                    onChange={() => setSelectedId(wb.id)}
                  />
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

