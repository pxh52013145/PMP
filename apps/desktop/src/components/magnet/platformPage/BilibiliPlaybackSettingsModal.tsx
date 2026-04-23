import type { BilibiliPlaybackQualityOption } from '../../../modules/music-platform/bilibiliWorkspaceModel';
import { PmpButton, PmpDialog } from '../../primitives';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type BilibiliPlaybackSettingsContentProps = {
  t: Translator;
  bilibiliAuthorized: boolean;
  normalizedPlaybackQualityHint: string;
  playbackQualityOptions: BilibiliPlaybackQualityOption[];
  playbackQualityLoading: boolean;
  qualityProbeSourceLocator: string | null;
  availablePlaybackQualityLabel: string;
  qualityLabelForKey: (qualityKey: string, qualityLabel?: string | null) => string;
  onQualityHintChange: (qualityKey: string) => void;
  onRefreshQualityOptions: () => void;
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
    playbackQualityOptions,
    playbackQualityLoading,
    qualityProbeSourceLocator,
    availablePlaybackQualityLabel,
    qualityLabelForKey,
    onQualityHintChange,
    onRefreshQualityOptions,
  } = props;
  const selectedOption =
    playbackQualityOptions.find(
      (option) => option.key.trim().toLowerCase() === normalizedPlaybackQualityHint.toLowerCase()
    ) ?? null;

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
            const label = qualityLabelForKey(optionKey, option.label);
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
          quality: qualityLabelForKey(normalizedPlaybackQualityHint, selectedOption?.label),
          available: availablePlaybackQualityLabel,
        })}
      </p>
      <p className="platform-magnet-note">{t('magnet.platform.bilibili.quality.fallbackHint')}</p>
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
