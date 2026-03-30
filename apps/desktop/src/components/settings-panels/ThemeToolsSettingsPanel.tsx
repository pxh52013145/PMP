import { useCallback, useMemo, useState } from 'react';
import { useKernel } from '../../contexts/KernelContext';
import type { WindowContribution } from '../../contracts/contributions';
import { useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import { PmpButton, PmpCard } from '../primitives';

const telemetry = getTelemetryLogger('settings', 'ThemeToolsSettingsPanel');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ThemeToolsSettingsPanel() {
  const kernel = useKernel();
  const t = useT();
  const isTauri = useMemo(() => isTauriRuntime(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themeWindow = kernel.contributions.get<WindowContribution>('window', 'editor:theme');
  const unavailableReason = !isTauri
    ? t('settings.themeTools.desktopOnly')
    : !themeWindow
      ? t('settings.themeTools.error.windowMissing')
      : null;

  const handleOpen = useCallback(async () => {
    if (busy) return;

    setError(null);

    if (!isTauri) {
      setError(t('settings.themeTools.desktopOnly'));
      return;
    }

    const contribution = kernel.contributions.get<WindowContribution>('window', 'editor:theme');
    if (!contribution) {
      const message = t('settings.themeTools.error.windowMissing');
      telemetry.warn('settings.theme_tools.window.missing');
      setError(message);
      return;
    }

    setBusy(true);
    telemetry.info('settings.theme_tools.open.requested');

    try {
      await contribution.open();
      telemetry.info('settings.theme_tools.open.completed');
    } catch (openError) {
      const message = getErrorMessage(openError);
      telemetry.error('settings.theme_tools.open.failed', {
        message,
      });
      setError(t('settings.themeTools.error.openFailed', { message }));
    } finally {
      setBusy(false);
    }
  }, [busy, isTauri, kernel.contributions, t]);

  return (
    <PmpCard className="settings-card" surfaceId="primitive.card.settings">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.panels.themeTools.title')}</p>
          <p className="settings-card-desc">{t('settings.panels.themeTools.desc')}</p>
        </div>
      </div>

      <div className="settings-param-divider settings-param-divider--compact" />

      <p className="settings-card-note">{t('settings.themeTools.note')}</p>

      <div className="settings-section-controls settings-section-controls--stretch">
        <PmpButton
          type="button"
          className="settings-action-btn"
          variant="default"
          onClick={() => void handleOpen()}
          disabled={busy || unavailableReason !== null}
        >
          {busy ? t('settings.themeTools.opening') : t('settings.themeTools.open')}
        </PmpButton>
      </div>

      {unavailableReason && <p className="settings-card-note">{unavailableReason}</p>}
      {error && <p className="settings-card-note">{error}</p>}
    </PmpCard>
  );
}
