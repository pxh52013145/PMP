import React from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { applyEditorLowPerformanceMode } from '../../utils/editorWindowEffects';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';
import {
  BACKGROUND_RENDER_THROTTLE_FPS,
  DEFAULT_BACKGROUND_RENDER_POLICY,
  type BackgroundRenderPolicy,
  parseBackgroundRenderPolicy,
} from '../../contracts/performance';
import { DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED } from '../../contracts/memoryGovernance';
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
  const [coverMaxEdgePx, setCoverMaxEdgePx] = usePersistentSetting<number>(
    STORAGE_KEYS.MUSIC_LIBRARY_COVER_MAX_EDGE_PX,
    256
  );
  const [backgroundRenderPolicyRaw] = usePersistentSetting<string>(
    STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
    DEFAULT_BACKGROUND_RENDER_POLICY,
    { format: 'json' }
  );
  const backgroundRenderPolicy = parseBackgroundRenderPolicy(
    backgroundRenderPolicyRaw,
    DEFAULT_BACKGROUND_RENDER_POLICY
  );
  const [autoGovernanceEnabled, setAutoGovernanceEnabled] = usePersistentSetting<boolean>(
    STORAGE_KEYS.MEMORY_GOVERNANCE_AUTO_ENABLED,
    DEFAULT_MEMORY_GOVERNANCE_AUTO_ENABLED
  );

  React.useEffect(() => {
    void applyEditorLowPerformanceMode(lowPerformanceMode);
  }, [lowPerformanceMode]);

  const setBackgroundRenderPolicy = React.useCallback((policy: BackgroundRenderPolicy) => {
    void broadcastDataUpdate(
      STORAGE_KEYS.BACKGROUND_RENDER_POLICY,
      policy,
      TAURI_EVENTS.BACKGROUND_RENDER_POLICY_UPDATED
    );
  }, []);

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

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.performance.coverThumbnails.label')}</p>
            <p className="settings-card-desc">{t('settings.performance.coverThumbnails.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {coverMaxEdgePx <= 0
              ? t('settings.performance.coverThumbnails.badge.original')
              : t('settings.performance.coverThumbnails.badge.px', { px: coverMaxEdgePx })}
          </span>
        </div>

        <div className="settings-toggle">
          <button type="button" data-active={coverMaxEdgePx === 128} onClick={() => setCoverMaxEdgePx(128)}>
            {t('settings.performance.coverThumbnails.option.low', { px: 128 })}
          </button>
          <button type="button" data-active={coverMaxEdgePx === 256} onClick={() => setCoverMaxEdgePx(256)}>
            {t('settings.performance.coverThumbnails.option.balanced', { px: 256 })}
          </button>
          <button type="button" data-active={coverMaxEdgePx === 512} onClick={() => setCoverMaxEdgePx(512)}>
            {t('settings.performance.coverThumbnails.option.high', { px: 512 })}
          </button>
          <button type="button" data-active={coverMaxEdgePx <= 0} onClick={() => setCoverMaxEdgePx(0)}>
            {t('settings.performance.coverThumbnails.option.original')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.performance.coverThumbnails.note')}</p>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.performance.backgroundRenderPolicy.label')}</p>
            <p className="settings-card-desc">{t('settings.performance.backgroundRenderPolicy.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {backgroundRenderPolicy === 'full'
              ? t('settings.performance.backgroundRenderPolicy.badge.full')
              : backgroundRenderPolicy === 'throttle'
                ? t('settings.performance.backgroundRenderPolicy.badge.throttle', {
                    fps: BACKGROUND_RENDER_THROTTLE_FPS,
                  })
                : t('settings.performance.backgroundRenderPolicy.badge.pause')}
          </span>
        </div>

        <div className="settings-toggle">
          <button
            type="button"
            data-active={backgroundRenderPolicy === 'full'}
            onClick={() => setBackgroundRenderPolicy('full')}
          >
            {t('settings.performance.backgroundRenderPolicy.option.full')}
          </button>
          <button
            type="button"
            data-active={backgroundRenderPolicy === 'throttle'}
            onClick={() => setBackgroundRenderPolicy('throttle')}
          >
            {t('settings.performance.backgroundRenderPolicy.option.throttle', {
              fps: BACKGROUND_RENDER_THROTTLE_FPS,
            })}
          </button>
          <button
            type="button"
            data-active={backgroundRenderPolicy === 'pause'}
            onClick={() => setBackgroundRenderPolicy('pause')}
          >
            {t('settings.performance.backgroundRenderPolicy.option.pause')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.performance.backgroundRenderPolicy.note')}</p>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.performance.memoryGovernanceAuto.label')}</p>
            <p className="settings-card-desc">{t('settings.performance.memoryGovernanceAuto.desc')}</p>
          </div>
          <span className="settings-card-badge">
            {autoGovernanceEnabled ? t('common.state.on') : t('common.state.off')}
          </span>
        </div>

        <div className="settings-toggle">
          <button type="button" data-active={!autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(false)}>
            {t('common.state.off')}
          </button>
          <button type="button" data-active={autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(true)}>
            {t('common.state.on')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.performance.memoryGovernanceAuto.note')}</p>
      </div>
    </>
  );
}
