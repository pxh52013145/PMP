import { useMemo } from 'react';
import { usePersistentSetting } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useT } from '../../i18n';
import { PmpChoiceButton, PmpSegmented } from '../primitives';

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

  return (
    <div className="settings-audio-panel settings-window-close-panel">
      <div className="settings-audio-block settings-window-close-block">
        <div className="settings-param-divider settings-param-divider--compact" />

        <div className="settings-window-close-body">
          <div className="settings-window-close-copy">
            <div className="settings-param-head settings-window-close-head">
              <p className="settings-param-eyebrow">MAGNET CLOSE</p>
              <h3 className="settings-param-title">{t('settings.windowClose.magnet.label')}</h3>
              <p className="settings-param-subtitle">{t('settings.windowClose.magnet.desc')}</p>
            </div>
            <p className="settings-card-note settings-window-close-note">{t('settings.windowClose.magnet.note')}</p>
          </div>

          <PmpSegmented
            className="settings-window-close-controls"
            surfaceId="primitive.segmented.choice"
            role="radiogroup"
            aria-label={t('settings.windowClose.magnet.label')}
          >
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={magnetBehavior === 'ask'}
              onClick={() => setMagnetBehaviorRaw('ask')}
            >
              {t('settings.windowClose.behavior.ask')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={magnetBehavior === 'hide'}
              onClick={() => setMagnetBehaviorRaw('hide')}
            >
              {t('settings.windowClose.behavior.hide')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={magnetBehavior === 'exit'}
              onClick={() => setMagnetBehaviorRaw('exit')}
            >
              {t('settings.windowClose.behavior.exit')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>

      </div>

      <div className="settings-audio-block settings-window-close-block">
        <div className="settings-param-divider settings-param-divider--compact" />

        <div className="settings-window-close-body">
          <div className="settings-window-close-copy">
            <div className="settings-param-head settings-window-close-head">
              <p className="settings-param-eyebrow">SYSTEM CLOSE</p>
              <h3 className="settings-param-title">{t('settings.windowClose.system.label')}</h3>
              <p className="settings-param-subtitle">{t('settings.windowClose.system.desc')}</p>
            </div>
            <p className="settings-card-note settings-window-close-note">{t('settings.windowClose.system.note')}</p>
          </div>

          <PmpSegmented
            className="settings-window-close-controls"
            surfaceId="primitive.segmented.choice"
            role="radiogroup"
            aria-label={t('settings.windowClose.system.label')}
          >
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={systemBehavior === 'ask'}
              onClick={() => setSystemBehaviorRaw('ask')}
            >
              {t('settings.windowClose.behavior.ask')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={systemBehavior === 'hide'}
              onClick={() => setSystemBehaviorRaw('hide')}
            >
              {t('settings.windowClose.behavior.hide')}
            </PmpChoiceButton>
            <PmpChoiceButton
              type="button"
              className="settings-choice-btn"
              active={systemBehavior === 'exit'}
              onClick={() => setSystemBehaviorRaw('exit')}
            >
              {t('settings.windowClose.behavior.exit')}
            </PmpChoiceButton>
          </PmpSegmented>
        </div>

      </div>
    </div>
  );
}
