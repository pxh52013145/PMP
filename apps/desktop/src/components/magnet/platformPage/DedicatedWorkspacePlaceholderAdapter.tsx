type Translator = (key: string, params?: Record<string, string | number>) => string;

export interface DedicatedWorkspacePlaceholderToolbarProps {
  t: Translator;
}

export interface DedicatedWorkspacePlaceholderProps {
  connectorDisplayName: string;
  t: Translator;
}

export function DedicatedWorkspacePlaceholderToolbar(
  props: DedicatedWorkspacePlaceholderToolbarProps
): JSX.Element {
  const { t } = props;
  return (
    <div className="platform-magnet-bv-top-search">
      <span className="platform-magnet-panel-tag">{t('magnet.platform-login.status.comingSoon')}</span>
    </div>
  );
}

export function DedicatedWorkspacePlaceholderAdapter(
  props: DedicatedWorkspacePlaceholderProps
): JSX.Element {
  const { connectorDisplayName, t } = props;

  return (
    <div className="platform-magnet-generic">
      <section className="platform-magnet-panel">
        <div className="platform-magnet-panel-header">
          <h4>{connectorDisplayName}</h4>
          <span className="platform-magnet-panel-tag">{t('magnet.platform-login.status.comingSoon')}</span>
        </div>
        <p className="platform-magnet-panel-desc">{t('magnet.platform.panel.search.desc')}</p>
      </section>
    </div>
  );
}
