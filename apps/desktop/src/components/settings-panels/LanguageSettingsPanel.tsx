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
    <div className="settings-card">
      <div className="settings-card-header">
        <div>
          <p className="settings-card-label">{t('settings.language.title')}</p>
          <p className="settings-card-desc">{t('settings.language.desc')}</p>
        </div>
        <span className="settings-card-badge">{locale}</span>
      </div>

      <div className="settings-plugin-list" style={{ marginTop: 14 }}>
        {options.map((option) => {
          const isActive = option.id === locale;
          return (
            <label
              key={option.id}
              className="settings-plugin-item"
              style={{
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <div className="settings-plugin-meta">
                <div className="settings-plugin-title">
                  {t(option.titleKey)} <span className="settings-plugin-subtitle">({option.id})</span>
                </div>
                <div className="settings-plugin-tags">
                  {isActive && <span className="settings-plugin-tag">{t('common.tag.current')}</span>}
                </div>
              </div>

              <div className="settings-plugin-actions">
                <input
                  type="radio"
                  name="locale"
                  checked={isActive}
                  disabled={busy}
                  onChange={() => void handleSelect(option.id)}
                />
              </div>
            </label>
          );
        })}
      </div>

      <p className="settings-card-note">{t('settings.language.note')}</p>
    </div>
  );
}

