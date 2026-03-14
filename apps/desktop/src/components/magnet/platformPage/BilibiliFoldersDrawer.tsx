import type { BilibiliFavoriteFolderItem } from '../../../modules/music-platform';
import { PmpButton, PmpDrawer } from '../../primitives';

type Translator = (key: string, params?: Record<string, string | number>) => string;

type BilibiliFoldersDrawerProps = {
  open: boolean;
  bilibiliAuthorized: boolean;
  folderLoading: boolean;
  folderError: string | null;
  folders: BilibiliFavoriteFolderItem[];
  selectedFolderId: string | null;
  onRefresh: () => void;
  onClose: () => void;
  onShowRecommended: () => void;
  onSelectFolder: (folderId: string) => void;
  t: Translator;
};

export function BilibiliFoldersDrawer(props: BilibiliFoldersDrawerProps) {
  const {
    open,
    bilibiliAuthorized,
    folderLoading,
    folderError,
    folders,
    selectedFolderId,
    onRefresh,
    onClose,
    onShowRecommended,
    onSelectFolder,
    t,
  } = props;

  return (
    <PmpDrawer
      as="section"
      open={open}
      className={`platform-magnet-panel platform-magnet-bilibili-folders ${
        open ? 'platform-magnet-bilibili-drawer-open' : ''
      }`}
      surfaceId="overlay.drawer"
    >
      <div className="platform-magnet-panel-header">
        <h4>{t('magnet.platform.bilibili.folder.title')}</h4>
        <div className="platform-magnet-bilibili-panel-actions">
          <PmpButton
            type="button"
            className="platform-magnet-mini-btn"
            variant="default"
            disabled={!bilibiliAuthorized || folderLoading}
            onClick={onRefresh}
          >
            {folderLoading
              ? t('magnet.platform.bilibili.folder.actionRefreshing')
              : t('magnet.platform.bilibili.folder.actionRefresh')}
          </PmpButton>
          <PmpButton type="button" className="platform-magnet-mini-btn" variant="ghost" onClick={onClose}>
            {t('common.action.done')}
          </PmpButton>
        </div>
      </div>

      {folderError ? <p className="platform-magnet-error">{folderError}</p> : null}

      {!bilibiliAuthorized ? (
        <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.folder.waiting')}</p>
      ) : (
        <div className="platform-magnet-bilibili-folder-list">
          <PmpButton
            type="button"
            className={`platform-magnet-bilibili-folder-item ${
              selectedFolderId === null ? 'platform-magnet-bilibili-folder-item--active' : ''
            }`}
            variant="ghost"
            onClick={onShowRecommended}
          >
            <span className="platform-magnet-bilibili-folder-title">
              {t('magnet.platform.bilibili.folder.recommendedEntry')}
            </span>
            <span
              className="platform-magnet-bilibili-folder-count platform-magnet-bilibili-folder-count--placeholder"
              aria-hidden="true"
            >
              {t('magnet.platform.bilibili.folder.count', { count: 0 })}
            </span>
          </PmpButton>

          {folders.length === 0 ? (
            <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.folder.empty')}</p>
          ) : null}

          {folders.map((folder) => (
            <PmpButton
              key={folder.folderId}
              type="button"
              className={`platform-magnet-bilibili-folder-item ${
                folder.folderId === selectedFolderId ? 'platform-magnet-bilibili-folder-item--active' : ''
              }`}
              variant="ghost"
              onClick={() => onSelectFolder(folder.folderId)}
            >
              <span className="platform-magnet-bilibili-folder-title">{folder.title}</span>
              <span className="platform-magnet-bilibili-folder-count">
                {t('magnet.platform.bilibili.folder.count', { count: folder.mediaCount })}
              </span>
            </PmpButton>
          ))}
        </div>
      )}
    </PmpDrawer>
  );
}
