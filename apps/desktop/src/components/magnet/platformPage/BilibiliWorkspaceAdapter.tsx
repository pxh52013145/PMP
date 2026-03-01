import type { BilibiliWorkspaceProps } from './BilibiliWorkspace';
import { BilibiliWorkspace } from './BilibiliWorkspace';

export interface BilibiliWorkspaceToolbarProps {
  bvidQuery: string;
  bvidSearching: boolean;
  bilibiliAuthorized: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
  onBvidQueryChange: (value: string) => void;
  onBvSearch: () => void;
  onOpenPlaybackSettings: () => void;
}

export function BilibiliWorkspaceToolbar(props: BilibiliWorkspaceToolbarProps): JSX.Element {
  const {
    bvidQuery,
    bvidSearching,
    bilibiliAuthorized,
    t,
    onBvidQueryChange,
    onBvSearch,
    onOpenPlaybackSettings,
  } = props;

  return (
    <div className="platform-magnet-bv-top-search">
      <input
        value={bvidQuery}
        placeholder={t('magnet.platform.bilibili.resource.bvSearchPlaceholder')}
        onChange={(event) => onBvidQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          void onBvSearch();
        }}
      />
      <button type="button" className="platform-magnet-mini-btn" onClick={() => void onBvSearch()}>
        {bvidSearching
          ? t('magnet.platform.bilibili.resource.bvSearchSearching')
          : t('magnet.platform.bilibili.resource.bvSearchAction')}
      </button>
      <button
        type="button"
        className="platform-magnet-mini-btn"
        disabled={!bilibiliAuthorized}
        onClick={onOpenPlaybackSettings}
      >
        {t('magnet.platform.bilibili.settings.open')}
      </button>
    </div>
  );
}

export function BilibiliWorkspaceAdapter(props: BilibiliWorkspaceProps): JSX.Element {
  return <BilibiliWorkspace {...props} />;
}
