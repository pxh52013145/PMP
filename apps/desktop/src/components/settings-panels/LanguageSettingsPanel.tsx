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
    <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.language.title')}</div>
          <div className="settings-row-desc">{t('settings.language.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{locale}</span>
          <div className="settings-toggle settings-toggle--compact" aria-disabled={busy}>
            {options.map((option) => {
              const isActive = option.id === locale;
              return (
                <button
                  key={option.id}
                  type="button"
                  data-active={isActive}
                  disabled={busy}
                  onClick={() => void handleSelect(option.id)}
                  title={t(option.titleKey)}
                >
                  {t(option.titleKey)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-desc">{t('settings.language.note')}</div>
        </div>
      </div>
    </div>
  );
}
