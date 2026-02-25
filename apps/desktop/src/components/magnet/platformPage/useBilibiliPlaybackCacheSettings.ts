import { useCallback, useState } from 'react';

import {
  getBilibiliPlaybackCacheSettings,
  pickBilibiliCacheDirectory,
  setBilibiliPlaybackCacheSettings,
  type BilibiliPlaybackCacheSettings,
} from '../../../modules/music-platform';

type Translator = (key: string, params?: Record<string, string | number>) => string;

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

export function useBilibiliPlaybackCacheSettings(t: Translator) {
  const [playbackCacheSettingsLoading, setPlaybackCacheSettingsLoading] = useState(false);
  const [playbackCacheSettingsSaving, setPlaybackCacheSettingsSaving] = useState(false);
  const [playbackCacheSettingsError, setPlaybackCacheSettingsError] = useState<string | null>(null);
  const [playbackCacheSettingsInfo, setPlaybackCacheSettingsInfo] = useState<string | null>(null);
  const [playbackCacheSettings, setPlaybackCacheSettings] =
    useState<BilibiliPlaybackCacheSettings | null>(null);
  const [playbackCachePathDraft, setPlaybackCachePathDraftState] = useState('');

  const setPlaybackCachePathDraft = useCallback((path: string) => {
    setPlaybackCachePathDraftState(path);
    setPlaybackCacheSettingsInfo(null);
  }, []);

  const refreshPlaybackCacheSettings = useCallback(async () => {
    setPlaybackCacheSettingsLoading(true);
    setPlaybackCacheSettingsError(null);
    setPlaybackCacheSettingsInfo(null);
    try {
      const settings = await getBilibiliPlaybackCacheSettings();
      if (!settings) {
        setPlaybackCacheSettingsError(t('magnet.platform.bilibili.settings.cache.errorLoad'));
        return;
      }

      setPlaybackCacheSettings(settings);
      setPlaybackCachePathDraftState(settings.customRootPath ?? '');
    } catch (err) {
      setPlaybackCacheSettingsError(
        toErrorMessage(err, t('magnet.platform.bilibili.settings.cache.errorLoad'))
      );
    } finally {
      setPlaybackCacheSettingsLoading(false);
    }
  }, [t]);

  const handleBrowsePlaybackCachePath = useCallback(async () => {
    const selected = await pickBilibiliCacheDirectory();
    if (!selected) return;

    setPlaybackCachePathDraftState(selected);
    setPlaybackCacheSettingsInfo(null);
  }, []);

  const handleSavePlaybackCachePath = useCallback(async () => {
    if (playbackCacheSettingsSaving) return;

    setPlaybackCacheSettingsSaving(true);
    setPlaybackCacheSettingsError(null);
    setPlaybackCacheSettingsInfo(null);
    try {
      const settings = await setBilibiliPlaybackCacheSettings(playbackCachePathDraft);
      if (!settings) {
        setPlaybackCacheSettingsError(t('magnet.platform.bilibili.settings.cache.errorSave'));
        return;
      }

      setPlaybackCacheSettings(settings);
      setPlaybackCachePathDraftState(settings.customRootPath ?? '');
      setPlaybackCacheSettingsInfo(t('magnet.platform.bilibili.settings.cache.stateSaved'));
    } catch (err) {
      setPlaybackCacheSettingsError(
        toErrorMessage(err, t('magnet.platform.bilibili.settings.cache.errorSave'))
      );
    } finally {
      setPlaybackCacheSettingsSaving(false);
    }
  }, [playbackCachePathDraft, playbackCacheSettingsSaving, t]);

  const handleResetPlaybackCachePath = useCallback(async () => {
    if (playbackCacheSettingsSaving) return;

    setPlaybackCacheSettingsSaving(true);
    setPlaybackCacheSettingsError(null);
    setPlaybackCacheSettingsInfo(null);
    try {
      const settings = await setBilibiliPlaybackCacheSettings(undefined);
      if (!settings) {
        setPlaybackCacheSettingsError(t('magnet.platform.bilibili.settings.cache.errorSave'));
        return;
      }

      setPlaybackCacheSettings(settings);
      setPlaybackCachePathDraftState('');
      setPlaybackCacheSettingsInfo(t('magnet.platform.bilibili.settings.cache.stateReset'));
    } catch (err) {
      setPlaybackCacheSettingsError(
        toErrorMessage(err, t('magnet.platform.bilibili.settings.cache.errorSave'))
      );
    } finally {
      setPlaybackCacheSettingsSaving(false);
    }
  }, [playbackCacheSettingsSaving, t]);

  return {
    playbackCacheSettingsLoading,
    playbackCacheSettingsSaving,
    playbackCacheSettingsError,
    playbackCacheSettingsInfo,
    playbackCacheSettings,
    playbackCachePathDraft,
    setPlaybackCachePathDraft,
    refreshPlaybackCacheSettings,
    handleBrowsePlaybackCachePath,
    handleSavePlaybackCachePath,
    handleResetPlaybackCachePath,
  };
}
