import { PmpButton } from '../../primitives';
import type { MusicTemplatePlaybackQualityState } from './musicTemplateRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

export type MusicTemplatePlaybackSettingsContentProps = {
  t: Translator;
  authorized: boolean;
  qualitySupported?: boolean;
  qualityLoading: boolean;
  qualitySaving: boolean;
  qualityError: string | null;
  qualityState: MusicTemplatePlaybackQualityState | null;
  qualityLabelForKey: (qualityKey: string, qualityLabel?: string | null) => string;
  onQualityHintChange: (qualityKey: string) => void;
  onRefreshQualityState: () => void;
};

export function MusicTemplatePlaybackSettingsContent(
  props: MusicTemplatePlaybackSettingsContentProps
): JSX.Element {
  const {
    t,
    authorized,
    qualitySupported = true,
    qualityLoading,
    qualitySaving,
    qualityError,
    qualityState,
    qualityLabelForKey,
    onQualityHintChange,
    onRefreshQualityState,
  } = props;

  const options = qualityState?.options ?? [{ key: 'auto', label: '', available: true }];
  const currentKey = qualityState?.currentKey?.trim() || 'auto';
  const currentOption =
    options.find((option) => option.key.trim().toLowerCase() === currentKey.toLowerCase()) ?? null;
  const currentSelectValue = currentOption?.key.trim() || currentKey;
  const currentLabel = qualityLabelForKey(
    currentSelectValue,
    qualityState?.currentLabel ?? currentOption?.label
  );

  return (
    <div className="platform-magnet-settings-section">
      {qualitySupported ? (
        <>
          <h5 className="platform-magnet-settings-section-title">
            {t('magnet.platform.music-template.quality.title')}
          </h5>

          <div className="platform-magnet-settings-row">
            <select
              value={currentSelectValue}
              disabled={!authorized || qualityLoading || qualitySaving}
              onChange={(event) => {
                onQualityHintChange(event.target.value);
              }}
            >
              {options.map((option) => {
                const optionKey = option.key.trim();
                return (
                  <option key={option.key} value={optionKey} disabled={option.available === false}>
                    {qualityLabelForKey(optionKey, option.label)}
                  </option>
                );
              })}
            </select>

            <PmpButton
              type="button"
              className="platform-magnet-mini-btn"
              variant="default"
              disabled={!authorized || qualityLoading || qualitySaving}
              onClick={onRefreshQualityState}
            >
              {qualityLoading
                ? t('magnet.platform.music-template.quality.actionRefreshing')
                : t('magnet.platform.music-template.quality.actionRefresh')}
            </PmpButton>
          </div>

          <p className="platform-magnet-note">
            {t('magnet.platform.music-template.quality.current', {
              quality: currentLabel,
            })}
          </p>
          <p className="platform-magnet-note">
            {t('magnet.platform.music-template.quality.fallbackHint')}
          </p>

          {qualityError ? <p className="platform-magnet-error">{qualityError}</p> : null}
        </>
      ) : null}
    </div>
  );
}
