import type {
  BilibiliPlaybackCacheSettings,
  BilibiliPlaybackQualityOption,
} from '../../../modules/music-platform';
import { PmpButton, PmpDialog } from '../../primitives';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type BilibiliPlaybackSettingsContentProps = {
  t: Translator;
  bilibiliAuthorized: boolean;
  normalizedPlaybackQualityHint: string;
  normalizedBilibiliThemePreference: string;
  playbackQualityOptions: BilibiliPlaybackQualityOption[];
  playbackQualityLoading: boolean;
  qualityProbeSourceLocator: string | null;
  availablePlaybackQualityLabel: string;
  qualityLabelForKey: (qualityKey: string) => string;
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

type BilibiliPlaybackSettingsModalProps = BilibiliPlaybackSettingsContentProps & {
  open: boolean;
  onClose: () => void;
};

export function BilibiliPlaybackSettingsContent(props: BilibiliPlaybackSettingsContentProps) {
  const {
    t,
    bilibiliAuthorized,
    normalizedPlaybackQualityHint,
    normalizedBilibiliThemePreference,
    playbackQualityOptions,
    playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel,
    qualityLabelForKey,
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

  return (
    <>
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
        <PmpButton
          type="button"
          className="platform-magnet-mini-btn"
          variant="default"
          disabled={!qualityProbeSourceLocator || playbackQualityLoading}
          onClick={onRefreshQualityOptions}
        >
          {playbackQualityLoading
            ? t('magnet.platform.bilibili.quality.actionRefreshing')
            : t('magnet.platform.bilibili.quality.actionRefresh')}
        </PmpButton>
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
          <p className="platform-magnet-settings-path-value">{playbackCacheSettings?.effectiveRootPath || '-'}</p>
        </div>

        <div className="platform-magnet-settings-path-item">
          <span className="platform-magnet-settings-path-label">
            {t('magnet.platform.bilibili.settings.cache.defaultPath')}
          </span>
          <p className="platform-magnet-settings-path-value">{playbackCacheSettings?.defaultRootPath || '-'}</p>
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

          <PmpButton
            type="button"
            className="platform-magnet-mini-btn"
            variant="default"
            disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
            onClick={onBrowsePlaybackCachePath}
          >
            {t('magnet.platform.bilibili.settings.cache.actionBrowse')}
          </PmpButton>
        </div>

        <div className="platform-magnet-settings-actions">
          <PmpButton
            type="button"
            className="platform-magnet-mini-btn"
            variant="primary"
            disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
            onClick={onSavePlaybackCachePath}
          >
            {playbackCacheSettingsSaving
              ? t('magnet.platform.bilibili.settings.cache.stateSaving')
              : t('magnet.platform.bilibili.settings.cache.actionSave')}
          </PmpButton>

          <PmpButton
            type="button"
            className="platform-magnet-mini-btn"
            variant="ghost"
            disabled={playbackCacheSettingsLoading || playbackCacheSettingsSaving}
            onClick={onResetPlaybackCachePath}
          >
            {t('magnet.platform.bilibili.settings.cache.actionReset')}
          </PmpButton>
        </div>

        <p className="platform-magnet-note">
          {t('magnet.platform.bilibili.settings.cache.customPathHint')}
        </p>

        {playbackCacheSettingsLoading ? (
          <p className="platform-magnet-note">{t('magnet.platform.bilibili.settings.cache.stateLoading')}</p>
        ) : null}

        {playbackCacheSettingsInfo ? <p className="platform-magnet-note">{playbackCacheSettingsInfo}</p> : null}

        {playbackCacheSettingsError ? (
          <p className="platform-magnet-error">{playbackCacheSettingsError}</p>
        ) : null}
      </div>
    </>
  );
}

export function BilibiliPlaybackSettingsModal(props: BilibiliPlaybackSettingsModalProps) {
  const { open, t, onClose, ...contentProps } = props;

  return (
    <PmpDialog
      open={open}
      title={<h4>{t('magnet.platform.bilibili.settings.title')}</h4>}
      overlaySurfaceId="overlay.modal"
      dialogSurfaceId="primitive.dialog.default"
      overlayClassName="platform-magnet-settings-overlay"
      className="platform-magnet-settings-modal"
      headerClassName="platform-magnet-panel-header"
      onClose={onClose}
      headerActions={
        <PmpButton type="button" className="platform-magnet-mini-btn" variant="ghost" onClick={onClose}>
          {t('common.action.done')}
        </PmpButton>
      }
    >
      <BilibiliPlaybackSettingsContent t={t} {...contentProps} />
    </PmpDialog>
  );
}
