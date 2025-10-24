import { useNavigation } from '../../contexts/NavigationContext';
import { HomePage } from '../pages/HomePage';
import { MusicLibrary } from '../pages/MusicLibrary';
import { TrackDetailPage } from '../pages/TrackDetailPage';
import { AlbumDetailPage } from '../pages/AlbumDetailPage';
import { audioService, Track } from '../../services/audio';
import './NavigationPage.css';

/**
 * 导航页面组件
 * 主要内容展示区域，支持多页面切换
 */
export function NavigationPage() {
  const { currentPage } = useNavigation();

  // 播放歌曲
  const handlePlayNow = async (tracks: Track[], startIndex: number = 0) => {
    if (tracks.length === 0) return;

    // 清空队列并添加新歌曲
    audioService.clearQueue();
    audioService.addMultipleToQueue(tracks);
    await audioService.playTrackAtIndex(startIndex);

    console.log(`✅ Playing ${tracks.length} track(s) from index ${startIndex}`);
  };

  // 添加到队列
  const handleAddToQueue = (tracks: Track[]) => {
    if (tracks.length === 0) return;

    audioService.addMultipleToQueue(tracks);
    console.log(`Added ${tracks.length} track(s) to queue`);
  };

  const getPageTitle = () => {
    switch (currentPage.type) {
      case 'home':
        return '首页';
      case 'music-library':
        return '音乐库';
      case 'playlists':
        return '歌单';
      case 'play-queue':
        return '播放列表';
      case 'track':
        return '歌曲详情';
      case 'album':
        return '专辑';
      case 'artist':
        return '艺术家';
      default:
        return '首页';
    }
  };

  return (
    <div className="navigation-page">
      {/* 页面内容区域 */}
      <div className="navigation-content">
        {currentPage.type === 'home' && <HomePage />}

        {currentPage.type === 'music-library' && (
          <MusicLibrary embedded={true} onPlayNow={handlePlayNow} onAddToQueue={handleAddToQueue} />
        )}

        {currentPage.type === 'track' && (
          <TrackDetailPage initialTrack={currentPage.params?.track} />
        )}

        {currentPage.type === 'playlists' && (
          <div className="page-placeholder">
            <div className="placeholder-icon">♬</div>
            <div className="placeholder-text">歌单页面</div>
          </div>
        )}

        {currentPage.type === 'play-queue' && (
          <div className="page-placeholder">
            <div className="placeholder-icon">☰</div>
            <div className="placeholder-text">播放列表页面</div>
          </div>
        )}

        {currentPage.type === 'album' && (
          <AlbumDetailPage
            albumName={currentPage.params?.albumName}
            artist={currentPage.params?.artist}
            tracks={currentPage.params?.tracks}
          />
        )}

        {currentPage.type === 'artist' && (
          <div className="page-placeholder">
            <div className="placeholder-icon">♪</div>
            <div className="placeholder-text">艺术家页面</div>
          </div>
        )}
      </div>

      {/* 页面底部指示器 */}
      <div className="navigation-footer">
        <div className="page-info">
          {currentPage.type === 'home' ? '主页面' : `${getPageTitle()}`}
        </div>
      </div>
    </div>
  );
}
