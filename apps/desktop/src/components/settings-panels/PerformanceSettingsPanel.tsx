import React from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { STORAGE_KEYS } from '../../utils/windowCommunication';

export function PerformanceSettingsPanel() {
  const [lowPerformanceMode, setLowPerformanceMode] = usePersistentSetting<boolean>(
    STORAGE_KEYS.EDITOR_LOW_PERFORMANCE_MODE,
    false
  );
  const [gifImportMaxFps, setGifImportMaxFps] = usePersistentSetting<number>(
    STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS,
    30
  );

  React.useEffect(() => {
    void applyEditorLowPerformanceMode(lowPerformanceMode);
  }, [lowPerformanceMode]);

  return (
    <>
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

        <p className="settings-card-note">禁用 Editor 窗口的高开销效果（如 Blur Behind）。</p>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">GIF 导入帧率限制</p>
            <p className="settings-card-desc">降低导入 GIF 的帧率，减少多窗口时的掉帧与透明闪烁风险。</p>
          </div>
          <span className="settings-card-badge">
            {gifImportMaxFps <= 0 ? 'OFF' : `${gifImportMaxFps}fps`}
          </span>
        </div>

        <div className="settings-toggle">
          <button type="button" data-active={gifImportMaxFps <= 0} onClick={() => setGifImportMaxFps(0)}>
            原始
          </button>
          <button type="button" data-active={gifImportMaxFps === 30} onClick={() => setGifImportMaxFps(30)}>
            30fps
          </button>
          <button type="button" data-active={gifImportMaxFps === 24} onClick={() => setGifImportMaxFps(24)}>
            24fps
          </button>
          <button type="button" data-active={gifImportMaxFps === 15} onClick={() => setGifImportMaxFps(15)}>
            15fps
          </button>
        </div>

        <p className="settings-card-note">仅对新导入的 GIF 生效；已导入的 GIF 需要重新导入。</p>
      </div>
    </>
  );
}
