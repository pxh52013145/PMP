import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createDefaultBilibiliPlaybackQualityOptions,
  mergeBilibiliPlaybackQualityOptions,
  normalizeBilibiliPlaybackQualityKey,
  type BilibiliPlaybackQualityOption,
} from '../../../modules/music-platform/bilibiliWorkspaceModel';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';
import { usePersistentSetting } from '../../../modules/storage';
import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import {
  listBilibiliWorkspacePlaybackQualities,
  type BilibiliWorkspaceRuntimeTarget,
} from './bilibiliWorkspaceRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY =
  'music-platform.bilibili.playback-quality-preference';
const telemetry = getTelemetryLogger('magnet.platform', 'useBilibiliPlaybackQuality');

export function resolveBilibiliPlaybackQualityLabelKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  switch (normalized) {
    case 'auto':
      return 'magnet.platform.bilibili.quality.option.auto';
    case '64k':
      return 'magnet.platform.bilibili.quality.option.64k';
    case '132k':
      return 'magnet.platform.bilibili.quality.option.132k';
    case '192k':
      return 'magnet.platform.bilibili.quality.option.192k';
    case 'dolby':
      return 'magnet.platform.bilibili.quality.option.dolby';
    case 'hires':
      return 'magnet.platform.bilibili.quality.option.hires';
    default:
      return 'magnet.platform.bilibili.quality.option.auto';
  }
}

export interface UseBilibiliPlaybackQualityParams {
  controllerVisible: boolean;
  bilibiliRuntimeTarget: BilibiliWorkspaceRuntimeTarget | null;
  bilibiliAuthorized: boolean;
  qualityProbeSourceLocator: string | null;
  t: Translator;
}

export interface BilibiliPlaybackQualityController {
  normalizedPlaybackQualityHint: string;
  preferredPlaybackQualityLabel: string;
  playbackQualityLoading: boolean;
  playbackQualityOptions: BilibiliPlaybackQualityOption[];
  playbackQualityProbeLocator: string | null;
  availablePlaybackQualityLabel: string;
  handleQualityHintChange: (qualityKey: string) => void;
  refreshPlaybackQualityOptions: (sourceLocator: string) => Promise<void>;
}

export function useBilibiliPlaybackQuality(
  params: UseBilibiliPlaybackQualityParams
): BilibiliPlaybackQualityController {
  const {
    controllerVisible,
    bilibiliRuntimeTarget,
    bilibiliAuthorized,
    qualityProbeSourceLocator,
    t,
  } = params;

  const [playbackQualityHint, setPlaybackQualityHint] = usePersistentSetting<string>(
    BILIBILI_PLAYBACK_QUALITY_PREFERENCE_KEY,
    'auto',
    { format: 'string' }
  );
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualityProbeLocator, setPlaybackQualityProbeLocator] = useState<string | null>(null);
  const [playbackQualityOptions, setPlaybackQualityOptions] = useState<BilibiliPlaybackQualityOption[]>(
    () => createDefaultBilibiliPlaybackQualityOptions()
  );

  const normalizedPlaybackQualityHint = useMemo(
    () => normalizeBilibiliPlaybackQualityKey(playbackQualityHint),
    [playbackQualityHint]
  );

  const preferredPlaybackQualityLabel = useMemo(
    () => t(resolveBilibiliPlaybackQualityLabelKey(normalizedPlaybackQualityHint)),
    [normalizedPlaybackQualityHint, t]
  );

  const availablePlaybackQualityLabel = useMemo(() => {
    const availableKeys = playbackQualityOptions.filter((item) => item.available).map((item) => item.key);
    if (availableKeys.length === 0) return t('magnet.platform.bilibili.quality.none');
    return availableKeys
      .map((key) => t(resolveBilibiliPlaybackQualityLabelKey(key)))
      .join(' / ');
  }, [playbackQualityOptions, t]);

  const refreshPlaybackQualityOptions = useCallback(
    async (sourceLocator: string) => {
      const normalizedSourceLocator = sourceLocator.trim();
      if (!normalizedSourceLocator) return;

      const startedAtMs = getMusicPlatformNowMs();
      setPlaybackQualityLoading(true);
      try {
        const options = await listBilibiliWorkspacePlaybackQualities(
          bilibiliRuntimeTarget,
          normalizedSourceLocator
        );
        setPlaybackQualityOptions(mergeBilibiliPlaybackQualityOptions(options));
        setPlaybackQualityProbeLocator(normalizedSourceLocator);
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'platform.runtime.bilibili.quality-options-load.slow',
          startedAtMs,
          fields: {
            connectorId: bilibiliRuntimeTarget?.connectorId ?? null,
            instanceIdPresent: Boolean(bilibiliRuntimeTarget?.instanceId),
            sourceLocatorPresent: true,
            optionCount: options.length,
          },
        });
      } catch (error) {
        telemetry.warn('platform.runtime.bilibili.quality-options-load.failed', {
          message: readMusicPlatformDiagnosticErrorMessage(error),
          fields: {
            connectorId: bilibiliRuntimeTarget?.connectorId ?? null,
            instanceIdPresent: Boolean(bilibiliRuntimeTarget?.instanceId),
            durationMs: getMusicPlatformDurationMs(startedAtMs),
          },
        });
        setPlaybackQualityOptions(createDefaultBilibiliPlaybackQualityOptions());
      } finally {
        setPlaybackQualityLoading(false);
      }
    },
    [bilibiliRuntimeTarget]
  );

  useEffect(() => {
    if (!controllerVisible || !bilibiliAuthorized || !qualityProbeSourceLocator) {
      setPlaybackQualityProbeLocator(null);
      setPlaybackQualityOptions(createDefaultBilibiliPlaybackQualityOptions());
      return;
    }
    if (playbackQualityProbeLocator === qualityProbeSourceLocator) return;
    void refreshPlaybackQualityOptions(qualityProbeSourceLocator);
  }, [
    bilibiliAuthorized,
    controllerVisible,
    playbackQualityProbeLocator,
    qualityProbeSourceLocator,
    refreshPlaybackQualityOptions,
  ]);

  return {
    normalizedPlaybackQualityHint,
    preferredPlaybackQualityLabel,
    playbackQualityLoading,
    playbackQualityOptions,
    playbackQualityProbeLocator,
    availablePlaybackQualityLabel,
    handleQualityHintChange: (qualityKey) => {
      setPlaybackQualityHint(normalizeBilibiliPlaybackQualityKey(qualityKey));
    },
    refreshPlaybackQualityOptions,
  };
}
