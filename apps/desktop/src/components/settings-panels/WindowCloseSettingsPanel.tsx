import { useMemo } from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useT } from '../../i18n';

type MainWindowCloseBehavior = 'ask' | 'hide' | 'exit';

function normalizeBehavior(value: unknown, fallback: MainWindowCloseBehavior): MainWindowCloseBehavior {
  if (value === 'ask' || value === 'hide' || value === 'exit') return value;
  return fallback;
}

export function WindowCloseSettingsPanel() {
  const t = useT();

  const [magnetBehaviorRaw, setMagnetBehaviorRaw] = usePersistentSetting<string>(
    STORAGE_KEYS.MAIN_WINDOW_CLOSE_BEHAVIOR_MAGNET,
    'ask',
    { format: 'string' }
  );
  const [systemBehaviorRaw, setSystemBehaviorRaw] = usePersistentSetting<string>(
    STORAGE_KEYS.MAIN_WINDOW_CLOSE_BEHAVIOR_SYSTEM,
    'hide',
    { format: 'string' }
  );

  const magnetBehavior = useMemo(() => normalizeBehavior(magnetBehaviorRaw, 'ask'), [magnetBehaviorRaw]);
  const systemBehavior = useMemo(() => normalizeBehavior(systemBehaviorRaw, 'hide'), [systemBehaviorRaw]);

  const behaviorLabel = (behavior: MainWindowCloseBehavior) => {
    if (behavior === 'ask') return t('settings.windowClose.behavior.ask');
    if (behavior === 'hide') return t('settings.windowClose.behavior.hide');
    return t('settings.windowClose.behavior.exit');
  };

  return (
    <>
      <div className="settings-card">
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.windowClose.magnet.label')}</p>
            <p className="settings-card-desc">{t('settings.windowClose.magnet.desc')}</p>
          </div>
          <span className="settings-card-badge">{behaviorLabel(magnetBehavior)}</span>
        </div>

        <div className="settings-toggle">
          <button
            type="button"
            data-active={magnetBehavior === 'ask'}
            onClick={() => setMagnetBehaviorRaw('ask')}
          >
            {t('settings.windowClose.behavior.ask')}
          </button>
          <button
            type="button"
            data-active={magnetBehavior === 'hide'}
            onClick={() => setMagnetBehaviorRaw('hide')}
          >
            {t('settings.windowClose.behavior.hide')}
          </button>
          <button
            type="button"
            data-active={magnetBehavior === 'exit'}
            onClick={() => setMagnetBehaviorRaw('exit')}
          >
            {t('settings.windowClose.behavior.exit')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.windowClose.magnet.note')}</p>
      </div>

      <div className="settings-card" style={{ marginTop: 16 }}>
        <div className="settings-card-header">
          <div>
            <p className="settings-card-label">{t('settings.windowClose.system.label')}</p>
            <p className="settings-card-desc">{t('settings.windowClose.system.desc')}</p>
          </div>
          <span className="settings-card-badge">{behaviorLabel(systemBehavior)}</span>
        </div>

        <div className="settings-toggle">
          <button
            type="button"
            data-active={systemBehavior === 'ask'}
            onClick={() => setSystemBehaviorRaw('ask')}
          >
            {t('settings.windowClose.behavior.ask')}
          </button>
          <button
            type="button"
            data-active={systemBehavior === 'hide'}
            onClick={() => setSystemBehaviorRaw('hide')}
          >
            {t('settings.windowClose.behavior.hide')}
          </button>
          <button
            type="button"
            data-active={systemBehavior === 'exit'}
            onClick={() => setSystemBehaviorRaw('exit')}
          >
            {t('settings.windowClose.behavior.exit')}
          </button>
        </div>

        <p className="settings-card-note">{t('settings.windowClose.system.note')}</p>
      </div>
    </>
  );
}
