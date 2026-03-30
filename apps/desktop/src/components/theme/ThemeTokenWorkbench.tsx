import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import { useT } from '../../i18n';
import type { Theme, ThemeTokenPrimitive, ThemeTokens } from '../../themes/types/theme';

import './ThemeTokenWorkbench.css';

const TOKEN_REFERENCE_PATTERN = /^\{([^}]+)\}$/;
const TOKEN_CATEGORY_ORDER = [
  'color',
  'radius',
  'space',
  'size',
  'typography',
  'shadow',
  'border',
  'motion',
] as const satisfies ReadonlyArray<keyof ThemeTokens>;

type TokenPreviewKind = 'paint' | 'shadow' | 'none';

type ThemeTokenRow = {
  category: keyof ThemeTokens;
  tokenId: string;
  fullTokenId: string;
  cssVariable: string;
  rawValue: string;
  resolvedValue: string;
  isReference: boolean;
  previewKind: TokenPreviewKind;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTokenValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function toCssVariableName(tokenId: string): string {
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

function buildPreviewStyle(kind: TokenPreviewKind, value: string): CSSProperties {
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

function flattenThemeTokenMap(theme: Theme): Map<string, ThemeTokenPrimitive> {
  const entries = new Map<string, ThemeTokenPrimitive>();

  for (const [category, value] of Object.entries(theme.tokens ?? {})) {
    if (!isPlainObject(value)) continue;
    for (const [tokenId, tokenValue] of Object.entries(value)) {
      entries.set(`${category}.${tokenId}`, tokenValue as ThemeTokenPrimitive);
    }
  }

  return entries;
}

function resolveThemeTokenValue(
  tokenMap: Map<string, ThemeTokenPrimitive>,
  value: ThemeTokenPrimitive,
  stack: Set<string> = new Set()
): ThemeTokenPrimitive {
  if (typeof value !== 'string') {
    return value;
  }

  const match = value.match(TOKEN_REFERENCE_PATTERN);
  if (!match) {
    return value;
  }

  const nextTokenId = match[1]?.trim();
  if (!nextTokenId || stack.has(nextTokenId)) {
    return value;
  }

  const nextValue = tokenMap.get(nextTokenId);
  if (typeof nextValue === 'undefined') {
    return value;
  }

  const nextStack = new Set(stack);
  nextStack.add(nextTokenId);
  return resolveThemeTokenValue(tokenMap, nextValue, nextStack);
}

function getCategoryLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  category: keyof ThemeTokens
): string {
  return t(`editor.theme-editor.tokenWorkbench.category.${category}`);
}

export interface ThemeTokenWorkbenchProps {
  theme: Theme;
}

export function ThemeTokenWorkbench({ theme }: ThemeTokenWorkbenchProps) {
  const t = useT();

  const tokenRows = useMemo(() => {
    const tokenMap = flattenThemeTokenMap(theme);

    return Array.from(tokenMap.entries())
      .map(([fullTokenId, tokenValue]) => {
        const separatorIndex = fullTokenId.indexOf('.');
        const category = fullTokenId.slice(0, separatorIndex) as keyof ThemeTokens;
        const tokenId = fullTokenId.slice(separatorIndex + 1);
        const rawValue = normalizeTokenValue(tokenValue);
        const resolvedValue = normalizeTokenValue(resolveThemeTokenValue(tokenMap, tokenValue));

        return {
          category,
          tokenId,
          fullTokenId,
          cssVariable: toCssVariableName(fullTokenId),
          rawValue,
          resolvedValue,
          isReference: TOKEN_REFERENCE_PATTERN.test(rawValue),
          previewKind: classifyTokenPreview(resolvedValue),
        } satisfies ThemeTokenRow;
      })
      .sort((left, right) => {
        const leftCategoryIndex = TOKEN_CATEGORY_ORDER.indexOf(left.category);
        const rightCategoryIndex = TOKEN_CATEGORY_ORDER.indexOf(right.category);
        if (leftCategoryIndex !== rightCategoryIndex) {
          return leftCategoryIndex - rightCategoryIndex;
        }
        return left.tokenId.localeCompare(right.tokenId);
      });
  }, [theme]);

  const groupedRows = useMemo(() => {
    const groups = new Map<keyof ThemeTokens, ThemeTokenRow[]>();

    for (const row of tokenRows) {
      const bucket = groups.get(row.category);
      if (bucket) bucket.push(row);
      else groups.set(row.category, [row]);
    }

    return TOKEN_CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
      category,
      label: getCategoryLabel(t, category),
      rows: groups.get(category) ?? [],
    }));
  }, [t, tokenRows]);

  const totalTokens = tokenRows.length;
  const colorTokenCount = tokenRows.filter((row) => row.category === 'color').length;
  const referenceTokenCount = tokenRows.filter((row) => row.isReference).length;

  return (
    <div className="theme-token-workbench">
      <div className="theme-token-workbench__header">
        <div className="theme-editor-section-title">
          {t('editor.theme-editor.tokenWorkbench.section.title')}
        </div>
        <div className="theme-token-workbench__subtitle">
          {t('editor.theme-editor.tokenWorkbench.section.desc')}
        </div>
      </div>

      <div className="theme-token-workbench__summary-grid">
        <div className="theme-token-workbench__summary-card">
          <div className="theme-token-workbench__summary-label">
            {t('editor.theme-editor.tokenWorkbench.summary.total')}
          </div>
          <div className="theme-token-workbench__summary-value">{totalTokens}</div>
        </div>
        <div className="theme-token-workbench__summary-card">
          <div className="theme-token-workbench__summary-label">
            {t('editor.theme-editor.tokenWorkbench.summary.colors')}
          </div>
          <div className="theme-token-workbench__summary-value">{colorTokenCount}</div>
        </div>
        <div className="theme-token-workbench__summary-card">
          <div className="theme-token-workbench__summary-label">
            {t('editor.theme-editor.tokenWorkbench.summary.references')}
          </div>
          <div className="theme-token-workbench__summary-value">{referenceTokenCount}</div>
        </div>
      </div>

      <div className="theme-token-workbench__scope-note">
        {t('editor.theme-editor.tokenWorkbench.scope.note')}
      </div>

      {groupedRows.length === 0 ? (
        <div className="theme-editor-muted">{t('editor.theme-editor.tokenWorkbench.empty')}</div>
      ) : (
        <div className="theme-token-workbench__groups">
          {groupedRows.map((group) => {
            const previewRows = group.rows.filter((row) => row.previewKind !== 'none');
            return (
              <section key={group.category} className="theme-token-workbench__group">
                <div className="theme-token-workbench__group-head">
                  <div className="theme-token-workbench__group-title">{group.label}</div>
                  <div className="theme-token-workbench__group-badge">{group.rows.length}</div>
                </div>

                {previewRows.length > 0 ? (
                  <div className="theme-token-workbench__swatch-grid">
                    {previewRows.map((row) => (
                      <div key={`${row.fullTokenId}:swatch`} className="theme-token-workbench__swatch-card">
                        <div className="theme-token-workbench__swatch-preview">
                          <div
                            className={`theme-token-workbench__swatch-fill ${
                              row.previewKind === 'shadow' ? 'is-shadow' : ''
                            }`}
                            style={buildPreviewStyle(row.previewKind, row.resolvedValue)}
                          />
                        </div>
                        <div className="theme-token-workbench__swatch-name">{row.tokenId}</div>
                        <div className="theme-token-workbench__swatch-value">{row.resolvedValue || '-'}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="theme-token-workbench__list">
                  {group.rows.map((row) => (
                    <div key={row.fullTokenId} className="theme-token-workbench__row">
                      <div className="theme-token-workbench__row-head">
                        <div className="theme-token-workbench__row-title-block">
                          <div className="theme-token-workbench__row-title">{row.fullTokenId}</div>
                          <div className="theme-token-workbench__row-css">{row.cssVariable}</div>
                        </div>
                        <div className="theme-token-workbench__row-badges">
                          {row.isReference ? (
                            <span className="theme-token-workbench__row-badge is-reference">
                              {t('editor.theme-editor.tokenWorkbench.badge.reference')}
                            </span>
                          ) : (
                            <span className="theme-token-workbench__row-badge">
                              {t('editor.theme-editor.tokenWorkbench.badge.literal')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="theme-token-workbench__row-values">
                        <div className="theme-token-workbench__value-line">
                          <span className="theme-token-workbench__value-label">
                            {t('editor.theme-editor.tokenWorkbench.field.raw')}
                          </span>
                          <span className="theme-token-workbench__value">{row.rawValue || '-'}</span>
                        </div>
                        <div className="theme-token-workbench__value-line">
                          <span className="theme-token-workbench__value-label">
                            {t('editor.theme-editor.tokenWorkbench.field.resolved')}
                          </span>
                          <span className="theme-token-workbench__value">{row.resolvedValue || '-'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
