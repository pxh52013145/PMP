import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { useT } from '../../i18n';
import { useSkinSurfaceModel } from '../../themes/skinSurface';
import { isMusicLibrarySurfaceBinding } from '../../themes/starterPresets';
import type { ThemeBindingId } from '../../themes/types/theme';
import type { ThemeBindingEditorModel } from '../../themes/useThemeBindingEditor';

import './ThemeSurfaceWorkbench.css';

const DEFAULT_STATE_ID = 'default';
const INSPECT_STATE_ORDER = [
  DEFAULT_STATE_ID,
  'hover',
  'focus',
  'active',
  'selected',
  'disabled',
  'dragging',
  'drop-target',
] as const;

type PreviewMessage = {
  kind: 'success' | 'error';
  text: string;
};

type TokenPreviewKind = 'paint' | 'shadow' | 'none';

type TokenRow = {
  tokenId: string;
  assignedValue: string;
  resolvedValue: string;
  previewKind: TokenPreviewKind;
};

function joinClasses(...values: Array<string | undefined | false | null>): string | undefined {
  const joined = values.filter(Boolean).join(' ').trim();
  return joined.length > 0 ? joined : undefined;
}

function normalizeTokenValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toPreviewCssVariableName(tokenId: string): string {
  return `--pmp-${tokenId.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;
}

function classifyTokenPreview(value: string): TokenPreviewKind {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'none';

  if (
    normalized === 'transparent' ||
    normalized === 'currentcolor' ||
    /^(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\()/i.test(normalized) ||
    /^(repeating-)?(linear|radial|conic)-gradient\(/i.test(normalized)
  ) {
    return 'paint';
  }

  if (
    /(-?\d+(?:\.\d+)?px\s+){2,}/i.test(normalized) &&
    /(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|lab\(|lch\(|color\()/i.test(normalized)
  ) {
    return 'shadow';
  }

  return 'none';
}

function buildSwatchStyle(kind: TokenPreviewKind, value: string): CSSProperties {
  if (kind === 'paint') {
    return { background: value };
  }

  if (kind === 'shadow') {
    return {
      background: 'rgba(18, 24, 36, 0.92)',
      boxShadow: value,
    };
  }

  return {};
}

function sortPreferredValues(values: Iterable<string>, order: readonly string[]): string[] {
  const orderIndex = new Map(order.map((value, index) => [value, index]));
  const normalizedValues = new Set<string>();

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) continue;
    normalizedValues.add(value);
  }

  return [...normalizedValues].sort((left, right) => {
    const leftIndex = orderIndex.get(left);
    const rightIndex = orderIndex.get(right);
    if (typeof leftIndex === 'number' && typeof rightIndex === 'number') {
      return leftIndex - rightIndex;
    }
    if (typeof leftIndex === 'number') return -1;
    if (typeof rightIndex === 'number') return 1;
    return left.localeCompare(right);
  });
}

export interface ThemeSurfaceWorkbenchProps {
  bindingId: ThemeBindingId;
  bindingEditor: ThemeBindingEditorModel;
  onInstallStarter?: () => Promise<void>;
}

export function ThemeSurfaceWorkbench({
  bindingId,
  bindingEditor,
  onInstallStarter,
}: ThemeSurfaceWorkbenchProps) {
  const t = useT();
  const surface = useSkinSurfaceModel(bindingId);
  const [inspectedStateId, setInspectedStateId] = useState(DEFAULT_STATE_ID);
  const [inspectedPart, setInspectedPart] = useState('root');
  const [message, setMessage] = useState<PreviewMessage | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const isMusicLibrary = isMusicLibrarySurfaceBinding(bindingId);

  useEffect(() => {
    setInspectedStateId(DEFAULT_STATE_ID);
    setInspectedPart('root');
    setMessage(null);
  }, [bindingId]);

  const availableParts = useMemo(() => {
    const parts = new Set<string>(['root']);
    for (const partName of Object.keys(bindingEditor.resolvedTheme.parts ?? {})) {
      parts.add(partName);
    }
    for (const partName of bindingEditor.bindingPreview.surfaceDocumentSummary.partNames) {
      parts.add(partName);
    }
    return [...parts].sort((left, right) => {
      if (left === 'root') return -1;
      if (right === 'root') return 1;
      return left.localeCompare(right);
    });
  }, [
    bindingEditor.bindingPreview.surfaceDocumentSummary.partNames,
    bindingEditor.resolvedTheme.parts,
  ]);

  const availableStates = useMemo(() => {
    const states = new Set<string>([DEFAULT_STATE_ID]);
    for (const stateName of bindingEditor.bindingPreview.surfaceDocumentSummary.stateNames) {
      states.add(stateName);
    }
    for (const part of Object.values(bindingEditor.resolvedTheme.parts ?? {})) {
      for (const stateName of Object.keys(part.states ?? {})) {
        states.add(stateName);
      }
    }
    return sortPreferredValues(states, INSPECT_STATE_ORDER);
  }, [
    bindingEditor.bindingPreview.surfaceDocumentSummary.stateNames,
    bindingEditor.resolvedTheme.parts,
  ]);

  const inspectedState = inspectedStateId === DEFAULT_STATE_ID ? undefined : inspectedStateId;
  const inspectedPartModel = useMemo(
    () => surface.getPart(inspectedPart, { state: inspectedState, includeSurfaceTokens: true }),
    [inspectedPart, inspectedState, surface]
  );

  const tokenRows = useMemo(() => {
    const styleRecord = inspectedPartModel.style as Record<string, unknown>;
    return Object.entries(inspectedPartModel.tokens ?? {})
      .map(([tokenId, assigned]) => {
        const assignedValue = normalizeTokenValue(assigned);
        const resolvedValue = normalizeTokenValue(styleRecord[toPreviewCssVariableName(tokenId)]) || assignedValue;
        return {
          tokenId,
          assignedValue,
          resolvedValue,
          previewKind: classifyTokenPreview(resolvedValue),
        } satisfies TokenRow;
      })
      .sort((left, right) => left.tokenId.localeCompare(right.tokenId));
  }, [inspectedPartModel.style, inspectedPartModel.tokens]);

  const visualTokenRows = useMemo(
    () => tokenRows.filter((row) => row.previewKind !== 'none'),
    [tokenRows]
  );

  const visualSampleRows = useMemo(() => {
    return visualTokenRows
      .map((row) => ({
        id: `token:${row.tokenId}`,
        label: row.tokenId,
        value: row.resolvedValue,
        previewKind: row.previewKind,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [visualTokenRows]);

  const handleInstallStarter = async () => {
    if (!onInstallStarter || starterBusy) return;

    setStarterBusy(true);
    setMessage(null);
    try {
      await onInstallStarter();
      setMessage({
        kind: 'success',
        text: t('editor.theme-editor.surfaceWorkbench.starter.applied'),
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setMessage({
        kind: 'error',
        text: t('editor.theme-editor.surfaceWorkbench.starter.failed', { message: text }),
      });
    } finally {
      setStarterBusy(false);
    }
  };

  return (
    <div className="theme-surface-workbench">
      <div className="theme-surface-workbench__header">
        <div className="theme-surface-workbench__header-copy">
          <div className="theme-editor-section-title">
            {t('editor.theme-editor.surfaceWorkbench.section.title')}
          </div>
          <div className="theme-surface-workbench__subtitle">
            {isMusicLibrary
              ? t('editor.theme-editor.surfaceWorkbench.musicLibrary.description')
              : t('editor.theme-editor.surfaceWorkbench.generic.description')}
          </div>
        </div>

        <div className="theme-surface-workbench__meta">
          <span className="theme-editor-panel-chip">{bindingId}</span>
          <span className="theme-editor-panel-chip">{bindingEditor.surfaceDocumentId}</span>
          <span className="theme-editor-panel-chip">
            {t('editor.theme-editor.surfaceWorkbench.context.variant')}: {surface.variant ?? '-'}
          </span>
        </div>
      </div>

      <div className="theme-surface-workbench__toolbar">
        <div className="theme-surface-workbench__context">
          <span className="theme-editor-panel-chip">
            {t('editor.theme-editor.surfaceWorkbench.context.part')}: {inspectedPart}
          </span>
          <span className="theme-editor-panel-chip">
            {t('editor.theme-editor.surfaceWorkbench.context.state')}: {inspectedState ?? DEFAULT_STATE_ID}
          </span>
          <span className="theme-editor-panel-chip">
            {t('editor.theme-editor.surfaceWorkbench.context.tokens')}: {tokenRows.length}
          </span>
        </div>

        {isMusicLibrary && onInstallStarter ? (
          <button
            type="button"
            className="theme-editor-action-btn"
            onClick={() => void handleInstallStarter()}
            disabled={starterBusy}
          >
            {starterBusy
              ? t('editor.theme-editor.surfaceWorkbench.starter.installing')
              : t('editor.theme-editor.surfaceWorkbench.starter.install')}
          </button>
        ) : null}
      </div>

      {message ? (
        <div className={`theme-editor-message theme-editor-message--${message.kind}`}>{message.text}</div>
      ) : null}

      <div className="theme-surface-workbench__layout">
        <div className="theme-surface-workbench__sidebar">
          <div className="theme-surface-workbench__inspector-section">
            <div className="theme-editor-section-title">
              {t('editor.theme-editor.surfaceWorkbench.summary.title')}
            </div>
            <div className="theme-surface-workbench__summary-grid">
              <div className="theme-surface-workbench__summary-card">
                <div className="theme-surface-workbench__summary-label">
                  {t('editor.theme-editor.surfaceWorkbench.summary.parts')}
                </div>
                <div className="theme-surface-workbench__summary-value">{availableParts.length}</div>
              </div>
              <div className="theme-surface-workbench__summary-card">
                <div className="theme-surface-workbench__summary-label">
                  {t('editor.theme-editor.surfaceWorkbench.summary.states')}
                </div>
                <div className="theme-surface-workbench__summary-value">{availableStates.length}</div>
              </div>
              <div className="theme-surface-workbench__summary-card">
                <div className="theme-surface-workbench__summary-label">
                  {t('editor.theme-editor.surfaceWorkbench.summary.tokens')}
                </div>
                <div className="theme-surface-workbench__summary-value">{tokenRows.length}</div>
              </div>
            </div>
          </div>

          <div className="theme-surface-workbench__inspector-section">
            <div className="theme-editor-section-title">
              {t('editor.theme-editor.surfaceWorkbench.states.title')}
            </div>
            <div className="theme-surface-workbench__chip-list">
              {availableStates.map((stateName) => (
                <button
                  key={stateName}
                  type="button"
                  className={joinClasses(
                    'theme-surface-workbench__chip',
                    inspectedStateId === stateName && 'is-active'
                  )}
                  onClick={() => setInspectedStateId(stateName)}
                >
                  {stateName}
                </button>
              ))}
            </div>
          </div>

          <div className="theme-surface-workbench__inspector-section">
            <div className="theme-editor-section-title">
              {t('editor.theme-editor.surfaceWorkbench.parts.title')}
            </div>
            <div className="theme-surface-workbench__chip-list">
              {availableParts.map((partName) => (
                <button
                  key={partName}
                  type="button"
                  className={joinClasses(
                    'theme-surface-workbench__chip',
                    inspectedPart === partName && 'is-active'
                  )}
                  onClick={() => setInspectedPart(partName)}
                >
                  {partName}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="theme-surface-workbench__content">
          <div className="theme-surface-workbench__inspector-section">
            <div className="theme-editor-section-title">
              {t('editor.theme-editor.surfaceWorkbench.visualTokens.title')}
            </div>
            <div className="theme-surface-workbench__section-note">
              {t('editor.theme-editor.surfaceWorkbench.visualTokens.note')}
            </div>
            {visualSampleRows.length === 0 ? (
              <div className="theme-editor-muted">
                {t('editor.theme-editor.surfaceWorkbench.visualTokens.empty')}
              </div>
            ) : (
              <div className="theme-surface-workbench__swatch-grid">
                {visualSampleRows.map((row) => (
                  <div key={row.id} className="theme-surface-workbench__swatch-card">
                    <div className="theme-surface-workbench__swatch-preview">
                      <div
                        className={joinClasses(
                          'theme-surface-workbench__swatch-fill',
                          row.previewKind === 'shadow' && 'is-shadow'
                        )}
                        style={buildSwatchStyle(row.previewKind, row.value)}
                      />
                    </div>
                    <div className="theme-surface-workbench__swatch-head">
                      <div className="theme-surface-workbench__swatch-name">{row.label}</div>
                      <span className="theme-surface-workbench__swatch-badge">
                        {toPreviewCssVariableName(row.label)}
                      </span>
                    </div>
                    <div className="theme-surface-workbench__swatch-value">{row.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="theme-surface-workbench__inspector-section">
            <div className="theme-editor-section-title">
              {t('editor.theme-editor.surfaceWorkbench.tokens.title')}
            </div>
            {tokenRows.length === 0 ? (
              <div className="theme-editor-muted">
                {t('editor.theme-editor.surfaceWorkbench.vars.empty')}
              </div>
            ) : (
              <div className="theme-surface-workbench__token-list">
                {tokenRows.map((row) => (
                  <div key={row.tokenId} className="theme-surface-workbench__token-row">
                    <div className="theme-surface-workbench__token-heading">
                      {row.previewKind !== 'none' ? (
                        <span
                          className="theme-surface-workbench__token-dot"
                          style={buildSwatchStyle(row.previewKind, row.resolvedValue)}
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="theme-surface-workbench__token-name">{row.tokenId}</span>
                    </div>
                    <div className="theme-surface-workbench__token-values">
                      <div className="theme-surface-workbench__token-value-row">
                        <span className="theme-surface-workbench__token-value-label">
                          {t('editor.theme-editor.surfaceWorkbench.tokens.assigned')}
                        </span>
                        <span className="theme-surface-workbench__token-value">{row.assignedValue || '-'}</span>
                      </div>
                      <div className="theme-surface-workbench__token-value-row">
                        <span className="theme-surface-workbench__token-value-label">
                          {t('editor.theme-editor.surfaceWorkbench.tokens.resolved')}
                        </span>
                        <span className="theme-surface-workbench__token-value">{row.resolvedValue || '-'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
