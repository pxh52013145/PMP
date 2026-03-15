import type { ReactNode } from 'react';

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

export function ThemeBindingEditorPanel({
  bindingId,
  bindingEditor,
  variantInput,
  renderActionButton,
}: ThemeBindingEditorPanelProps) {
  const inputIdSuffix = bindingId.replace(/[^a-z0-9-]/gi, '-');
  const rendererOptionsListId = `binding-editor-renderers-${inputIdSuffix}`;
  const surfaceOptionsListId = `binding-editor-surfaces-${inputIdSuffix}`;
  const variantOptionsListId = `binding-editor-variants-${inputIdSuffix}`;

  return (
    <div className="theme-binding-editor-panel">
      <div className="theme-binding-editor-panel__title">{bindingId}</div>

      <div className="theme-binding-editor-panel__chips">
        <span className="theme-binding-editor-panel__chip">source: {bindingEditor.bindingSource}</span>
        <span className="theme-binding-editor-panel__chip">
          resolved renderer: {bindingEditor.resolvedBinding.renderer ?? '-'}
        </span>
        <span className="theme-binding-editor-panel__chip">
          resolved variant: {bindingEditor.resolvedBinding.variant ?? bindingEditor.resolvedTheme.variant ?? '-'}
        </span>
        <span className="theme-binding-editor-panel__chip">surface doc: {bindingEditor.surfaceDocumentId}</span>
        <span className="theme-binding-editor-panel__chip">
          exists: {bindingEditor.surfaceDocument ? 'yes' : 'no'}
        </span>
      </div>

      <div className="theme-binding-editor-panel__row">
        <label className="theme-binding-editor-panel__field">
          <span className="theme-binding-editor-panel__field-label">Surface Target</span>
          <input
            className="theme-binding-editor-panel__input"
            list={surfaceOptionsListId}
            value={bindingEditor.surfaceDraft}
            onChange={(event) => bindingEditor.setSurfaceDraft(event.target.value)}
            placeholder="Leave empty to use self surface"
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
          label: 'Apply Surface',
          onClick: () => void bindingEditor.applySurfaceBinding(),
        })}
        {renderActionButton({
          kind: 'default',
          label: 'Use Self Surface',
          onClick: () => void bindingEditor.clearSurfaceBinding(),
        })}
        {renderActionButton({
          kind: 'default',
          label: 'Reset Surface Draft',
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

      <pre className="theme-binding-editor-panel__json">{JSON.stringify(bindingEditor.bindingPreview, null, 2)}</pre>

      <div className="theme-binding-editor-panel__section">
        <div className="theme-binding-editor-panel__section-title">Binding Overrides</div>

        <div className="theme-binding-editor-panel__row">
          <label className="theme-binding-editor-panel__field">
            <span className="theme-binding-editor-panel__field-label">Renderer</span>
            <input
              className="theme-binding-editor-panel__input"
              list={rendererOptionsListId}
              value={bindingEditor.bindingRendererDraft}
              onChange={(event) => bindingEditor.setBindingRendererDraft(event.target.value)}
              placeholder="Optional explicit renderer id"
            />
            <datalist id={rendererOptionsListId}>
              {bindingEditor.rendererSuggestions.map((rendererId) => (
                <option key={rendererId} value={rendererId} />
              ))}
            </datalist>
          </label>

          <label className="theme-binding-editor-panel__field">
            <span className="theme-binding-editor-panel__field-label">Variant</span>
            {variantInput.kind === 'select' ? (
              <select
                className="theme-binding-editor-panel__input"
                value={bindingEditor.bindingVariantDraft}
                onChange={(event) => bindingEditor.setBindingVariantDraft(event.target.value)}
              >
                <option value="">{variantInput.emptyLabel ?? '(inherit)'}</option>
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
                  placeholder={variantInput.placeholder ?? 'Optional explicit variant id'}
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
          <span className="theme-binding-editor-panel__field-label">Props JSON</span>
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
            label: 'Apply Overrides',
            onClick: () => void bindingEditor.applyBindingFields(),
          })}
          {renderActionButton({
            kind: 'default',
            label: 'Clear Overrides',
            onClick: () => void bindingEditor.clearBindingFields(),
          })}
          {renderActionButton({
            kind: 'default',
            label: 'Reset Override Draft',
            onClick: bindingEditor.resetBindingFieldsDraft,
          })}
          {renderActionButton({
            kind: 'default',
            label: 'Clear Binding',
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
        <div className="theme-binding-editor-panel__section-title">Surface Document</div>

        <div className="theme-binding-editor-panel__chips">
          <span className="theme-binding-editor-panel__chip">surface id: {bindingEditor.surfaceDocumentId}</span>
          <span className="theme-binding-editor-panel__chip">
            raw variant: {bindingEditor.surfaceDocument?.variant ?? '-'}
          </span>
        </div>

        <label className="theme-binding-editor-panel__field">
          <span className="theme-binding-editor-panel__field-label">Surface Theme JSON</span>
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
            label: 'Apply Surface JSON',
            onClick: () => void bindingEditor.applySurfaceTheme(),
          })}
          {renderActionButton({
            kind: 'default',
            label: 'Clear Surface JSON',
            onClick: () => void bindingEditor.clearSurfaceTheme(),
          })}
          {renderActionButton({
            kind: 'default',
            label: 'Reset Surface Draft',
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
