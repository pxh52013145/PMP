import { memo } from 'react';
import { useT } from '../../i18n';
import './EditorHelp.css';

export const EditorHelp = memo(function EditorHelp() {
  const t = useT();

  return (
    <div className="editor-help">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.help.title')}
        </span>
      </div>
      {/* 内容区域 */}
      <div className="editor-window-content">
        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.features.title')}</h3>
          <div className="help-content">
            <p>{t('editor.help.section.features.desc')}</p>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.basic.title')}</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-icon">📍</div>
              <div className="help-text">
                <strong>{t('editor.help.basic.selectPixel.title')}</strong>
                <p>{t('editor.help.basic.selectPixel.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">🎯</div>
              <div className="help-text">
                <strong>{t('editor.help.basic.moveMagnet.title')}</strong>
                <p>{t('editor.help.basic.moveMagnet.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">🗑️</div>
              <div className="help-text">
                <strong>{t('editor.help.basic.deleteMagnet.title')}</strong>
                <p>{t('editor.help.basic.deleteMagnet.desc')}</p>
              </div>
            </div>

          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.pixelColors.title')}</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-color-indicator free" />
              <div className="help-text">
                <strong>{t('editor.help.pixelColors.green.title')}</strong>
                <p>{t('editor.help.pixelColors.green.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator occupied" />
              <div className="help-text">
                <strong>{t('editor.help.pixelColors.red.title')}</strong>
                <p>{t('editor.help.pixelColors.red.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator selected" />
              <div className="help-text">
                <strong>{t('editor.help.pixelColors.blue.title')}</strong>
                <p>{t('editor.help.pixelColors.blue.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator hover" />
              <div className="help-text">
                <strong>{t('editor.help.pixelColors.hover.title')}</strong>
                <p>{t('editor.help.pixelColors.hover.desc')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.dragFeedback.title')}</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-color-indicator drag-ok" />
              <div className="help-text">
                <strong>{t('editor.help.dragFeedback.ok.title')}</strong>
                <p>{t('editor.help.dragFeedback.ok.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-color-indicator drag-collision" />
              <div className="help-text">
                <strong>{t('editor.help.dragFeedback.collision.title')}</strong>
                <p>{t('editor.help.dragFeedback.collision.desc')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.magnetTypes.title')}</h3>
          <div className="help-content">
            <div className="magnet-type-card">
              <h4>
                <code>single</code>
              </h4>
              <p>{t('editor.help.magnetTypes.single.desc')}</p>
            </div>

            <div className="magnet-type-card">
              <h4>
                <code>horizontal</code>
              </h4>
              <p>{t('editor.help.magnetTypes.horizontal.desc')}</p>
            </div>

            <div className="magnet-type-card">
              <h4>
                <code>rectangular</code>
              </h4>
              <p>{t('editor.help.magnetTypes.rectangular.desc')}</p>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.limits.title')}</h3>
          <div className="help-list">
            <div className="help-item">
              <div className="help-icon">🔒</div>
              <div className="help-text">
                <strong>{t('editor.help.limits.editorButtons.title')}</strong>
                <p>{t('editor.help.limits.editorButtons.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">⛔</div>
              <div className="help-text">
                <strong>{t('editor.help.limits.collision.title')}</strong>
                <p>{t('editor.help.limits.collision.desc')}</p>
              </div>
            </div>

            <div className="help-item">
              <div className="help-icon">📐</div>
              <div className="help-text">
                <strong>{t('editor.help.limits.bounds.title')}</strong>
                <p>{t('editor.help.limits.bounds.desc')}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.tips.title')}</h3>
          <div className="help-content">
            <ul>
              <li>{t('editor.help.tips.stats')}</li>
              <li>{t('editor.help.tips.preview')}</li>
              <li>{t('editor.help.tips.occupancy')}</li>
              <li>{t('editor.help.tips.builtinDelete')}</li>
            </ul>
          </div>
        </section>

        <section className="help-section">
          <h3 className="help-title">{t('editor.help.section.shortcuts.title')}</h3>
          <div className="help-content">
            <div className="shortcut-item">
              <kbd>{t('editor.help.shortcuts.mouseDrag.key')}</kbd>
              <span>{t('editor.help.shortcuts.mouseDrag.desc')}</span>
            </div>
            <div className="shortcut-item">
              <kbd>Esc</kbd>
              <span>{t('editor.help.shortcuts.esc.desc')}</span>
            </div>
          </div>
        </section>

        <div className="help-footer">
          <p>{t('editor.help.footer.moreDocs')}</p>
        </div>
      </div>{' '}
      {/* 关闭 editor-window-content */}
    </div>
  );
});
