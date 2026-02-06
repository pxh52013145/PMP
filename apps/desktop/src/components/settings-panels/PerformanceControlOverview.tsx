import React from 'react';
import { useKernel } from '../../contexts/KernelContext';
import { usePerformanceControlSettings } from '../../contexts/usePerformanceControlSettings';
import { useT } from '../../i18n';

function formatMemoryMB(bytes: number): string {
  return `${Math.max(0, bytes) / 1024 / 1024 >= 100
    ? (bytes / 1024 / 1024).toFixed(0)
    : (bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function PerformanceControlOverview() {
  const t = useT();
  const kernel = useKernel();
  const { service } = usePerformanceControlSettings();

  const [snapshot, setSnapshot] = React.useState(() => service.getSnapshot());

  React.useEffect(() => {
    setSnapshot(service.getSnapshot());
    return kernel.events.on('performance-control/changed', (next) => {
      setSnapshot(next);
    });
  }, [kernel.events, service]);

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
    <div className="settings-row" style={{ alignItems: 'flex-start' }}>
      <div className="settings-row-left" style={{ width: '100%' }}>
        <div className="settings-row-title">{t('settings.performance.overview.title')}</div>
        <div className="settings-row-desc">{t('settings.performance.overview.desc')}</div>
        <div className="performance-overview-grid" style={{ marginTop: 10 }}>
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
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
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
