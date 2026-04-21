import { useCallback, useEffect, useState } from 'react';

import { getTelemetryLogger } from '../../../services/telemetry/TelemetryService';
import {
  getMusicPlatformDurationMs,
  getMusicPlatformNowMs,
  readMusicPlatformDiagnosticErrorMessage,
  warnOnSlowMusicPlatformOperation,
} from '../../../modules/music-platform/platformDiagnostics';
import {
  getMusicTemplatePlaybackQualityState,
  normalizeMusicTemplateQualityKey,
  setMusicTemplatePlaybackQualityPreference,
  type MusicTemplatePlaybackQualityState,
  type MusicTemplateRuntimeTarget,
} from './musicTemplateRuntime';

type Translator = (key: string, params?: Record<string, string | number>) => string;

const telemetry = getTelemetryLogger('magnet.platform', 'useMusicTemplatePlaybackQuality');

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message || fallback;
  }
  if (typeof error === 'string') {
    const message = error.trim();
    return message || fallback;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
}

export interface UseMusicTemplatePlaybackQualityParams {
  controllerVisible: boolean;
  authorized: boolean;
  qualitySupported: boolean;
  musicRuntimeTarget: MusicTemplateRuntimeTarget | null;
  qualityProbeSourceLocator: string | null;
  t: Translator;
}

export interface MusicTemplatePlaybackQualityStateController {
  playbackQualityState: MusicTemplatePlaybackQualityState | null;
  playbackQualityLoading: boolean;
  playbackQualitySaving: boolean;
  playbackQualityError: string | null;
  refreshPlaybackQualityState: (forceRefresh?: boolean) => Promise<void>;
  setPlaybackQualityPreference: (qualityKey: string) => Promise<void>;
}

export function useMusicTemplatePlaybackQuality(
  params: UseMusicTemplatePlaybackQualityParams
): MusicTemplatePlaybackQualityStateController {
  const {
    controllerVisible,
    authorized,
    qualitySupported,
    musicRuntimeTarget,
    qualityProbeSourceLocator,
    t,
  } = params;

  const [playbackQualityState, setPlaybackQualityState] =
    useState<MusicTemplatePlaybackQualityState | null>(null);
  const [playbackQualityLoading, setPlaybackQualityLoading] = useState(false);
  const [playbackQualitySaving, setPlaybackQualitySaving] = useState(false);
  const [playbackQualityError, setPlaybackQualityError] = useState<string | null>(null);

  const refreshPlaybackQualityState = useCallback(
    async (forceRefresh = false) => {
      if (!authorized || !musicRuntimeTarget || !qualitySupported) {
        setPlaybackQualityState(null);
        setPlaybackQualityError(null);
        return;
      }

      const startedAtMs = getMusicPlatformNowMs();
      setPlaybackQualityLoading(true);
      setPlaybackQualityError(null);
      try {
        const nextState = await getMusicTemplatePlaybackQualityState(musicRuntimeTarget, {
          sourceLocator: qualityProbeSourceLocator,
          forceRefresh,
        });
        setPlaybackQualityState(nextState);
        warnOnSlowMusicPlatformOperation({
          logger: telemetry,
          event: 'platform.runtime.music-template.quality-state-load.slow',
          startedAtMs,
          fields: {
            connectorId: musicRuntimeTarget.connectorId,
            instanceIdPresent: Boolean(musicRuntimeTarget.instanceId),
            forceRefresh,
            sourceLocatorPresent: Boolean(qualityProbeSourceLocator),
            optionCount: nextState?.options.length ?? 0,
          },
        });
      } catch (error) {
        telemetry.warn('platform.runtime.music-template.quality-state-load.failed', {
          message: readMusicPlatformDiagnosticErrorMessage(error),
          fields: {
            connectorId: musicRuntimeTarget.connectorId,
            instanceIdPresent: Boolean(musicRuntimeTarget.instanceId),
            forceRefresh,
            sourceLocatorPresent: Boolean(qualityProbeSourceLocator),
            durationMs: getMusicPlatformDurationMs(startedAtMs),
          },
        });
        setPlaybackQualityError(
          toErrorMessage(error, t('magnet.platform.music-template.quality.errorLoad'))
        );
      } finally {
        setPlaybackQualityLoading(false);
      }
    },
    [authorized, musicRuntimeTarget, qualityProbeSourceLocator, qualitySupported, t]
  );

  const setPlaybackQualityPreference = useCallback(
    async (qualityKey: string) => {
      if (!authorized || !musicRuntimeTarget || !qualitySupported) return;

      setPlaybackQualitySaving(true);
      setPlaybackQualityError(null);
      try {
        const nextState = await setMusicTemplatePlaybackQualityPreference(
          musicRuntimeTarget,
          normalizeMusicTemplateQualityKey(qualityKey),
          {
            sourceLocator: qualityProbeSourceLocator,
          }
        );
        setPlaybackQualityState((prev) => nextState ?? prev);
      } catch (error) {
        setPlaybackQualityError(
          toErrorMessage(error, t('magnet.platform.music-template.quality.errorSave'))
        );
      } finally {
        setPlaybackQualitySaving(false);
      }
    },
    [authorized, musicRuntimeTarget, qualityProbeSourceLocator, qualitySupported, t]
  );

  useEffect(() => {
    setPlaybackQualityState(null);
    setPlaybackQualityLoading(false);
    setPlaybackQualitySaving(false);
    setPlaybackQualityError(null);
  }, [musicRuntimeTarget?.connectorId, musicRuntimeTarget?.instanceId]);

  useEffect(() => {
    if (!authorized || !qualitySupported) {
      setPlaybackQualityState(null);
      setPlaybackQualityError(null);
    }
  }, [authorized, qualitySupported]);

  useEffect(() => {
    if (!controllerVisible || !authorized || !qualitySupported) {
      return;
    }
    void refreshPlaybackQualityState();
  }, [
    authorized,
    controllerVisible,
    qualityProbeSourceLocator,
    qualitySupported,
    refreshPlaybackQualityState,
  ]);

  return {
    playbackQualityState,
    playbackQualityLoading,
    playbackQualitySaving,
    playbackQualityError,
    refreshPlaybackQualityState,
    setPlaybackQualityPreference,
  };
}
