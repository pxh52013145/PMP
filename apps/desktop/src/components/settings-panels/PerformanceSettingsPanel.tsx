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
import { DEFAULT_QUALITY_SETTINGS_V1, parseQualityLevel, parseQualitySettings, QUALITY_LEVELS } from '../../contracts/quality';
import { useT } from '../../i18n';
import { useQuality } from '../../contexts/QualityContext';

export function PerformanceSettingsPanel() {
  const t = useT();
  const qualitySnapshot = useQuality();
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
  const [uiQualitySettingsRaw] = usePersistentSetting<unknown>(
    STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
    DEFAULT_QUALITY_SETTINGS_V1
  );
  const uiQualitySettings = parseQualitySettings(uiQualitySettingsRaw, DEFAULT_QUALITY_SETTINGS_V1);

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

  const updateUiQualitySettings = React.useCallback(
    (next: typeof uiQualitySettings | ((prev: typeof uiQualitySettings) => typeof uiQualitySettings)) => {
      const resolved = typeof next === 'function' ? next(uiQualitySettings) : next;
      void broadcastDataUpdate(
        STORAGE_KEYS.UI_QUALITY_SETTINGS_V1,
        resolved,
        TAURI_EVENTS.UI_QUALITY_SETTINGS_UPDATED
      );
    },
    [uiQualitySettings]
  );

  return (
    <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.lowPerformance.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.lowPerformance.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">
            {lowPerformanceMode ? t('common.state.on') : t('common.state.off')}
          </span>
          <div className="settings-toggle settings-toggle--compact">
            <button type="button" data-active={!lowPerformanceMode} onClick={() => setLowPerformanceMode(false)}>
              {t('settings.performance.lowPerformance.option.standard')}
            </button>
            <button type="button" data-active={lowPerformanceMode} onClick={() => setLowPerformanceMode(true)}>
              {t('settings.performance.lowPerformance.option.low')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.gifImportFps.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.gifImportFps.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{gifImportMaxFps <= 0 ? t('common.state.off') : `${gifImportMaxFps}fps`}</span>
          <div className="settings-toggle settings-toggle--compact">
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
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.coverThumbnails.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.coverThumbnails.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">
            {coverMaxEdgePx <= 0
              ? t('settings.performance.coverThumbnails.badge.original')
              : t('settings.performance.coverThumbnails.badge.px', { px: coverMaxEdgePx })}
          </span>
          <div className="settings-toggle settings-toggle--compact">
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
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.backgroundRenderPolicy.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.backgroundRenderPolicy.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">
            {backgroundRenderPolicy === 'full'
              ? t('settings.performance.backgroundRenderPolicy.badge.full')
              : backgroundRenderPolicy === 'throttle'
                ? t('settings.performance.backgroundRenderPolicy.badge.throttle', {
                    fps: BACKGROUND_RENDER_THROTTLE_FPS,
                  })
                : t('settings.performance.backgroundRenderPolicy.badge.pause')}
          </span>
          <div className="settings-toggle settings-toggle--compact">
            <button type="button" data-active={backgroundRenderPolicy === 'full'} onClick={() => setBackgroundRenderPolicy('full')}>
              {t('settings.performance.backgroundRenderPolicy.option.full')}
            </button>
            <button
              type="button"
              data-active={backgroundRenderPolicy === 'throttle'}
              onClick={() => setBackgroundRenderPolicy('throttle')}
            >
              {t('settings.performance.backgroundRenderPolicy.option.throttle', { fps: BACKGROUND_RENDER_THROTTLE_FPS })}
            </button>
            <button type="button" data-active={backgroundRenderPolicy === 'pause'} onClick={() => setBackgroundRenderPolicy('pause')}>
              {t('settings.performance.backgroundRenderPolicy.option.pause')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.memoryGovernanceAuto.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.memoryGovernanceAuto.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{autoGovernanceEnabled ? t('common.state.on') : t('common.state.off')}</span>
          <div className="settings-toggle settings-toggle--compact">
            <button type="button" data-active={!autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(false)}>
              {t('common.state.off')}
            </button>
            <button type="button" data-active={autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(true)}>
              {t('common.state.on')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.quality.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.quality.desc')}</div>
        </div>
        <div className="settings-row-right" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span className="settings-row-badge">
            {uiQualitySettings.mode === 'auto'
              ? t('settings.performance.quality.badge.auto', {
                  level: t(`settings.performance.quality.level.${qualitySnapshot.effective.level}`),
                })
              : t('settings.performance.quality.badge.fixed', {
                  level: t(`settings.performance.quality.level.${uiQualitySettings.fixedLevel}`),
                })}
          </span>

          <div className="settings-toggle settings-toggle--compact">
            <button
              type="button"
              data-active={uiQualitySettings.mode === 'auto'}
              onClick={() => updateUiQualitySettings((prev) => ({ ...prev, mode: 'auto' }))}
            >
              {t('settings.performance.quality.mode.auto')}
            </button>
            <button
              type="button"
              data-active={uiQualitySettings.mode === 'fixed'}
              onClick={() => updateUiQualitySettings((prev) => ({ ...prev, mode: 'fixed' }))}
            >
              {t('settings.performance.quality.mode.fixed')}
            </button>
          </div>

          {uiQualitySettings.mode === 'fixed' ? (
            <div className="settings-toggle settings-toggle--compact">
              {QUALITY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  data-active={uiQualitySettings.fixedLevel === level}
                  onClick={() => updateUiQualitySettings((prev) => ({ ...prev, fixedLevel: parseQualityLevel(level, prev.fixedLevel) }))}
                >
                  {t(`settings.performance.quality.level.${level}`)}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
              <div className="settings-row-desc">{t('settings.performance.quality.auto.range')}</div>
              <div className="settings-toggle settings-toggle--compact">
                {QUALITY_LEVELS.map((level) => (
                  <button
                    key={`min-${level}`}
                    type="button"
                    data-active={uiQualitySettings.auto.minLevel === level}
                    onClick={() =>
                      updateUiQualitySettings((prev) => {
                        const minLevel = parseQualityLevel(level, prev.auto.minLevel);
                        const maxLevel = prev.auto.maxLevel;
                        return {
                          ...prev,
                          auto: {
                            ...prev.auto,
                            minLevel,
                            maxLevel: QUALITY_LEVELS.indexOf(maxLevel) < QUALITY_LEVELS.indexOf(minLevel) ? minLevel : maxLevel,
                          },
                        };
                      })
                    }
                  >
                    {t(`settings.performance.quality.level.${level}`)}
                  </button>
                ))}
              </div>
              <div className="settings-row-desc">{t('settings.performance.quality.auto.rangeMax')}</div>
              <div className="settings-toggle settings-toggle--compact">
                {QUALITY_LEVELS.map((level) => (
                  <button
                    key={`max-${level}`}
                    type="button"
                    data-active={uiQualitySettings.auto.maxLevel === level}
                    onClick={() =>
                      updateUiQualitySettings((prev) => {
                        const maxLevel = parseQualityLevel(level, prev.auto.maxLevel);
                        const minLevel = prev.auto.minLevel;
                        return {
                          ...prev,
                          auto: {
                            ...prev.auto,
                            maxLevel,
                            minLevel: QUALITY_LEVELS.indexOf(minLevel) > QUALITY_LEVELS.indexOf(maxLevel) ? maxLevel : minLevel,
                          },
                        };
                      })
                    }
                  >
                    {t(`settings.performance.quality.level.${level}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="settings-row" style={{ alignItems: 'flex-start' }}>
        <div className="settings-row-left">
          <div className="settings-row-desc">
            {t('settings.performance.quality.effective', {
              scale: qualitySnapshot.effective.renderScale.toFixed(2),
              fps: qualitySnapshot.effective.fpsForeground,
              bgFps: qualitySnapshot.effective.fpsBackground,
              fxFps: qualitySnapshot.effective.fpsEffects,
            })}
          </div>
          {qualitySnapshot.lastDecision ? (
            <div className="settings-row-desc" style={{ marginTop: 6 }}>
              {t('settings.performance.quality.lastDecision', {
                from: t(`settings.performance.quality.level.${qualitySnapshot.lastDecision.from}`),
                to: t(`settings.performance.quality.level.${qualitySnapshot.lastDecision.to}`),
                detail:
                  qualitySnapshot.lastDecision.reason.kind === 'manual'
                    ? t('settings.performance.quality.reason.manual')
                    : qualitySnapshot.lastDecision.reason.kind === 'auto-init'
                      ? t('settings.performance.quality.reason.autoInit', {
                          detail: qualitySnapshot.lastDecision.reason.detail ?? '',
                        })
                      : qualitySnapshot.lastDecision.reason.kind === 'auto-upgrade'
                        ? t('settings.performance.quality.reason.autoUpgrade', {
                            detail: qualitySnapshot.lastDecision.reason.detail,
                          })
                        : t('settings.performance.quality.reason.autoDowngrade', {
                            detail: qualitySnapshot.lastDecision.reason.detail,
                          }),
              })}
            </div>
          ) : null}
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-desc">{t('settings.performance.lowPerformance.note')}</div>
          <div className="settings-row-desc" style={{ marginTop: 6 }}>
            {t('settings.performance.gifImportFps.note')}
          </div>
          <div className="settings-row-desc" style={{ marginTop: 6 }}>
            {t('settings.performance.coverThumbnails.note')}
          </div>
          <div className="settings-row-desc" style={{ marginTop: 6 }}>
            {t('settings.performance.backgroundRenderPolicy.note')}
          </div>
          <div className="settings-row-desc" style={{ marginTop: 6 }}>
            {t('settings.performance.memoryGovernanceAuto.note')}
          </div>
        </div>
      </div>
    </div>
  );
}
