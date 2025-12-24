import { useEffect, useMemo, useState } from 'react';
import type { PageContribution } from '../../contracts/contributions';
import { useKernel } from '../../contexts/KernelContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { sortByOrderThenTitle } from '../workbenchSelection';

const PAGES_REQUIRING_PARAMS = new Set<PageContribution['id']>([
  'track',
  'album',
  'artist',
  'plugin-page',
  'plugin-visualizer',
]);

export function WorkbenchPagesNavigation() {
  const kernel = useKernel();
  const navigation = useNavigation();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    return kernel.contributions.subscribe(() => setRevision((value) => value + 1));
  }, [kernel.contributions]);

  const pages = useMemo(() => {
    void revision;
    return kernel.contributions
      .list<PageContribution>('page')
      .filter((page) => !PAGES_REQUIRING_PARAMS.has(page.id))
      .sort(sortByOrderThenTitle);
  }, [kernel.contributions, revision]);

  return (
    <div style={{ width: '100%', height: '100%', padding: 12, overflow: 'auto' }}>
      <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.78, marginBottom: 10 }}>Pages</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pages.map((page) => {
          const active = navigation.currentPage.type === page.id;
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => navigation.navigateTo(page.id)}
              style={{
                textAlign: 'left',
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                background: active ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.2)',
                color: 'rgba(255,255,255,0.92)',
                cursor: 'pointer',
              }}
              title={page.id}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{page.title}</div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{page.id}</div>
            </button>
          );
        })}

        {pages.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.7 }}>No pages registered.</div>
        ) : null}
      </div>
    </div>
  );
}

