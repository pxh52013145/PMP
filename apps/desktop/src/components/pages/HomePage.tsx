import React from 'react';
import './HomePage.css';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import type { AudioEngineType } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';

/**
 * 首页组件
 */
export const HomePage: React.FC = () => {
  const { engineType, isNativeAvailable, setEngineType } = useAudioEngine();
  const { navigateTo } = useNavigation();

  const handleEngineChange = (type: AudioEngineType) => {
    if (type === engineType) return;
    setEngineType(type);
  };

  return (
    <div className="page-home">
      <div className="home-welcome">
        <div className="home-icon">♪</div>
        <h1 className="home-title">欢迎使用音乐播放器</h1>
        <p className="home-subtitle">点击右侧按钮访问音乐库、歌单等功能</p>

        <div className="audio-engine-card">
          <div className="audio-engine-card-header">
            <div>
              <p className="audio-engine-label">音频引擎</p>
              <p className="audio-engine-desc">选择底层播放实现，统一接入 Magnet 控件。</p>
            </div>
            <span className="audio-engine-badge">
              {engineType === 'web' ? 'Web Audio' : 'Native Audio'}
            </span>
          </div>

          <div className="audio-engine-toggle">
            <button
              type="button"
              data-active={engineType === 'web'}
              onClick={() => handleEngineChange('web')}
            >
              Web Audio
            </button>
            <button
              type="button"
              data-active={engineType === 'native'}
              disabled={!isNativeAvailable}
              onClick={() => handleEngineChange('native')}
              title={isNativeAvailable ? undefined : '原生音频引擎开发中'}
            >
              Native Audio
            </button>
          </div>

          {!isNativeAvailable && (
            <p className="audio-engine-note">原生音频引擎正在开发中，完成后即可在此切换。</p>
          )}

          <button
            className="native-debug-link"
            onClick={() => navigateTo('native-debug')}
            disabled={!isNativeAvailable}
          >
            原生引擎调试
          </button>
        </div>
      </div>
    </div>
  );
};
