import { useCallback, useMemo } from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import './MatrixChangeMagnet.css';

function normalizeMatrixLayoutId(value: string): 'matrix1' | 'matrix2' {
  return value === 'matrix2' ? 'matrix2' : 'matrix1';
}

export function MatrixChangeMagnet() {
  const [layoutId, setLayoutId] = usePersistentSetting(STORAGE_KEYS.WORKBENCH_LAYOUT_ID, '', {
    format: 'string',
  });

  const activeMatrix = useMemo(() => normalizeMatrixLayoutId(layoutId), [layoutId]);

  const handleToggle = useCallback(() => {
    setLayoutId((prev) => (normalizeMatrixLayoutId(prev) === 'matrix2' ? 'matrix1' : 'matrix2'));
  }, [setLayoutId]);

  const nextLabel = activeMatrix === 'matrix1' ? 'M2' : 'M1';
  const currentLabel = activeMatrix === 'matrix1' ? 'M1' : 'M2';

  return (
    <button
      type="button"
      className="matrix-change-magnet"
      onClick={handleToggle}
      title={`Switch matrix layout (${STORAGE_KEYS.WORKBENCH_LAYOUT_ID}): ${currentLabel} → ${nextLabel}`}
    >
      <span className="matrix-change-magnet-badge">{currentLabel}</span>
      <span>SWAP</span>
    </button>
  );
}

