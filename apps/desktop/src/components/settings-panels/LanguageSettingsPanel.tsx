import { useCallback, useMemo, useState } from 'react';
import { useLocale, useT, type Locale } from '../../i18n';
import { broadcastDataUpdate, STORAGE_KEYS, TAURI_EVENTS } from '../../utils/windowCommunication';

type LocaleOption = {
  id: Locale;
  titleKey: string;
};

const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { id: 'zh-CN', titleKey: 'settings.language.option.zh-CN.title' },
  { id: 'en-US', titleKey: 'settings.language.option.en-US.title' },
];

export function LanguageSettingsPanel() {
  const locale = useLocale();
  const t = useT();
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => LOCALE_OPTIONS, []);

  const handleSelect = useCallback(
    async (nextLocale: Locale) => {
      if (busy) return;
      if (nextLocale === locale) return;

      setBusy(true);
      try {
        await broadcastDataUpdate(STORAGE_KEYS.LOCALE, nextLocale, TAURI_EVENTS.LOCALE_UPDATED);
      } finally {
        setBusy(false);
      }
    },
    [busy, locale]
  );

  return (
    <div className="settings-audio-panel">
      <div className="settings-audio-block settings-language-block">
        <div className="settings-param-divider settings-param-divider--compact" />

        <div className="settings-language-body">
          <div className="settings-language-copy">
            <div className="settings-param-head settings-language-head">
              <p className="settings-param-eyebrow">SYSTEM LOCALE</p>
              <h3 className="settings-param-title">{t('settings.language.title')}</h3>
              <p className="settings-param-subtitle">{t('settings.language.desc')}</p>
            </div>

            <p className="settings-card-note settings-language-note">{t('settings.language.note')}</p>
          </div>

          <div
            className="settings-language-controls"
            role="radiogroup"
            aria-label={t('settings.language.title')}
          >
            {options.map((option) => {
              const isActive = option.id === locale;
              return (
                <button
                  key={option.id}
                  type="button"
                  className="settings-choice-btn"
                  data-active={isActive}
                  disabled={busy}
                  onClick={() => void handleSelect(option.id)}
                  title={t(option.titleKey)}
                  aria-pressed={isActive}
                >
                  {t(option.titleKey)}
                </button>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
