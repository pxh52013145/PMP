import type { NeteaseWorkspaceProps } from './NeteaseWorkspace';
import { NeteaseWorkspace } from './NeteaseWorkspace';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface NeteaseWorkspaceToolbarProps {
  neteaseAuthorized: boolean;
  collectionLoading: boolean;
  resourceLoading: boolean;
  t: Translator;
  onShowRecommended: () => void;
  onRefreshCollections: () => void;
  onRefreshResources: () => void;
}

export function NeteaseWorkspaceToolbar(props: NeteaseWorkspaceToolbarProps): JSX.Element {
  const {
    neteaseAuthorized,
    collectionLoading,
    resourceLoading,
    t,
    onShowRecommended,
    onRefreshCollections,
    onRefreshResources,
  } = props;

  return (
    <div className="platform-workspace-toolbar">
      <button
        type="button"
        className="platform-magnet-mini-btn"
        disabled={!neteaseAuthorized || resourceLoading}
        onClick={onShowRecommended}
      >
        {t('magnet.platform.netease.resource.actionShowRecommended')}
      </button>
      <button
        type="button"
        className="platform-magnet-mini-btn"
        disabled={!neteaseAuthorized || collectionLoading}
        onClick={onRefreshCollections}
      >
        {collectionLoading
          ? t('magnet.platform.netease.collection.actionRefreshing')
          : t('magnet.platform.netease.collection.actionRefresh')}
      </button>
      <button
        type="button"
        className="platform-magnet-mini-btn"
        disabled={!neteaseAuthorized || resourceLoading}
        onClick={onRefreshResources}
      >
        {resourceLoading
          ? t('magnet.platform.netease.resource.actionRefreshing')
          : t('magnet.platform.netease.resource.actionRefresh')}
      </button>
      <span className="platform-magnet-panel-tag">
        {neteaseAuthorized
          ? t('magnet.platform.netease.status.ready')
          : t('magnet.platform.netease.status.waiting')}
      </span>
    </div>
  );
}

export function NeteaseWorkspaceAdapter(props: NeteaseWorkspaceProps): JSX.Element {
  return <NeteaseWorkspace {...props} />;
}
