import React from 'react';
import './SettingsPage.css';
import { useAudioEngine } from '../../contexts/AudioEngineContext';
import type { AudioEngineType } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { usePersistentSetting } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export const SettingsPage: React.FC = () => {
  const { engineType, isNativeAvailable, setEngineType } = useAudioEngine();
  const { navigateTo } = useNavigation();
  const [lowPerformanceMode, setLowPerformanceMode] = usePersistentSetting<boolean>(
    STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
    false
  );

  const handleEngineChange = (type: AudioEngineType) => {
    if (type === engineType) return;
    setEngineType(type);
  };

  React.useEffect(() => {
    void applyEditorLowPerformanceMode(lowPerformanceMode);
  }, [lowPerformanceMode]);

  return (
    <div className="page-settings">
      <div className="settings-header">
        <div>
          <h1 className="settings-title">设置</h1>
          <p className="settings-subtitle">在这里管理全局配置与性能选项</p>
        </div>
      </div>

      <div className="settings-sections">
        <section className="settings-section">
          <h2 className="settings-section-title">性能</h2>

          <div className="settings-card">
            <div className="settings-card-header">
              <div>
                <p className="settings-card-label">低性能模式</p>
                <p className="settings-card-desc">
                  多开 Editor 窗口时推荐开启，关闭系统模糊以减少滚动卡顿。
                </p>
              </div>
              <span className="settings-card-badge">{lowPerformanceMode ? 'ON' : 'OFF'}</span>
            </div>

            <div className="settings-toggle">
              <button
                type="button"
                data-active={!lowPerformanceMode}
                onClick={() => setLowPerformanceMode(false)}
              >
                标准
              </button>
              <button
                type="button"
                data-active={lowPerformanceMode}
                onClick={() => setLowPerformanceMode(true)}
              >
                低性能
              </button>
            </div>

            <p className="settings-card-note">保持透明与剪角，禁用 Windows Blur Behind。</p>
          </div>
        </section>

        <section className="settings-section">
          <h2 className="settings-section-title">音频</h2>

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
        </section>
      </div>
    </div>
  );
};
