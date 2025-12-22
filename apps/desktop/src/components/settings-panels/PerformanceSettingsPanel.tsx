import React from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export function PerformanceSettingsPanel() {
  const [lowPerformanceMode, setLowPerformanceMode] = usePersistentSetting<boolean>(
    STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
    false
  );

  React.useEffect(() => {
    void applyEditorLowPerformanceMode(lowPerformanceMode);
  }, [lowPerformanceMode]);

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">低性能模式</p>
          <p className="settings-card-desc">多开 Editor 窗口时推荐开启，减少滚动卡顿。</p>
        </div>
        <span className="settings-card-badge">{lowPerformanceMode ? 'ON' : 'OFF'}</span>
      </div>

      <div className="settings-toggle">
        <button type="button" data-active={!lowPerformanceMode} onClick={() => setLowPerformanceMode(false)}>
          标准
        </button>
        <button type="button" data-active={lowPerformanceMode} onClick={() => setLowPerformanceMode(true)}>
          低性能
        </button>
      </div>

      <p className="settings-card-note">保持透明与剪角，禁用 Windows Blur Behind。</p>
    </div>
  );
}

