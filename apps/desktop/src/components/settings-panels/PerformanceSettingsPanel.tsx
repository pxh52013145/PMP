import React from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useT } from '../../i18n';

export function PerformanceSettingsPanel() {
  const t = useT();
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
            <p className="settings-card-label">{t('settings.performance.lowPerformance.label')}</p>
            <p className="settings-card-desc">{t('settings.performance.lowPerformance.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {lowPerformanceMode ? t('common.state.on') : t('common.state.off')}
          </span>
        </div>

        <div className="settings-toggle">
          <button type="button" data-active={!lowPerformanceMode} onClick={() => setLowPerformanceMode(false)}>
            {t('settings.performance.lowPerformance.option.standard')}
          </button>
          <button type="button" data-active={lowPerformanceMode} onClick={() => setLowPerformanceMode(true)}>
            {t('settings.performance.lowPerformance.option.low')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.performance.lowPerformance.note')}</p>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.performance.gifImportFps.label')}</p>
            <p className="settings-card-desc">{t('settings.performance.gifImportFps.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {gifImportMaxFps <= 0 ? t('common.state.off') : `${gifImportMaxFps}fps`}
          </span>
        </div>

        <div className="settings-toggle">
          <button type="button" data-active={gifImportMaxFps <= 0} onClick={() => setGifImportMaxFps(0)}>
            {t('settings.performance.gifImportFps.option.original')}
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

        <p className="settings-card-note">{t('settings.performance.gifImportFps.note')}</p>
      </div>
    </>
  );
}
