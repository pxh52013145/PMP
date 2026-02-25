import type { BilibiliFavoriteFolderItem } from '../../../modules/music-platform';

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
    onSelectFolder,
    t,
  } = props;

  return (
    <section
      className={`platform-magnet-panel platform-magnet-bilibili-folders ${
        open ? 'platform-magnet-bilibili-drawer-open' : ''
      }`}
    >
      <div className="platform-magnet-panel-header">
        <h4>{t('magnet.platform.bilibili.folder.title')}</h4>
        <div className="platform-magnet-bilibili-panel-actions">
          <button
            type="button"
            className="platform-magnet-mini-btn"
            disabled={!bilibiliAuthorized || folderLoading}
            onClick={onRefresh}
          >
            {folderLoading
              ? t('magnet.platform.bilibili.folder.actionRefreshing')
              : t('magnet.platform.bilibili.folder.actionRefresh')}
          </button>
          <button type="button" className="platform-magnet-mini-btn" onClick={onClose}>
            {t('common.action.done')}
          </button>
        </div>
      </div>

      {folderError ? <p className="platform-magnet-error">{folderError}</p> : null}

      {!bilibiliAuthorized ? (
        <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.folder.waiting')}</p>
      ) : folders.length === 0 ? (
        <p className="platform-magnet-panel-empty">{t('magnet.platform.bilibili.folder.empty')}</p>
      ) : (
        <div className="platform-magnet-bilibili-folder-list">
          {folders.map((folder) => (
            <button
              key={folder.folderId}
              type="button"
              className={`platform-magnet-bilibili-folder-item ${
                folder.folderId === selectedFolderId ? 'platform-magnet-bilibili-folder-item--active' : ''
              }`}
              onClick={() => onSelectFolder(folder.folderId)}
            >
              <span className="platform-magnet-bilibili-folder-title">{folder.title}</span>
              <span className="platform-magnet-bilibili-folder-count">
                {t('magnet.platform.bilibili.folder.count', { count: folder.mediaCount })}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

