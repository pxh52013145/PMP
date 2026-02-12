import React from 'react';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import { useT } from '../../i18n';

function formatMemoryMB(bytes: number): string {
  return `${Math.max(0, bytes) / 1024 / 1024 >= 100
    ? (bytes / 1024 / 1024).toFixed(0)
    : (bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PerformanceControlOverview() {
  const t = useT();
  const { service, snapshot } = usePerformanceControlSettings();

  React.useEffect(() => {
    void service.refreshNow();
  }, [service]);

  const pressureText =
    snapshot.pressure === 'high'
      ? t('settings.performance.overview.pressure.high')
      : snapshot.pressure === 'watch'
        ? t('settings.performance.overview.pressure.watch')
        : t('settings.performance.overview.pressure.normal');

  return (
    <div className="settings-row">
      <div className="settings-row-left">
        <div className="settings-row-title">{t('settings.performance.overview.title')}</div>
        <div className="settings-row-desc">{t('settings.performance.overview.desc')}</div>
        <div className="performance-overview-grid settings-row-meta">
          <div className="performance-overview-item">
            <span className="settings-row-desc">{t('settings.performance.overview.field.pressure')}</span>
            <span className="settings-row-badge">{pressureText}</span>
          </div>
          <div className="performance-overview-item">
            <span className="settings-row-desc">{t('settings.performance.overview.field.quality')}</span>
            <span className="settings-row-badge">
              {t(`settings.performance.quality.level.${snapshot.quality.level}`)}
            </span>
          </div>
          <div className="performance-overview-item">
            <span className="settings-row-desc">{t('settings.performance.overview.field.governanceTier')}</span>
            <span className="settings-row-badge">T{snapshot.governance.tier}</span>
          </div>
          <div className="performance-overview-item">
            <span className="settings-row-desc">{t('settings.performance.overview.field.webview2Private')}</span>
            <span className="settings-row-badge">
              {snapshot.webview2 ? formatMemoryMB(snapshot.webview2.webview2PrivateBytes) : '--'}
            </span>
          </div>
          <div className="performance-overview-item">
            <span className="settings-row-desc">{t('settings.performance.overview.field.webview2Cpu')}</span>
            <span className="settings-row-badge">
              {snapshot.webview2?.webview2CpuPercent != null
                ? `${snapshot.webview2.webview2CpuPercent.toFixed(1)}%`
                : '--'}
            </span>
          </div>
        </div>
      </div>

      <div className="settings-row-right">
        <div className="settings-row-stack">
          <button
            type="button"
            className="settings-action-btn"
            onClick={() => {
              void service.refreshNow();
            }}
          >
            {t('common.action.refresh')}
          </button>
        </div>
      </div>
    </div>
  );
}
