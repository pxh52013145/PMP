import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { useTheme } from './contexts/ThemeContextWithSync';
import type { ComponentTheme, ThemeBinding, ThemeBindingId, ThemeSurfaceId } from './types/theme';
import type { ThemeImportSurfaceSpec } from './types/themeImport';
import { materializeThemeBinding } from './importAdapters';

export type ThemeBindingEditorMessage = { kind: 'error' | 'success'; text: string };
export type ThemeBindingEditorPreview = {
  bindingId: ThemeBindingId;
  targetSurfaceId: ThemeSurfaceId;
  explicitBinding: ThemeBinding | null;
  resolvedBinding: ThemeBinding;
  surfaceDocument: ComponentTheme | null;
  surfaceDocumentSummary: ReturnType<typeof summarizeComponentTheme>;
  materializedBindingTheme: ReturnType<typeof summarizeThemeImportSurface>;
};

export interface ThemeBindingEditorModel {
  explicitBinding: ThemeBinding | null;
  resolvedBinding: ThemeBinding;
  resolvedTheme: ComponentTheme;
  bindingSource: 'binding' | 'surface' | 'none';
  bindingPreview: ThemeBindingEditorPreview;
  surfaceDocument: ComponentTheme | null;
  surfaceDocumentId: ThemeSurfaceId;
  surfaceSuggestions: string[];
  rendererSuggestions: string[];
  surfaceDraft: string;
  setSurfaceDraft: Dispatch<SetStateAction<string>>;
  bindingRendererDraft: string;
  setBindingRendererDraft: Dispatch<SetStateAction<string>>;
  bindingVariantDraft: string;
  setBindingVariantDraft: Dispatch<SetStateAction<string>>;
  bindingPropsJson: string;
  setBindingPropsJson: Dispatch<SetStateAction<string>>;
  surfaceThemeJson: string;
  setSurfaceThemeJson: Dispatch<SetStateAction<string>>;
  surfaceBindingMessage: ThemeBindingEditorMessage | null;
  bindingFieldsMessage: ThemeBindingEditorMessage | null;
  surfaceThemeMessage: ThemeBindingEditorMessage | null;
  applySurfaceBinding: () => Promise<void>;
  resetSurfaceBindingDraft: () => void;
  clearSurfaceBinding: () => Promise<void>;
  applyBindingFields: () => Promise<void>;
  resetBindingFieldsDraft: () => void;
  clearBindingFields: () => Promise<void>;
  clearBinding: () => Promise<void>;
  applySurfaceTheme: () => Promise<void>;
  resetSurfaceThemeDraft: () => void;
  clearSurfaceTheme: () => Promise<void>;
}

type UseThemeBindingEditorOptions = {
  bindingId: ThemeBindingId;
  rendererSuggestions?: string[];
};

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function summarizeComponentTheme(themeValue: ComponentTheme) {
  return {
    extends: themeValue.extends ?? null,
    variant: themeValue.variant ?? null,
    tokenKeys: Object.keys(themeValue.tokens ?? {}),
    partNames: Object.keys(themeValue.parts ?? {}),
    stateNames: Object.keys(themeValue.states ?? {}),
    metadata: themeValue.metadata ?? null,
  };
}

function summarizeThemeImportSurface(themeValue: ThemeImportSurfaceSpec) {
  return {
    ...summarizeComponentTheme(themeValue),
    bindingOverlay: {
      variantConfigKeys: Object.keys(themeValue.variantConfig ?? {}),
      dynamicColor: themeValue.dynamicColor ?? null,
    },
  };
}

function parseComponentThemeJson(text: string): ComponentTheme {
  const parsed = text.trim().length > 0 ? (JSON.parse(text) as unknown) : {};
  assertObject(parsed, 'surface');
  return parsed as ComponentTheme;
}

function parseBindingPropsJson(text: string): Record<string, unknown> {
  const parsed = text.trim().length > 0 ? (JSON.parse(text) as unknown) : {};
  assertObject(parsed, 'binding.props');
  return parsed;
}

export function useThemeBindingEditor({
  bindingId,
  rendererSuggestions = [],
}: UseThemeBindingEditorOptions): ThemeBindingEditorModel {
  const { theme, getBinding, getSurfaceTheme, updateBinding, updateSurfaceTheme } = useTheme();
  const [surfaceBindingMessage, setSurfaceBindingMessage] = useState<ThemeBindingEditorMessage | null>(null);
  const [bindingFieldsMessage, setBindingFieldsMessage] = useState<ThemeBindingEditorMessage | null>(null);
  const [surfaceThemeMessage, setSurfaceThemeMessage] = useState<ThemeBindingEditorMessage | null>(null);
  const [surfaceDraft, setSurfaceDraft] = useState('');
  const [bindingRendererDraft, setBindingRendererDraft] = useState('');
  const [bindingVariantDraft, setBindingVariantDraft] = useState('');
  const [bindingPropsJson, setBindingPropsJson] = useState('{}');
  const [surfaceThemeJson, setSurfaceThemeJson] = useState('{}');

  const explicitBinding = useMemo(() => theme.bindings?.[bindingId] ?? null, [bindingId, theme.bindings]);

  const resolvedBinding = useMemo(() => getBinding(bindingId), [bindingId, getBinding]);

  const resolvedTheme = useMemo(
    () => getSurfaceTheme(bindingId as ThemeSurfaceId),
    [bindingId, getSurfaceTheme]
  );
  const materializedTheme = useMemo(() => materializeThemeBinding(theme, bindingId), [bindingId, theme]);

  const surfaceNamespace = useMemo(() => {
    const [namespace = 'page'] = bindingId.split('.');
    return namespace;
  }, [bindingId]);

  const surfaceSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    suggestions.add(bindingId);

    for (const surfaceId of Object.keys(theme.surfaces ?? {})) {
      if (surfaceId.startsWith(`${surfaceNamespace}.`)) {
        suggestions.add(surfaceId);
      }
    }

    if (explicitBinding?.surface) {
      suggestions.add(explicitBinding.surface);
    }

    return [...suggestions].sort();
  }, [bindingId, explicitBinding?.surface, surfaceNamespace, theme.surfaces]);

  const normalizedRendererSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    for (const rendererId of rendererSuggestions) {
      const normalized = rendererId.trim();
      if (normalized) {
        suggestions.add(normalized);
      }
    }

    if (explicitBinding?.renderer) {
      suggestions.add(explicitBinding.renderer);
    }

    return [...suggestions].sort();
  }, [explicitBinding?.renderer, rendererSuggestions]);

  const resolveSurfaceDocumentId = useCallback((): ThemeSurfaceId => {
    const draftSurfaceId = surfaceDraft.trim();
    if (draftSurfaceId) {
      return draftSurfaceId as ThemeSurfaceId;
    }

    const explicitSurfaceId =
      typeof explicitBinding?.surface === 'string' ? explicitBinding.surface.trim() : '';
    if (explicitSurfaceId) {
      return explicitSurfaceId as ThemeSurfaceId;
    }

    return bindingId as ThemeSurfaceId;
  }, [bindingId, explicitBinding?.surface, surfaceDraft]);

  const surfaceDocumentId = useMemo(() => resolveSurfaceDocumentId(), [resolveSurfaceDocumentId]);

  const surfaceDocument = useMemo(
    () => theme.surfaces?.[surfaceDocumentId] ?? null,
    [surfaceDocumentId, theme.surfaces]
  );

  const bindingSource = useMemo(() => {
    if (theme.bindings?.[bindingId]) return 'binding';
    if (theme.surfaces?.[bindingId]) return 'surface';
    return 'none';
  }, [bindingId, theme.bindings, theme.surfaces]);

  const bindingPreview = useMemo(
    () => ({
      bindingId,
      targetSurfaceId: surfaceDocumentId,
      explicitBinding,
      resolvedBinding,
      surfaceDocument,
      surfaceDocumentSummary: summarizeComponentTheme(surfaceDocument ?? {}),
      materializedBindingTheme: summarizeThemeImportSurface(materializedTheme),
    }),
    [bindingId, explicitBinding, materializedTheme, resolvedBinding, surfaceDocument, surfaceDocumentId]
  );

  const applySurfaceBinding = useCallback(async () => {
    const normalizedSurfaceId = surfaceDraft.trim();
    const nextBinding: ThemeBinding = {
      ...(explicitBinding ?? {}),
    };

    if (normalizedSurfaceId) {
      nextBinding.surface = normalizedSurfaceId as ThemeSurfaceId;
    } else {
      delete nextBinding.surface;
    }

    try {
      await updateBinding(bindingId, nextBinding);
      setSurfaceBindingMessage({
        kind: 'success',
        text: normalizedSurfaceId
          ? `Updated ${bindingId} -> ${normalizedSurfaceId}`
          : `Cleared explicit surface for ${bindingId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSurfaceBindingMessage({
        kind: 'error',
        text: `Failed to update ${bindingId}: ${message}`,
      });
    }
  }, [bindingId, explicitBinding, surfaceDraft, updateBinding]);

  const resetSurfaceBindingDraft = useCallback(() => {
    setSurfaceDraft(typeof explicitBinding?.surface === 'string' ? explicitBinding.surface : '');
    setSurfaceBindingMessage(null);
  }, [explicitBinding?.surface]);

  const clearSurfaceBinding = useCallback(async () => {
    const nextBinding: ThemeBinding = {
      ...(explicitBinding ?? {}),
    };
    delete nextBinding.surface;

    try {
      await updateBinding(bindingId, nextBinding);
      setSurfaceDraft('');
      setSurfaceBindingMessage({
        kind: 'success',
        text: `Cleared explicit surface for ${bindingId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSurfaceBindingMessage({
        kind: 'error',
        text: `Failed to clear ${bindingId}: ${message}`,
      });
    }
  }, [bindingId, explicitBinding, updateBinding]);

  const applyBindingFields = useCallback(async () => {
    const nextBinding: ThemeBinding = {
      ...(explicitBinding ?? {}),
    };
    const normalizedRenderer = bindingRendererDraft.trim();
    const normalizedVariant = bindingVariantDraft.trim();

    if (normalizedRenderer) {
      nextBinding.renderer = normalizedRenderer;
    } else {
      delete nextBinding.renderer;
    }

    if (normalizedVariant) {
      nextBinding.variant = normalizedVariant;
    } else {
      delete nextBinding.variant;
    }

    try {
      const nextProps = parseBindingPropsJson(bindingPropsJson);
      if (Object.keys(nextProps).length > 0) {
        nextBinding.props = nextProps;
      } else {
        delete nextBinding.props;
      }

      await updateBinding(bindingId, nextBinding);
      setBindingFieldsMessage({
        kind: 'success',
        text: `Updated binding overrides for ${bindingId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindingFieldsMessage({
        kind: 'error',
        text: `Failed to update binding overrides for ${bindingId}: ${message}`,
      });
    }
  }, [
    bindingId,
    bindingPropsJson,
    bindingRendererDraft,
    bindingVariantDraft,
    explicitBinding,
    updateBinding,
  ]);

  const resetBindingFieldsDraft = useCallback(() => {
    setBindingRendererDraft(typeof explicitBinding?.renderer === 'string' ? explicitBinding.renderer : '');
    setBindingVariantDraft(typeof explicitBinding?.variant === 'string' ? explicitBinding.variant : '');
    setBindingPropsJson(JSON.stringify(isPlainObject(explicitBinding?.props) ? explicitBinding.props : {}, null, 2));
    setBindingFieldsMessage(null);
  }, [explicitBinding?.props, explicitBinding?.renderer, explicitBinding?.variant]);

  const clearBindingFields = useCallback(async () => {
    const nextBinding: ThemeBinding = {
      ...(explicitBinding ?? {}),
    };
    delete nextBinding.renderer;
    delete nextBinding.variant;
    delete nextBinding.props;

    try {
      await updateBinding(bindingId, nextBinding);
      setBindingFieldsMessage({
        kind: 'success',
        text: `Cleared binding overrides for ${bindingId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindingFieldsMessage({
        kind: 'error',
        text: `Failed to clear binding overrides for ${bindingId}: ${message}`,
      });
    }
  }, [bindingId, explicitBinding, updateBinding]);

  const clearBinding = useCallback(async () => {
    try {
      await updateBinding(bindingId, {});
      setSurfaceBindingMessage({
        kind: 'success',
        text: `Cleared binding for ${bindingId}`,
      });
      setBindingFieldsMessage(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBindingFieldsMessage({
        kind: 'error',
        text: `Failed to clear binding for ${bindingId}: ${message}`,
      });
    }
  }, [bindingId, updateBinding]);

  const applySurfaceTheme = useCallback(async () => {
    try {
      const nextSurfaceTheme = parseComponentThemeJson(surfaceThemeJson);
      await updateSurfaceTheme(surfaceDocumentId, nextSurfaceTheme);
      setSurfaceThemeMessage({
        kind: 'success',
        text:
          Object.keys(nextSurfaceTheme).length > 0
            ? `Updated surface document ${surfaceDocumentId}`
            : `Cleared surface document ${surfaceDocumentId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSurfaceThemeMessage({
        kind: 'error',
        text: `Failed to update surface ${surfaceDocumentId}: ${message}`,
      });
    }
  }, [surfaceDocumentId, surfaceThemeJson, updateSurfaceTheme]);

  const resetSurfaceThemeDraft = useCallback(() => {
    setSurfaceThemeJson(JSON.stringify(theme.surfaces?.[surfaceDocumentId] ?? {}, null, 2));
    setSurfaceThemeMessage(null);
  }, [surfaceDocumentId, theme.surfaces]);

  const clearSurfaceTheme = useCallback(async () => {
    try {
      await updateSurfaceTheme(surfaceDocumentId, {});
      setSurfaceThemeMessage({
        kind: 'success',
        text: `Cleared surface document ${surfaceDocumentId}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSurfaceThemeMessage({
        kind: 'error',
        text: `Failed to clear surface ${surfaceDocumentId}: ${message}`,
      });
    }
  }, [surfaceDocumentId, updateSurfaceTheme]);

  useEffect(() => {
    setSurfaceDraft(typeof explicitBinding?.surface === 'string' ? explicitBinding.surface : '');
    setSurfaceBindingMessage(null);
  }, [bindingId, explicitBinding?.surface]);

  useEffect(() => {
    setBindingRendererDraft(typeof explicitBinding?.renderer === 'string' ? explicitBinding.renderer : '');
    setBindingVariantDraft(typeof explicitBinding?.variant === 'string' ? explicitBinding.variant : '');
    setBindingPropsJson(JSON.stringify(isPlainObject(explicitBinding?.props) ? explicitBinding.props : {}, null, 2));
    setBindingFieldsMessage(null);
  }, [bindingId, explicitBinding?.props, explicitBinding?.renderer, explicitBinding?.variant]);

  useEffect(() => {
    setSurfaceThemeJson(JSON.stringify(theme.surfaces?.[surfaceDocumentId] ?? {}, null, 2));
    setSurfaceThemeMessage(null);
  }, [surfaceDocumentId, theme.surfaces]);

  return {
    explicitBinding,
    resolvedBinding,
    resolvedTheme,
    bindingSource,
    bindingPreview,
    surfaceDocument,
    surfaceDocumentId,
    surfaceSuggestions,
    rendererSuggestions: normalizedRendererSuggestions,
    surfaceDraft,
    setSurfaceDraft,
    bindingRendererDraft,
    setBindingRendererDraft,
    bindingVariantDraft,
    setBindingVariantDraft,
    bindingPropsJson,
    setBindingPropsJson,
    surfaceThemeJson,
    setSurfaceThemeJson,
    surfaceBindingMessage,
    bindingFieldsMessage,
    surfaceThemeMessage,
    applySurfaceBinding,
    resetSurfaceBindingDraft,
    clearSurfaceBinding,
    applyBindingFields,
    resetBindingFieldsDraft,
    clearBindingFields,
    clearBinding,
    applySurfaceTheme,
    resetSurfaceThemeDraft,
    clearSurfaceTheme,
  };
}
