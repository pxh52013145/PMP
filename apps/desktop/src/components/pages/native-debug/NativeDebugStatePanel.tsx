type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

type NativeDebugStatePanelProps = {
  t: TranslateFn;
  displayedDiagnostics: string;
  displayedState: string;
  logs: string[];
};

export function NativeDebugStatePanel({
  t,
  displayedDiagnostics,
  displayedState,
  logs,
}: NativeDebugStatePanelProps) {
  return (
    <section className="native-debug-card native-debug-state-panel">
      <header>
        <p className="section-label">{t('pages.native-debug.section.diagnostics')}</p>
        <h3>{t('pages.native-debug.state.diagnosticsTitle')}</h3>
      </header>
      <pre className="native-debug-state">{displayedDiagnostics}</pre>
      <header>
        <p className="section-label">{t('pages.native-debug.section.state')}</p>
        <h3>{t('pages.native-debug.state.snapshotTitle')}</h3>
      </header>
      <pre className="native-debug-state">{displayedState}</pre>
      <div className="native-debug-logs">
        <p className="section-label">{t('pages.native-debug.section.logs')}</p>
        <ul>
          {logs.length === 0 && <li className="log-empty">{t('pages.native-debug.logs.empty')}</li>}
          {logs.map((log, idx) => (
            <li key={`${log}-${idx}`}>{log}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
