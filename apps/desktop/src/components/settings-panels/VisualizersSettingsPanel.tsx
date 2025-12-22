import { useEffect, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import type { VisualizerContribution } from '../../contracts/contributions';

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function sortVisualizers(a: VisualizerContribution, b: VisualizerContribution): number {
  const orderA = typeof a.order === 'number' ? a.order : Number.POSITIVE_INFINITY;
  const orderB = typeof b.order === 'number' ? b.order : Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA - orderB;
  return a.title.localeCompare(b.title);
}

export function VisualizersSettingsPanel() {
  const kernel = useKernel();
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((v) => v + 1));
  }, [kernel.contributions]);

  const visualizers = useMemo(() => {
    void revision;
    const all = kernel.contributions.list<VisualizerContribution>('visualizer').sort(sortVisualizers);
    const q = normalizeText(query);
    if (!q) return all;
    return all.filter((item) => {
      const haystack = `${item.id} ${item.title} ${item.description ?? ''} ${(item.inputs ?? []).join(' ')}`;
      return normalizeText(haystack).includes(q);
    });
  }, [kernel.contributions, query, revision]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">可视化</p>
          <p className="settings-card-desc">来自内置与插件的 Visualizer 入口。</p>
        </div>
        <span className="settings-card-badge">{visualizers.length}</span>
      </div>

      <div className="settings-visualizer-search">
        <input
          value={query}
          placeholder="Search visualizers…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {visualizers.length === 0 ? (
        <div className="settings-card-note">暂无可视化入口</div>
      ) : (
        <div className="settings-visualizer-list">
          {visualizers.map((item) => (
            <div key={item.id} className="settings-visualizer-item">
              <div className="settings-visualizer-meta">
                <div className="settings-visualizer-title">{item.title}</div>
                <div className="settings-visualizer-id">{item.id}</div>
                {item.inputs && item.inputs.length > 0 && (
                  <div className="settings-visualizer-inputs">inputs: {item.inputs.join(', ')}</div>
                )}
              </div>

              <button
                type="button"
                className="settings-action-btn"
                onClick={() => void item.open()}
                title={item.id}
              >
                打开
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
