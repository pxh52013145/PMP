import React from 'react';
import {
  BACKGROUND_RENDER_THROTTLE_FPS,
} from '../../contracts/performance';
import {
  PERFORMANCE_RUNTIME_PROFILES,
  type PerformanceRuntimeProfile,
} from '../../contracts/performanceControl';
import {
  parseQualityLevel,
  QUALITY_LEVELS,
  type QualitySettingsV1,
} from '../../contracts/quality';
import { useT } from '../../i18n';
import { useQuality } from '../../contexts/QualityContext';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import { PerformanceControlOverview } from './PerformanceControlOverview';
import { PmpChoiceButton, PmpSegmented } from '../primitives';

export function PerformanceSettingsPanel() {
  const t = useT();
  const { service, settings } = usePerformanceControlSettings();
  const qualitySnapshot = useQuality();

  const setLowPerformanceMode = React.useCallback(
    (enabled: boolean) => {
      void service.setEditorLowPerformanceMode(enabled);
    },
    [service]
  );

  const setGifImportMaxFps = React.useCallback(
    (value: number) => {
      void service.setGifImportMaxFps(value);
    },
    [service]
  );

  const setCoverMaxEdgePx = React.useCallback(
    (value: number) => {
      void service.setCoverMaxEdgePx(value);
    },
    [service]
  );

  const setBackgroundRenderPolicy = React.useCallback(
    (policy: 'full' | 'throttle' | 'pause') => {
      void service.setBackgroundRenderPolicy(policy);
    },
    [service]
  );

  const setAutoGovernanceEnabled = React.useCallback(
    (enabled: boolean) => {
      void service.setMemoryGovernanceAutoEnabled(enabled);
    },
    [service]
  );

  const setRuntimeProfile = React.useCallback(
    (profile: PerformanceRuntimeProfile) => {
      void service.setRuntimeProfile(profile);
    },
    [service]
  );

  const updateUiQualitySettings = React.useCallback(
    (next: QualitySettingsV1 | ((prev: QualitySettingsV1) => QualitySettingsV1)) => {
      void service.updateUiQualitySettings(next);
    },
    [service]
  );

  const lowPerformanceMode = settings.editorLowPerformanceMode;
  const gifImportMaxFps = settings.gifImportMaxFps;
  const coverMaxEdgePx = settings.coverMaxEdgePx;
  const backgroundRenderPolicy = settings.backgroundRenderPolicy;
  const autoGovernanceEnabled = settings.memoryGovernanceAutoEnabled;
  const uiQualitySettings = settings.uiQualitySettings;
  const runtimeProfile = settings.runtimeProfile;

  return (
    <div className="settings-rows">
      <PerformanceControlOverview />

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.runtimeProfile.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.runtimeProfile.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">
            {t(`settings.performance.runtimeProfile.option.${runtimeProfile}`)}
          </span>
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            {PERFORMANCE_RUNTIME_PROFILES.map((profile) => (
              <PmpChoiceButton
                key={profile}
                type="button"
                active={runtimeProfile === profile}
                onClick={() => setRuntimeProfile(profile)}
              >
                {t(`settings.performance.runtimeProfile.option.${profile}`)}
              </PmpChoiceButton>
            ))}
          </PmpSegmented>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.lowPerformance.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.lowPerformance.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">
            {lowPerformanceMode ? t('common.state.on') : t('common.state.off')}
          </span>
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={!lowPerformanceMode} onClick={() => setLowPerformanceMode(false)}>
              {t('settings.performance.lowPerformance.option.standard')}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={lowPerformanceMode} onClick={() => setLowPerformanceMode(true)}>
              {t('settings.performance.lowPerformance.option.low')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.gifImportFps.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.gifImportFps.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{gifImportMaxFps <= 0 ? t('common.state.off') : `${gifImportMaxFps}fps`}</span>
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={gifImportMaxFps <= 0} onClick={() => setGifImportMaxFps(0)}>
              {t('settings.performance.gifImportFps.option.original')}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={gifImportMaxFps === 30} onClick={() => setGifImportMaxFps(30)}>
              30fps
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={gifImportMaxFps === 24} onClick={() => setGifImportMaxFps(24)}>
              24fps
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={gifImportMaxFps === 15} onClick={() => setGifImportMaxFps(15)}>
              15fps
            </PmpChoiceButton>
          </PmpSegmented>
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
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={coverMaxEdgePx === 128} onClick={() => setCoverMaxEdgePx(128)}>
              {t('settings.performance.coverThumbnails.option.low', { px: 128 })}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={coverMaxEdgePx === 256} onClick={() => setCoverMaxEdgePx(256)}>
              {t('settings.performance.coverThumbnails.option.balanced', { px: 256 })}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={coverMaxEdgePx === 512} onClick={() => setCoverMaxEdgePx(512)}>
              {t('settings.performance.coverThumbnails.option.high', { px: 512 })}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={coverMaxEdgePx <= 0} onClick={() => setCoverMaxEdgePx(0)}>
              {t('settings.performance.coverThumbnails.option.original')}
            </PmpChoiceButton>
          </PmpSegmented>
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
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton
              type="button"
              active={backgroundRenderPolicy === 'full'}
              onClick={() => setBackgroundRenderPolicy('full')}
            >
              {t('settings.performance.backgroundRenderPolicy.option.full')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              active={backgroundRenderPolicy === 'throttle'}
              onClick={() => setBackgroundRenderPolicy('throttle')}
            >
              {t('settings.performance.backgroundRenderPolicy.option.throttle', { fps: BACKGROUND_RENDER_THROTTLE_FPS })}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              active={backgroundRenderPolicy === 'pause'}
              onClick={() => setBackgroundRenderPolicy('pause')}
            >
              {t('settings.performance.backgroundRenderPolicy.option.pause')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.memoryGovernanceAuto.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.memoryGovernanceAuto.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{autoGovernanceEnabled ? t('common.state.on') : t('common.state.off')}</span>
          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton type="button" active={!autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(false)}>
              {t('common.state.off')}
            </PmpChoiceButton>
            <PmpChoiceButton type="button" active={autoGovernanceEnabled} onClick={() => setAutoGovernanceEnabled(true)}>
              {t('common.state.on')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.performance.quality.label')}</div>
          <div className="settings-row-desc">{t('settings.performance.quality.desc')}</div>
        </div>
        <div className="settings-row-right">
          <div className="settings-row-stack">
          <span className="settings-row-badge">
            {uiQualitySettings.mode === 'auto'
              ? t('settings.performance.quality.badge.auto', {
                  level: t(`settings.performance.quality.level.${qualitySnapshot.effective.level}`),
                })
              : t('settings.performance.quality.badge.fixed', {
                  level: t(`settings.performance.quality.level.${uiQualitySettings.fixedLevel}`),
                })}
          </span>

          <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
            <PmpChoiceButton
              type="button"
              active={uiQualitySettings.mode === 'auto'}
              onClick={() => updateUiQualitySettings((prev) => ({ ...prev, mode: 'auto' }))}
            >
              {t('settings.performance.quality.mode.auto')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              active={uiQualitySettings.mode === 'fixed'}
              onClick={() => updateUiQualitySettings((prev) => ({ ...prev, mode: 'fixed' }))}
            >
              {t('settings.performance.quality.mode.fixed')}
            </PmpChoiceButton>
          </PmpSegmented>

          {uiQualitySettings.mode === 'fixed' ? (
            <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
              {QUALITY_LEVELS.map((level) => (
                <PmpChoiceButton
                  key={level}
                  type="button"
                  active={uiQualitySettings.fixedLevel === level}
                  onClick={() => updateUiQualitySettings((prev) => ({ ...prev, fixedLevel: parseQualityLevel(level, prev.fixedLevel) }))}
                >
                  {t(`settings.performance.quality.level.${level}`)}
                </PmpChoiceButton>
                ))}
              </PmpSegmented>
          ) : (
            <div className="settings-row-grid">
              <div className="settings-row-desc">{t('settings.performance.quality.auto.range')}</div>
              <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
                {QUALITY_LEVELS.map((level) => (
                  <PmpChoiceButton
                    key={`min-${level}`}
                    type="button"
                    active={uiQualitySettings.auto.minLevel === level}
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
                  </PmpChoiceButton>
                ))}
              </PmpSegmented>
              <div className="settings-row-desc">{t('settings.performance.quality.auto.rangeMax')}</div>
              <PmpSegmented className="settings-toggle settings-toggle--compact" surfaceId="primitive.segmented.toggle">
                {QUALITY_LEVELS.map((level) => (
                  <PmpChoiceButton
                    key={`max-${level}`}
                    type="button"
                    active={uiQualitySettings.auto.maxLevel === level}
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
                  </PmpChoiceButton>
                ))}
              </PmpSegmented>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="settings-row">
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
            <div className="settings-row-desc settings-row-meta">
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
          <div className="settings-row-desc-list">
            <div className="settings-row-desc">{t('settings.performance.lowPerformance.note')}</div>
            <div className="settings-row-desc">{t('settings.performance.gifImportFps.note')}</div>
            <div className="settings-row-desc">{t('settings.performance.coverThumbnails.note')}</div>
            <div className="settings-row-desc">{t('settings.performance.backgroundRenderPolicy.note')}</div>
            <div className="settings-row-desc">{t('settings.performance.memoryGovernanceAuto.note')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
