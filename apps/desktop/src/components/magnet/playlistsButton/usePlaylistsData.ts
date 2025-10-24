/**
 * PlaylistsButton 数据层 Hook
 * 负责获取歌单相关数据
 */

import { useState, useEffect } from 'react';
import { audioService } from '../../../services/audio';

export interface PlaylistsData {
  // 未来可以添加歌单数量、当前歌单等数据
  playlistCount?: number;
}

/**
 * 获取PlaylistsButton的数据
 */
export function usePlaylistsData(): PlaylistsData {
  // 暂时返回空数据，未来可以监听歌单变化
  return {};
}
