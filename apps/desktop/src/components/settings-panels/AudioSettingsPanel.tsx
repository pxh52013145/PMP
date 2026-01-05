import { useAudioEngine } from '../../contexts/AudioEngineContext';
import { useNavigation } from '../../contexts/NavigationContext';
import { useT } from '../../i18n';
import { openVstManagerWindow } from '../../utils/vstManagerWindows';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export function AudioSettingsPanel() {
  const t = useT();
  const { isNativeAvailable } = useAudioEngine();
  const { navigateTo } = useNavigation();
  const isTauri = isTauriRuntime();

  return (
    <div className="audio-engine-card">
      <div className="audio-engine-card-header">
        <div>
          <p className="audio-engine-label">{t('settings.audio.engine.label')}</p>
          <p className="audio-engine-desc">{t('settings.audio.engine.desc')}</p>
        </div>
        <span className="audio-engine-badge">{t('settings.audio.engine.badge.native')}</span>
      </div>

      {!isNativeAvailable && <p className="audio-engine-note">{t('settings.audio.engine.note.nativeUnavailable')}</p>}

      <button className="native-debug-link" onClick={() => navigateTo('native-debug')} disabled={!isNativeAvailable}>
        {t('settings.audio.debug.native')}
      </button>

      <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="native-debug-link" onClick={() => navigateTo('dsp-rack')} disabled={!isNativeAvailable}>
          {t('settings.audio.openDspRack')}
        </button>
        <button
          className="native-debug-link"
          onClick={() =>
            void openVstManagerWindow({ title: t('windows.vst-manager.title') }).catch((error) => {
              console.warn('[AudioSettingsPanel] Failed to open VST3 plugin manager window', error);
            })
          }
          disabled={!isNativeAvailable || !isTauri}
          title={isTauri ? undefined : t('settings.audio.openVstManager.requireTauri')}
        >
          {t('settings.audio.openVstManager')}
        </button>
      </div>
    </div>
  );
}
