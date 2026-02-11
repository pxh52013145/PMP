import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useT } from '../../i18n';
import { openVstManagerWindow } from '../../utils/vstManagerWindows';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export function AudioSettingsPanel() {
  const t = useT();
  const { isNativeAvailable } = useAudioEngine();
  const isTauri = isTauriRuntime();

  return (
    <div className="settings-rows">
      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.audio.engine.label')}</div>
          <div className="settings-row-desc">{t('settings.audio.engine.desc')}</div>
        </div>
        <div className="settings-row-right">
          <span className="settings-row-badge">{t('settings.audio.engine.badge.native')}</span>
        </div>
      </div>

      {!isNativeAvailable && (
        <div className="settings-row">
          <div className="settings-row-left">
            <div className="settings-row-desc">{t('settings.audio.engine.note.nativeUnavailable')}</div>
          </div>
        </div>
      )}

      <div className="settings-row">
        <div className="settings-row-left">
          <div className="settings-row-title">{t('settings.audio.openVstManager')}</div>
          <div className="settings-row-desc">{t('settings.audio.openVstManager.requireTauri')}</div>
        </div>
        <div className="settings-row-right">
          <button
            type="button"
            className="settings-action-btn"
            onClick={() =>
              void openVstManagerWindow({ title: t('windows.vst-manager.title') }).catch((error) => {
                console.warn('[AudioSettingsPanel] Failed to open VST3 plugin manager window', error);
              })
            }
            disabled={!isNativeAvailable || !isTauri}
          >
            {t('common.action.open')}
          </button>
        </div>
      </div>
    </div>
  );
}
