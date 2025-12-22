import { useAudioEngine } from '../../contexts/AudioEngineContext';
import type { AudioEngineType } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';

export function AudioSettingsPanel() {
  const { engineType, isNativeAvailable, setEngineType } = useAudioEngine();
  const { navigateTo } = useNavigation();

  const handleEngineChange = (type: AudioEngineType) => {
    if (type === engineType) return;
    setEngineType(type);
  };

  return (
    <div className="audio-engine-card">
      <div className="audio-engine-card-header">
        <div>
          <p className="audio-engine-label">音频引擎</p>
          <p className="audio-engine-desc">选择底层播放实现，统一接入 Magnet 控件。</p>
        </div>
        <span className="audio-engine-badge">{engineType === 'web' ? 'Web Audio' : 'Native Audio'}</span>
      </div>

      <div className="audio-engine-toggle">
        <button type="button" data-active={engineType === 'web'} onClick={() => handleEngineChange('web')}>
          Web Audio（兼容/调试）
        </button>
        <button
          type="button"
          data-active={engineType === 'native'}
          disabled={!isNativeAvailable}
          onClick={() => handleEngineChange('native')}
          title={isNativeAvailable ? undefined : '原生音频引擎开发中'}
        >
          Native Audio（默认）
        </button>
      </div>

      {!isNativeAvailable && <p className="audio-engine-note">原生音频引擎正在开发中，完成后即可在此切换。</p>}

      <button className="native-debug-link" onClick={() => navigateTo('native-debug')} disabled={!isNativeAvailable}>
        原生引擎调试
      </button>
    </div>
  );
}
