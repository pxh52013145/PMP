import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../../i18n';
import { PlayQueueVariantProps } from './PlayQueueTypes';
import { parsePlayQueueSkinProps } from './playQueueSkin';
import './StandardPlayQueue.css';

const QueueIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="play-queue-icon" aria-hidden="true">
    <path d="M4 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 6a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Z" />
  </svg>
);

const NoteIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="queue-empty-icon" aria-hidden="true">
    <path d="M17 4a1 1 0 0 1 1 1v9.5a3.5 3.5 0 1 1-2-3.15V8.3l-5 1.25v7.95a3.5 3.5 0 1 1-2-3.15V8.8a1 1 0 0 1 .76-.97l7-1.75A1 1 0 0 1 17 4Z" />
  </svg>
);

export const StandardPlayQueue: React.FC<PlayQueueVariantProps> = ({ data, logic, skinProps: rawSkinProps }) => {
  const { queue, currentIndex, queueLength } = data;
  const {
    showQueue,
    editMode,
    dragState,
    toggleQueue,
    closeQueue,
    toggleEditMode,
    playTrack,
    removeTrack,
    clearQueue,
    addFiles,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    formatTime,
  } = logic;
  const skinProps = useMemo(() => parsePlayQueueSkinProps(rawSkinProps), [rawSkinProps]);
  const t = useT();

  const listRef = React.useRef<HTMLDivElement | null>(null);
  const activeItemRef = React.useRef<HTMLDivElement | null>(null);
  const didAutoScrollRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (!skinProps.autoScrollToActive) return;
    if (!showQueue) {
      didAutoScrollRef.current = false;
      return;
    }

    if (didAutoScrollRef.current) return;

    const list = listRef.current;
    if (!list) return;
    if (queueLength === 0) return;

    if (currentIndex < 0) {
      list.scrollTop = 0;
      return;
    }

    if (currentIndex === 0) {
      list.scrollTop = 0;
      didAutoScrollRef.current = true;
      return;
    }

    const active = activeItemRef.current;
    if (!active) return;

    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const activeTop = activeRect.top - listRect.top + list.scrollTop;
    const desiredOffset = active.offsetHeight;
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.min(Math.max(0, activeTop - desiredOffset), maxScrollTop);
    didAutoScrollRef.current = true;
  }, [currentIndex, queueLength, showQueue, skinProps.autoScrollToActive]);

  const showHeaderActions = skinProps.showEditAction || skinProps.showAddAction || skinProps.showClearAction;

  const modal = showQueue
    ? createPortal(
        <div className="queue-modal-overlay" onClick={closeQueue}>
          <div className="queue-modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="queue-modal-header">
              <span className="queue-modal-title">
                {t('magnet.renderers.btn-play-queue.preview')} ({queueLength})
              </span>
              {showHeaderActions ? (
                <div className="queue-header-actions">
                  {skinProps.showEditAction ? (
                    <button
                      className={`queue-header-btn ${editMode ? 'queue-header-btn-active' : ''}`}
                      onClick={toggleEditMode}
                      title={editMode ? 'Done editing' : 'Edit order'}
                    >
                      {editMode ? 'Done' : 'Edit'}
                    </button>
                  ) : null}
                  {skinProps.showAddAction ? (
                    <button className="queue-header-btn" onClick={() => void addFiles()} title="Add audio files">
                      +
                    </button>
                  ) : null}
                  {skinProps.showClearAction ? (
                    <button
                      className="queue-header-btn"
                      onClick={clearQueue}
                      disabled={queueLength === 0}
                      title={t('common.action.clear')}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="queue-list" ref={listRef}>
              {queueLength === 0 ? (
                <div className="queue-empty">
                  <NoteIcon />
                  <div className="queue-empty-text">Queue is empty</div>
                  {skinProps.showAddAction ? (
                    <button className="queue-empty-btn" onClick={() => void addFiles()}>
                      Add audio files
                    </button>
                  ) : null}
                </div>
              ) : (
                queue.map((track, index) => (
                  <div
                    key={track.id}
                    ref={index === currentIndex ? activeItemRef : undefined}
                    className={`queue-item ${index === currentIndex ? 'queue-item-active' : ''} ${
                      editMode ? 'queue-item-edit-mode' : ''
                    } ${dragState.dragIndex === index ? 'queue-item-dragging' : ''} ${
                      dragState.dragOverIndex === index ? 'queue-item-drag-over' : ''
                    }`}
                    draggable={editMode}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      handleDragStart(index);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      handleDragOver(index);
                    }}
                    onDragLeave={handleDragLeave}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(index);
                    }}
                    onDragEnd={handleDragEnd}
                    onDoubleClick={() => !editMode && playTrack(index)}
                  >
                    <div className="queue-item-index">{String(index + 1).padStart(2, '0')}</div>
                    <div className="queue-item-info">
                      <div className="queue-item-title" title={track.title}>
                        {track.title}
                      </div>
                      <div className="queue-item-artist" title={track.artist || t('common.unknown.artist')}>
                        {track.artist || t('common.unknown.artist')}
                      </div>
                    </div>
                    <div className="queue-item-duration">{track.duration ? formatTime(track.duration) : '-'}</div>
                    <div className={`queue-item-actions ${editMode ? 'queue-item-actions-hidden' : ''}`}>
                      <button
                        className="queue-item-action-btn queue-item-play"
                        onClick={(event) => {
                          event.stopPropagation();
                          playTrack(index);
                        }}
                        title={t('common.action.play')}
                        disabled={editMode}
                      >
                        Play
                      </button>
                      <button
                        className="queue-item-action-btn queue-item-remove"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeTrack(index);
                        }}
                        title={t('common.action.remove')}
                        disabled={editMode}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        className="magnet-control-button play-queue-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleQueue();
        }}
        title={t('magnet.renderers.btn-play-queue.preview')}
      >
        <QueueIcon />
        {skinProps.showCountBadge && queueLength > 0 ? <span className="play-queue-count">{queueLength}</span> : null}
      </button>
      {modal}
    </>
  );
};

