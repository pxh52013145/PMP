import { useCallback, useMemo, useState } from 'react';

import { useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton } from '../primitives';
import {
  createDesktopLyricsFontConfig,
  removeDesktopLyricsFontFile,
  useDesktopLyricsFontConfig,
} from '../../modules/desktopLyricsFonts';

const telemetry = getTelemetryLogger('settings', 'DesktopLyricsFontSettingsPanel');

type DesktopLyricsFontImportResult = {
  destPath: string;
  sourceBytes?: number;
  displayName?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getFileNameFromPath(path: string): string {
  const normalized = path.trim();
  if (!normalized) return 'font';
  return normalized.split(/[\\/]/).pop() ?? normalized;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function DesktopLyricsFontSettingsPanel() {
  const t = useT();
  const isDesktopRuntime = useMemo(() => isTauriRuntime(), []);
  const { fontConfig, setFontConfig, fontFamily, fontStatus, fontError } = useDesktopLyricsFontConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const badge = fontConfig ? t('settings.desktopLyricsFont.badge.custom') : t('settings.desktopLyricsFont.badge.default');
  const previewText = t('settings.desktopLyricsFont.preview.sample');

  const statusText = useMemo(() => {
    if (fontStatus === 'loading') {
      return t('settings.desktopLyricsFont.status.loading');
    }
    if (fontStatus === 'loaded') {
      return t('settings.desktopLyricsFont.status.loaded');
    }
    if (fontStatus === 'error' && fontError) {
      return t('settings.desktopLyricsFont.status.error', { message: fontError });
    }
    return null;
  }, [fontError, fontStatus, t]);

  const handleImportFont = useCallback(async () => {
    if (busy) return;
    if (!isDesktopRuntime) {
      setError(t('settings.desktopLyricsFont.error.desktopOnly'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const dialog = await import('@tauri-apps/api/dialog');
      const selected = await dialog.open({
        multiple: false,
        filters: [
          {
            name: t('settings.desktopLyricsFont.fileFilter.name'),
            extensions: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
          },
        ],
      });

      if (!selected || typeof selected !== 'string') {
        return;
      }

      const importResult = await invokeWithTelemetry<DesktopLyricsFontImportResult>(
        'desktop_lyrics_import_font',
        { sourcePath: selected },
        {
          moduleId: 'settings',
          component: 'DesktopLyricsFontSettingsPanel',
          event: 'settings.desktop-lyrics-font.import',
        }
      );

      const fileName = getFileNameFromPath(selected);
      const nextFont = createDesktopLyricsFontConfig({
        path: importResult.destPath,
        fileName,
        displayName: importResult.displayName,
        sourceBytes: importResult.sourceBytes,
      });
      const previousFont = fontConfig;
      setFontConfig(nextFont);

      if (previousFont?.path && previousFont.path !== nextFont.path) {
        await removeDesktopLyricsFontFile(previousFont.path);
      }
    } catch (importError) {
      const message = getErrorMessage(importError);
      telemetry.error('settings.desktop-lyrics-font.import.failed', {
        message,
      });
      setError(t('settings.desktopLyricsFont.error.importFailed', { message }));
    } finally {
      setBusy(false);
    }
  }, [busy, fontConfig, isDesktopRuntime, setFontConfig, t]);

  const handleResetFont = useCallback(async () => {
    if (busy) return;
    if (!fontConfig) return;
    if (!isDesktopRuntime) {
      setError(t('settings.desktopLyricsFont.error.desktopOnly'));
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const currentFont = fontConfig;
      setFontConfig(null);
      await removeDesktopLyricsFontFile(currentFont.path);
    } catch (resetError) {
      const message = getErrorMessage(resetError);
      telemetry.warn('settings.desktop-lyrics-font.reset.failed', {
        message,
      });
      setError(t('settings.desktopLyricsFont.error.resetFailed', { message }));
    } finally {
      setBusy(false);
    }
  }, [busy, fontConfig, isDesktopRuntime, setFontConfig, t]);

  return (
    <div className="settings-audio-panel">
      <div className="settings-audio-block">
        <div className="settings-param-divider settings-param-divider--compact" />

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div className="settings-param-head" style={{ flex: 1, minWidth: 0 }}>
            <p className="settings-param-eyebrow">DESKTOP LYRICS FONT</p>
            <h3 className="settings-param-title">{t('settings.desktopLyricsFont.title')}</h3>
            <p className="settings-param-subtitle">{t('settings.desktopLyricsFont.desc')}</p>
          </div>
          <span className="settings-card-badge" style={{ marginTop: '2px', flexShrink: 0 }}>
            {badge}
          </span>
        </div>

        <p className="settings-card-note">{t('settings.desktopLyricsFont.note')}</p>
        {!isDesktopRuntime ? (
          <p className="settings-card-note">{t('settings.desktopLyricsFont.note.desktopOnly')}</p>
        ) : null}

        <div
          style={{
            marginTop: '10px',
            padding: '14px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(0, 0, 0, 0.18)',
            borderRadius: '12px',
          }}
        >
          <div
            style={{
              marginBottom: '8px',
              fontSize: '11px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'rgba(255, 255, 255, 0.55)',
            }}
          >
            {t('settings.desktopLyricsFont.preview.label')}
          </div>
          <div
            style={{
              fontFamily,
              fontSize: '18px',
              lineHeight: '1.35',
              color: 'rgba(245, 250, 255, 0.94)',
              wordBreak: 'break-word',
            }}
          >
            {previewText}
          </div>
        </div>

        <div className="settings-card-note" style={{ marginTop: '10px' }}>
          {fontConfig
            ? t('settings.desktopLyricsFont.current.custom', {
                label: fontConfig.displayName,
                fileName: fontConfig.fileName,
              })
            : t('settings.desktopLyricsFont.current.default')}
        </div>
        {fontConfig?.sourceBytes ? (
          <div className="settings-card-note">
            {t('settings.desktopLyricsFont.fileInfo', {
              size: formatBytes(fontConfig.sourceBytes),
              fileName: fontConfig.fileName,
            })}
          </div>
        ) : null}
        {statusText ? <div className="settings-card-note">{statusText}</div> : null}
        {error ? <div className="settings-inline-error">{error}</div> : null}

        <div className="settings-section-controls settings-section-controls--stretch">
          <PmpButton
            type="button"
            className="settings-action-btn"
            variant="default"
            onClick={() => void handleImportFont()}
            disabled={busy || !isDesktopRuntime}
          >
            {t('settings.desktopLyricsFont.action.import')}
          </PmpButton>
          <PmpButton
            type="button"
            className="settings-danger-btn"
            variant="danger"
            onClick={() => void handleResetFont()}
            disabled={busy || !fontConfig || !isDesktopRuntime}
          >
            {t('settings.desktopLyricsFont.action.reset')}
          </PmpButton>
        </div>
      </div>
    </div>
  );
}
