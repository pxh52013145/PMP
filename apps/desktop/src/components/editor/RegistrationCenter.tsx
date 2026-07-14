import { lazy, Suspense, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ArrowLeft, PackageOpen, X } from 'lucide-react';
import { useT } from '../../i18n';
import type { Magnet } from '../../types/pixel';
import type { PluginRegistrationMagnetContext } from '../settings-panels/PluginsSettingsPanel';
import { closeEditorWindow } from '../../utils/editorWindows';
import '../pages/SettingsPage.css';
import './RegistrationCenter.css';

const PluginsRegistrationPanelLazy = lazy(async () => ({
  default: (await import('../settings-panels/PluginsSettingsPanel')).PluginsSettingsPanel,
}));

const AppearanceWorkbenchLazy = lazy(async () => ({
  default: (await import('./ThemeEditor')).ThemeEditor,
}));

type RegistrationCenterView = 'registry' | 'appearance';

export type RegistrationCenterProps = {
  magnetLibrary: Magnet[];
  activeMagnetIds: Set<string>;
  setMagnetLibrary: Dispatch<SetStateAction<Magnet[]>>;
  activateMagnet: (magnetId: string) => void | Promise<void>;
  deactivateMagnet: (magnetId: string) => void | Promise<void>;
  applyRendererBindings: (
    bindings: Array<{ magnetId: string; rendererId: string }>
  ) => Promise<{ updated: number }>;
};

export function RegistrationCenter({
  magnetLibrary,
  activeMagnetIds,
  setMagnetLibrary,
  activateMagnet,
  deactivateMagnet,
  applyRendererBindings,
}: RegistrationCenterProps) {
  const t = useT();
  const [view, setView] = useState<RegistrationCenterView>('registry');
  const magnetContext = useMemo<PluginRegistrationMagnetContext>(
    () => ({
      magnetLibrary,
      activeMagnetIds,
      setMagnetLibrary,
      activateMagnet,
      deactivateMagnet,
    }),
    [activeMagnetIds, activateMagnet, deactivateMagnet, magnetLibrary, setMagnetLibrary]
  );

  return (
    <div className="registration-center">
      <div className="editor-window-header registration-center-header" data-tauri-drag-region>
        <div className="registration-center-brand" data-tauri-drag-region>
          <span className="registration-center-brand-icon" aria-hidden="true">
            <PackageOpen size={17} />
          </span>
          <span className="window-title" data-tauri-drag-region>
            {view === 'registry'
              ? t('windows.editor.registration.title')
              : t('editor.registration.appearanceWorkbench.title')}
          </span>
        </div>

        <div className="registration-center-window-actions">
          {view === 'appearance' ? (
            <button
              type="button"
              className="registration-center-close"
              onClick={() => setView('registry')}
              title={t('common.action.back')}
              aria-label={t('common.action.back')}
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="registration-center-close"
            onClick={() => void closeEditorWindow('registration')}
            title={t('common.action.close')}
            aria-label={t('common.action.close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <main className="registration-center-content">
        <Suspense fallback={<div className="registration-center-loading" aria-hidden="true" />}>
          {view === 'registry' ? (
            <PluginsRegistrationPanelLazy
              magnetContext={magnetContext}
              embeddedInRegistrationCenter
              onOpenAppearanceWorkbench={() => setView('appearance')}
            />
          ) : (
            <AppearanceWorkbenchLazy
              magnetLibrary={magnetLibrary}
              applyRendererBindings={applyRendererBindings}
              embedded
              contractImportEnabled={false}
            />
          )}
        </Suspense>
      </main>
    </div>
  );
}
