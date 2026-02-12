import { Track } from '../../../services/audio';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type NativeDebugQueuePanelProps = {
  t: TranslateFn;
  queue: Track[];
  currentIndex: number;
  lastError: string | null;
  onClearQueue: () => void;
  onPlayAtIndex: (index: number) => void;
  onRemoveAtIndex: (index: number) => void;
};

export function NativeDebugQueuePanel({
  t,
  queue,
  currentIndex,
  lastError,
  onClearQueue,
  onPlayAtIndex,
  onRemoveAtIndex,
}: NativeDebugQueuePanelProps) {
  return (
    <>
      <div className="queue-actions native-debug-queue-header">
        <div>
          <p className="section-label">{t('pages.native-debug.queue.title')}</p>
          <h3>{t('pages.native-debug.queue.count', { count: queue.length })}</h3>
        </div>
        <button type="button" onClick={onClearQueue} disabled={!queue.length}>
          {t('common.action.clear')}
        </button>
      </div>

      <ul className="debug-queue">
        {queue.length === 0 && <li className="queue-empty">{t('pages.native-debug.queue.empty')}</li>}
        {queue.map((track, index) => (
          <li key={track.id} data-active={index === currentIndex}>
            <div>
              <p className="queue-track-title">{track.title}</p>
              <p className="queue-track-meta">{track.originalPath || track.path}</p>
            </div>
            <div className="queue-buttons">
              <button type="button" onClick={() => onPlayAtIndex(index)}>
                {t('common.action.play')}
              </button>
              <button type="button" onClick={() => onRemoveAtIndex(index)}>
                {t('common.action.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {lastError && <p className="error-banner">{t('pages.native-debug.lastError', { message: lastError })}</p>}
    </>
  );
}
