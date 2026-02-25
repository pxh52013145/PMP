import { useCallback, useState } from 'react';

import type { BilibiliFavoriteResourceItem } from '../../../modules/music-platform';
import type { ContextMenuItem } from '../ContextMenu';

type Translator = (key: string, params?: Record<string, string | number>) => string;

type UseBilibiliResourceContextMenuParams = {
  t: Translator;
  preparingResourceId: string | null;
  normalizedPlaybackQualityHint: string;
  lyricResolvingId: string | null;
  onPlay: (item: BilibiliFavoriteResourceItem) => void;
  onQueue: (item: BilibiliFavoriteResourceItem) => void;
  onAddToPlaylist: (item: BilibiliFavoriteResourceItem) => void;
  onOpen: (item: BilibiliFavoriteResourceItem) => void;
  onResolveLyric: (item: BilibiliFavoriteResourceItem) => void;
};

export function useBilibiliResourceContextMenu(params: UseBilibiliResourceContextMenuParams) {
  const {
    t,
    preparingResourceId,
    normalizedPlaybackQualityHint,
    lyricResolvingId,
    onPlay,
    onQueue,
    onAddToPlaylist,
    onOpen,
    onResolveLyric,
  } = params;

  const [resourceContextMenu, setResourceContextMenu] = useState<
    null | { x: number; y: number; items: ContextMenuItem[] }
  >(null);

  const openResourceContextMenu = useCallback(
    (item: BilibiliFavoriteResourceItem, event: React.MouseEvent) => {
      event.preventDefault();

      const preparing =
        preparingResourceId === `${item.resourceId || item.sourceLocator}::${normalizedPlaybackQualityHint}`;

      setResourceContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: t('magnet.platform.bilibili.resource.actionPlay'),
            onClick: () => onPlay(item),
            disabled: preparing,
          },
          {
            label: t('magnet.platform.bilibili.resource.actionQueue'),
            onClick: () => onQueue(item),
            disabled: preparing,
          },
          {
            label: t('magnet.platform.bilibili.resource.actionAddToPlaylist'),
            onClick: () => onAddToPlaylist(item),
            disabled: preparing,
          },
          { divider: true } as ContextMenuItem,
          {
            label: t('magnet.platform.bilibili.resource.actionOpen'),
            onClick: () => onOpen(item),
          },
          {
            label:
              lyricResolvingId === item.resourceId
                ? t('magnet.platform.bilibili.lyric.actionResolving')
                : t('magnet.platform.bilibili.lyric.actionResolve'),
            onClick: () => onResolveLyric(item),
            disabled: lyricResolvingId === item.resourceId,
          },
        ],
      });
    },
    [
      lyricResolvingId,
      normalizedPlaybackQualityHint,
      onAddToPlaylist,
      onOpen,
      onPlay,
      onQueue,
      onResolveLyric,
      preparingResourceId,
      t,
    ]
  );

  return {
    resourceContextMenu,
    setResourceContextMenu,
    openResourceContextMenu,
  };
}
