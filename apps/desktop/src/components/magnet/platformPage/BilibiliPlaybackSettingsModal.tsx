import type {
  BilibiliPlaybackCacheSettings,
  BilibiliPlaybackQualityOption,
} from '../../../modules/music-platform';

type Translator = (key: string, params?: Record<string, string | number>) => string;

type BilibiliPlaybackSettingsModalProps = {
  open: boolean;
  t: Translator;
  bilibiliAuthorized: boolean;
  normalizedPlaybackQualityHint: string;
  normalizedBilibiliThemePreference: string;
  playbackQualityOptions: BilibiliPlaybackQualityOption[];
  playbackQualityLoading: boolean;
  qualityProbeSourceLocator: string | null;
  availablePlaybackQualityLabel: string;
  qualityLabelForKey: (qualityKey: string) => string;
  onClose: () => void;
  onQualityHintChange: (qualityKey: string) => void;
  onBilibiliThemePreferenceChange: (themePreference: string) => void;
  onRefreshQualityOptions: () => void;
  playbackCacheSettingsLoading: boolean;
  playbackCacheSettingsSaving: boolean;
  playbackCacheSettingsInfo: string | null;
  playbackCacheSettingsError: string | null;
  playbackCacheSettings: BilibiliPlaybackCacheSettings | null;
  playbackCachePathDraft: string;
  onPlaybackCachePathDraftChange: (path: string) => void;
  onBrowsePlaybackCachePath: () => void;
  onSavePlaybackCachePath: () => void;
  onResetPlaybackCachePath: () => void;
};

export function BilibiliPlaybackSettingsModal(props: BilibiliPlaybackSettingsModalProps) {
  const {
    open,
    t,
    bilibiliAuthorized,
    normalizedPlaybackQualityHint,
    normalizedBilibiliThemePreference,
    playbackQualityOptions,
    playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel,
    qualityLabelForKey,
    onClose,
    onQualityHintChange,
    onBilibiliThemePreferenceChange,
    onRefreshQualityOptions,
    playbackCacheSettingsLoading,
    playbackCacheSettingsSaving,
    playbackCacheSettingsInfo,
    playbackCacheSettingsError,
    playbackCacheSettings,
    playbackCachePathDraft,
    onPlaybackCachePathDraftChange,
    onBrowsePlaybackCachePath,
    onSavePlaybackCachePath,
    onResetPlaybackCachePath,
  } = props;

  if (!open) return null;

  return (
    <div className="platform-magnet-settings-overlay" role="presentation" onClick={onClose}>
      <div
        className="platform-magnet-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('magnet.platform.bilibili.settings.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="platform-magnet-panel-header">
          <h4>{t('magnet.platform.bilibili.settings.title')}</h4>
          <button type="button" className="platform-magnet-mini-btn" onClick={onClose}>
            {t('common.action.done')}
          </button>
        </div>

        <div className="platform-magnet-settings-row">
          <select
            value={normalizedPlaybackQualityHint}
            disabled={!bilibiliAuthorized}
            onChange={(event) => {
              onQualityHintChange(event.target.value);
            }}
          >
            {playbackQualityOptions.map((option) => {
              const optionKey = option.key.trim().toLowerCase();
              const label = qualityLabelForKey(optionKey);
              return (
                <option key={option.key} value={optionKey}>
                  {label}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="platform-magnet-mini-btn"
            disabled={!qualityProbeSourceLocator || playbackQualityLoading}
            onClick={onRefreshQualityOptions}
          >
            {playbackQualityLoading
              ? t('magnet.platform.bilibili.quality.actionRefreshing')
              : t('magnet.platform.bilibili.quality.actionRefresh')}
          </button>
        </div>

        <p className="platform-magnet-note">
          {t('magnet.platform.bilibili.quality.current', {
            quality: qualityLabelForKey(normalizedPlaybackQualityHint),
            available: availablePlaybackQualityLabel,
          })}
        </p>
        <p className="platform-magnet-note">{t('magnet.platform.bilibili.quality.fallbackHint')}</p>

        <div className="platform-magnet-settings-section">
          <h5 className="platform-magnet-settings-section-title">
            {t('magnet.platform.bilibili.settings.theme.title')}
          </h5>

          <div className="platform-magnet-settings-row">
            <select
              value={normalizedBilibiliThemePreference}
              onChange={(event) => {
                onBilibiliThemePreferenceChange(event.target.value);
              }}
            >
              <option value="auto">{t('magnet.platform.bilibili.settings.theme.mode.auto')}</option>
              <option value="light">{t('magnet.platform.bilibili.settings.theme.mode.light')}</option>
              <option value="dark">{t('magnet.platform.bilibili.settings.theme.mode.dark')}</option>
            </select>
          </div>

          <p className="platform-magnet-note">{t('magnet.platform.bilibili.settings.theme.hint')}</p>
        </div>

        <div className="platform-magnet-settings-section">
          <h5 className="platform-magnet-settings-section-title">
            {t('magnet.platform.bilibili.settings.cache.title')}
          </h5>

          <div className="platform-magnet-settings-path-item">
            <span className="platform-magnet-settings-path-label">
              {t('magnet.platform.bilibili.settings.cache.effectivePath')}
            </span>
            <p className="platform-magnet-settings-path-value">
              {playbackCacheSettings?.effectiveRootPath || '—'}
            </p>
          </div>

          <div className="platform-magnet-settings-path-item">
            <span className="platform-magnet-settings-path-label">
              {t('magnet.platform.bilibili.settings.cache.defaultPath')}
            </span>
            <p className="platform-magnet-settings-path-value">
              {playbackCacheSettings?.defaultRootPath || '—'}
            </p>
          </div>

          <div className="platform-magnet-settings-path-item">
            <span className="platform-magnet-settings-path-label">
              {t('magnet.platform.bilibili.settings.cache.customPath')}
            </span>
          </div>

          <div className="platform-magnet-settings-row">
            <input
              type="text"
              className="platform-magnet-settings-input"
              value={playbackCachePathDraft}
              placeholder={t('magnet.platform.bilibili.settings.cache.customPathPlaceholder')}
              onChange={(event) => {
                onPlaybackCachePathDraftChange(event.target.value);
              }}
              disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
              spellCheck={false}
            />

            <button
              type="button"
              className="platform-magnet-mini-btn"
              disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
              onClick={onBrowsePlaybackCachePath}
            >
              {t('magnet.platform.bilibili.settings.cache.actionBrowse')}
            </button>
          </div>

          <div className="platform-magnet-settings-actions">
            <button
              type="button"
              className="platform-magnet-mini-btn"
              disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
              onClick={onSavePlaybackCachePath}
            >
              {playbackCacheSettingsSaving
                ? t('magnet.platform.bilibili.settings.cache.stateSaving')
                : t('magnet.platform.bilibili.settings.cache.actionSave')}
            </button>

            <button
              type="button"
              className="platform-magnet-mini-btn"
              disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
              onClick={onResetPlaybackCachePath}
            >
              {t('magnet.platform.bilibili.settings.cache.actionReset')}
            </button>
          </div>

          <p className="platform-magnet-note">
            {t('magnet.platform.bilibili.settings.cache.customPathHint')}
          </p>

          {playbackCacheSettingsLoading ? (
            <p className="platform-magnet-note">
              {t('magnet.platform.bilibili.settings.cache.stateLoading')}
            </p>
          ) : null}

          {playbackCacheSettingsInfo ? (
            <p className="platform-magnet-note">{playbackCacheSettingsInfo}</p>
          ) : null}

          {playbackCacheSettingsError ? (
            <p className="platform-magnet-error">{playbackCacheSettingsError}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
