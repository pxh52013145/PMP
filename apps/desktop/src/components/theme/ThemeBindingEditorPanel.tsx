import type { ReactNode } from 'react';

import { useT } from '../../i18n';
import type { ThemeBindingId } from '../../themes/types/theme';
import type { ThemeBindingEditorModel } from '../../themes/useThemeBindingEditor';

import './ThemeBindingEditorPanel.css';

export type ThemeBindingVariantInput =
  | {
      kind: 'input';
      suggestions: string[];
      placeholder?: string;
    }
  | {
      kind: 'select';
      options: Array<{ id: string; label: string }>;
      emptyLabel?: string;
    };

export type ThemeBindingEditorActionButton = {
  kind: 'primary' | 'default';
  label: string;
  onClick: () => void;
};

export interface ThemeBindingEditorPanelProps {
  bindingId: ThemeBindingId;
  bindingEditor: ThemeBindingEditorModel;
  variantInput: ThemeBindingVariantInput;
  renderActionButton: (button: ThemeBindingEditorActionButton) => ReactNode;
}

function formatBindingSourceLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  source: 'binding' | 'surface' | 'none'
): string {
  if (source === 'binding') return t('editor.theme-editor.bindingSource.binding');
  if (source === 'surface') return t('editor.theme-editor.bindingSource.surface');
  return t('editor.theme-editor.bindingSource.none');
}

export function ThemeBindingEditorPanel({
  bindingId,
  bindingEditor,
  variantInput,
  renderActionButton,
}: ThemeBindingEditorPanelProps) {
  const t = useT();
  const inputIdSuffix = bindingId.replace(/[^a-z0-9-]/gi, '-');
  const rendererOptionsListId = `binding-editor-renderers-${inputIdSuffix}`;
  const surfaceOptionsListId = `binding-editor-surfaces-${inputIdSuffix}`;
  const variantOptionsListId = `binding-editor-variants-${inputIdSuffix}`;

  return (
    <div className="theme-binding-editor-panel">
      <div className="theme-binding-editor-panel__title">{bindingId}</div>

      <div className="theme-binding-editor-panel__chips">
        <span className="theme-binding-editor-panel__chip">
          {t('editor.theme-editor.bindingPanel.summary.source')}:{' '}
          {formatBindingSourceLabel(t, bindingEditor.bindingSource)}
        </span>
        <span className="theme-binding-editor-panel__chip">
          {t('editor.theme-editor.bindingPanel.summary.resolvedRenderer')}:{' '}
          {bindingEditor.resolvedBinding.renderer ?? '-'}
        </span>
        <span className="theme-binding-editor-panel__chip">
          {t('editor.theme-editor.bindingPanel.summary.resolvedVariant')}:{' '}
          {bindingEditor.resolvedBinding.variant ?? bindingEditor.resolvedTheme.variant ?? '-'}
        </span>
        <span className="theme-binding-editor-panel__chip">
          {t('editor.theme-editor.bindingPanel.summary.surfaceDoc')}: {bindingEditor.surfaceDocumentId}
        </span>
        <span className="theme-binding-editor-panel__chip">
          {t('editor.theme-editor.bindingPanel.summary.exists')}:{' '}
          {bindingEditor.surfaceDocument
            ? t('editor.theme-editor.bindingPanel.summary.existsYes')
            : t('editor.theme-editor.bindingPanel.summary.existsNo')}
        </span>
      </div>

      <div className="theme-binding-editor-panel__row">
        <label className="theme-binding-editor-panel__field">
          <span className="theme-binding-editor-panel__field-label">
            {t('editor.theme-editor.bindingPanel.field.surfaceTarget')}
          </span>
          <input
            className="theme-binding-editor-panel__input"
            list={surfaceOptionsListId}
            value={bindingEditor.surfaceDraft}
            onChange={(event) => bindingEditor.setSurfaceDraft(event.target.value)}
            placeholder={t('editor.theme-editor.bindingPanel.placeholder.surfaceTarget')}
          />
          <datalist id={surfaceOptionsListId}>
            {bindingEditor.surfaceSuggestions.map((surfaceId) => (
              <option key={surfaceId} value={surfaceId} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="theme-binding-editor-panel__actions">
        {renderActionButton({
          kind: 'primary',
          label: t('editor.theme-editor.bindingPanel.action.applySurface'),
          onClick: () => void bindingEditor.applySurfaceBinding(),
        })}
        {renderActionButton({
          kind: 'default',
          label: t('editor.theme-editor.bindingPanel.action.useSelfSurface'),
          onClick: () => void bindingEditor.clearSurfaceBinding(),
        })}
        {renderActionButton({
          kind: 'default',
          label: t('editor.theme-editor.bindingPanel.action.resetSurfaceDraft'),
          onClick: bindingEditor.resetSurfaceBindingDraft,
        })}
      </div>

      {bindingEditor.surfaceBindingMessage ? (
        <div
          className={`theme-binding-editor-panel__message theme-binding-editor-panel__message--${bindingEditor.surfaceBindingMessage.kind}`}
        >
          {bindingEditor.surfaceBindingMessage.text}
        </div>
      ) : null}

      <details className="theme-binding-editor-panel__details">
        <summary className="theme-binding-editor-panel__details-summary">
          {t('editor.theme-editor.bindingPanel.section.preview')}
        </summary>
        <pre className="theme-binding-editor-panel__json">{JSON.stringify(bindingEditor.bindingPreview, null, 2)}</pre>
      </details>

      <div className="theme-binding-editor-panel__section">
        <div className="theme-binding-editor-panel__section-title">
          {t('editor.theme-editor.bindingPanel.section.overrides')}
        </div>

        <div className="theme-binding-editor-panel__row">
          <label className="theme-binding-editor-panel__field">
            <span className="theme-binding-editor-panel__field-label">
              {t('editor.theme-editor.bindingPanel.field.renderer')}
            </span>
            <input
              className="theme-binding-editor-panel__input"
              list={rendererOptionsListId}
              value={bindingEditor.bindingRendererDraft}
              onChange={(event) => bindingEditor.setBindingRendererDraft(event.target.value)}
              placeholder={t('editor.theme-editor.bindingPanel.placeholder.renderer')}
            />
            <datalist id={rendererOptionsListId}>
              {bindingEditor.rendererSuggestions.map((rendererId) => (
                <option key={rendererId} value={rendererId} />
              ))}
            </datalist>
          </label>

          <label className="theme-binding-editor-panel__field">
            <span className="theme-binding-editor-panel__field-label">
              {t('editor.theme-editor.bindingPanel.field.variant')}
            </span>
            {variantInput.kind === 'select' ? (
              <select
                className="theme-binding-editor-panel__input"
                value={bindingEditor.bindingVariantDraft}
                onChange={(event) => bindingEditor.setBindingVariantDraft(event.target.value)}
              >
                <option value="">{variantInput.emptyLabel ?? t('editor.theme-editor.bindingPanel.empty.inherit')}</option>
                {variantInput.options.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  className="theme-binding-editor-panel__input"
                  list={variantOptionsListId}
                  value={bindingEditor.bindingVariantDraft}
                  onChange={(event) => bindingEditor.setBindingVariantDraft(event.target.value)}
                  placeholder={
                    variantInput.placeholder ?? t('editor.theme-editor.bindingPanel.placeholder.variant')
                  }
                />
                <datalist id={variantOptionsListId}>
                  {variantInput.suggestions.map((variantId) => (
                    <option key={variantId} value={variantId} />
                  ))}
                </datalist>
              </>
            )}
          </label>
        </div>

        <label className="theme-binding-editor-panel__field">
          <span className="theme-binding-editor-panel__field-label">
            {t('editor.theme-editor.bindingPanel.field.propsJson')}
          </span>
          <textarea
            className="theme-binding-editor-panel__textarea"
            value={bindingEditor.bindingPropsJson}
            onChange={(event) => bindingEditor.setBindingPropsJson(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="theme-binding-editor-panel__actions">
          {renderActionButton({
            kind: 'primary',
            label: t('editor.theme-editor.bindingPanel.action.applyOverrides'),
            onClick: () => void bindingEditor.applyBindingFields(),
          })}
          {renderActionButton({
            kind: 'default',
            label: t('editor.theme-editor.bindingPanel.action.clearOverrides'),
            onClick: () => void bindingEditor.clearBindingFields(),
          })}
          {renderActionButton({
            kind: 'default',
            label: t('editor.theme-editor.bindingPanel.action.resetOverrideDraft'),
            onClick: bindingEditor.resetBindingFieldsDraft,
          })}
          {renderActionButton({
            kind: 'default',
            label: t('editor.theme-editor.bindingPanel.action.clearBinding'),
            onClick: () => void bindingEditor.clearBinding(),
          })}
        </div>

        {bindingEditor.bindingFieldsMessage ? (
          <div
            className={`theme-binding-editor-panel__message theme-binding-editor-panel__message--${bindingEditor.bindingFieldsMessage.kind}`}
          >
            {bindingEditor.bindingFieldsMessage.text}
          </div>
        ) : null}
      </div>

      <div className="theme-binding-editor-panel__section">
        <div className="theme-binding-editor-panel__section-title">
          {t('editor.theme-editor.bindingPanel.section.surfaceDocument')}
        </div>

        <div className="theme-binding-editor-panel__chips">
          <span className="theme-binding-editor-panel__chip">
            {t('editor.theme-editor.bindingPanel.summary.surfaceDoc')}: {bindingEditor.surfaceDocumentId}
          </span>
          <span className="theme-binding-editor-panel__chip">
            {t('editor.theme-editor.bindingPanel.summary.rawVariant')}:{' '}
            {bindingEditor.surfaceDocument?.variant ?? '-'}
          </span>
        </div>

        <label className="theme-binding-editor-panel__field">
          <span className="theme-binding-editor-panel__field-label">
            {t('editor.theme-editor.bindingPanel.field.surfaceThemeJson')}
          </span>
          <textarea
            className="theme-binding-editor-panel__textarea"
            value={bindingEditor.surfaceThemeJson}
            onChange={(event) => bindingEditor.setSurfaceThemeJson(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="theme-binding-editor-panel__actions">
          {renderActionButton({
            kind: 'primary',
            label: t('editor.theme-editor.bindingPanel.action.applySurfaceJson'),
            onClick: () => void bindingEditor.applySurfaceTheme(),
          })}
          {renderActionButton({
            kind: 'default',
            label: t('editor.theme-editor.bindingPanel.action.clearSurfaceJson'),
            onClick: () => void bindingEditor.clearSurfaceTheme(),
          })}
          {renderActionButton({
            kind: 'default',
            label: t('editor.theme-editor.bindingPanel.action.resetSurfaceJsonDraft'),
            onClick: bindingEditor.resetSurfaceThemeDraft,
          })}
        </div>

        {bindingEditor.surfaceThemeMessage ? (
          <div
            className={`theme-binding-editor-panel__message theme-binding-editor-panel__message--${bindingEditor.surfaceThemeMessage.kind}`}
          >
            {bindingEditor.surfaceThemeMessage.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}
