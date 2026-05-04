import { Track } from '../../../services/audio';
import { useMemo } from 'react';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const NATIVE_DEBUG_QUEUE_RENDER_HEAD_LIMIT = 48;
const NATIVE_DEBUG_QUEUE_RENDER_CONTEXT_RADIUS = 12;

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
  const visibleQueueEntries = useMemo(() => {
    const entries: Array<{ track: Track; index: number }> = [];
    const seen = new Set<number>();

    const add = (index: number) => {
      if (index < 0 || index >= queue.length || seen.has(index)) return;
      const track = queue[index];
      if (!track) return;
      seen.add(index);
      entries.push({ track, index });
    };

    for (let index = 0; index < Math.min(queue.length, NATIVE_DEBUG_QUEUE_RENDER_HEAD_LIMIT); index += 1) {
      add(index);
    }

    if (currentIndex >= NATIVE_DEBUG_QUEUE_RENDER_HEAD_LIMIT) {
      for (
        let index = currentIndex - NATIVE_DEBUG_QUEUE_RENDER_CONTEXT_RADIUS;
        index <= currentIndex + NATIVE_DEBUG_QUEUE_RENDER_CONTEXT_RADIUS;
        index += 1
      ) {
        add(index);
      }
    }

    return entries.sort((left, right) => left.index - right.index);
  }, [currentIndex, queue]);
  const omittedQueueItemCount = Math.max(0, queue.length - visibleQueueEntries.length);

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
        {visibleQueueEntries.map(({ track, index }) => (
          <li key={`${track.id}-${index}`} data-active={index === currentIndex}>
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
        {omittedQueueItemCount > 0 && (
          <li className="queue-empty">
            {t('pages.native-debug.queue.omitted', { count: omittedQueueItemCount })}
          </li>
        )}
      </ul>

      {lastError && <p className="error-banner">{t('pages.native-debug.lastError', { message: lastError })}</p>}
    </>
  );
}
