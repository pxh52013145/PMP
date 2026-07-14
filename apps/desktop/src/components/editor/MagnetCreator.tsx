import { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { Magnet, PixelAnchor, AnchorType } from '../../types/pixel';
import { useEditor } from '../../contexts/EditorContext';
import { MagnetComponent } from '../magnet/Magnet';
import { computeMagnetVisualBounds } from '../../modules/magnets/geometry';
import { getMagnetOccupiedPixels } from '../../utils/magnetEditor';
import {
  getMagnetVariantsRevision,
  listMagnetVariants,
  subscribeMagnetVariants,
} from '../../magnet-system/variantRegistry';
import {
  getMagnetPreviewNode,
  getMagnetRenderersRevision,
  subscribeMagnetRenderers,
} from '../../magnet-system/registry';
import {
  appendMagnetHistory,
  loadMagnetHistory,
  saveMagnetHistory,
  type MagnetHistoryItem,
} from './magnetCreatorHistory';
import {
  type InsetDraft,
  INSET_SIDES,
  PREVIEW_PIXEL_POSITIONS,
  PREVIEW_STAGE_SIZE,
  buildAnchorsFromOrigin,
  buildEditorMagnet,
  buildMagnetGridFootprint,
  createEmptyInsetDraft,
  createInsetDraft,
  getPreviewScaleFromBounds,
  hasMagnetConfigChanges,
  normalizeMagnetVariant,
  parseInsetDraft,
  parseMagnetSkinPropsDraft,
  resolveMagnetAnchorDraftDimensions,
  resolveMagnetAnchorOrigin,
  resolvePreviewAnchorOrigin,
} from './magnetCreatorModel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import { DEFAULT_MAGNET_TRANSITION } from '../../modules/magnets/chromePresets';
import { useLocale, useT } from '../../i18n';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { MagnetPreviewBoundary } from './MagnetPreviewBoundary';
import './MagnetCreator.css';

interface MagnetCreatorProps {
  mode: 'create' | 'edit';
  editingMagnet?: Magnet;
  defaultMagnet?: Magnet;
  onSave: (magnet: Magnet) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
}

type MagnetHistory = MagnetHistoryItem;
type AnchorValidationState = {
  hasErrors: boolean;
  errors: string[];
  warnings: string[];
};

function AnchorValidationNotice({
  validation,
  t,
}: {
  validation: AnchorValidationState;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  if (validation.hasErrors) {
    return (
      <div className="creator-validation-error">
        <div>{t('editor.magnet-creator.validation.outOfBounds')}</div>
        {validation.errors.map((err, index) => (
          <div key={`${index}:${err}`}>{err}</div>
        ))}
      </div>
    );
  }

  if (validation.warnings.length > 0) {
    return (
      <div className="creator-validation-warning">
        <div>{t('editor.magnet-creator.validation.hintTitle')}</div>
        {validation.warnings.map((warn, index) => (
          <div key={`${index}:${warn}`}>{warn}</div>
        ))}
      </div>
    );
  }

  return null;
}

export function MagnetCreator({
  mode,
  editingMagnet,
  defaultMagnet,
  onSave,
  onCancel,
}: MagnetCreatorProps) {
  const t = useT();
  const locale = useLocale();
  const { occupancyMap } = useEditor();
  const windowActivity = useWindowActivity();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [anchorType, setAnchorType] = useState<AnchorType>('single');
  const [content, setContent] = useState('');
  const [chromeInsetDraft, setChromeInsetDraft] = useState<InsetDraft>(createEmptyInsetDraft());
  const [chromeOutsetDraft, setChromeOutsetDraft] = useState<InsetDraft>(createEmptyInsetDraft());
  const [horizontalPixels, setHorizontalPixels] = useState(5);
  const [verticalPixels, setVerticalPixels] = useState(3);
  const [rectWidth, setRectWidth] = useState(5);
  const [rectHeight, setRectHeight] = useState(3);
  const [styleJson, setStyleJson] = useState<string>(`{
  "width": "36px",
  "height": "36px",
  "backgroundColor": "rgba(0, 0, 0, 0.7)",
  "borderRadius": "2.7px",
  "display": "flex",
  "alignItems": "center",
  "justifyContent": "center",
  "cursor": "pointer"
}`);
  const [boundsJson, setBoundsJson] = useState<string>(() =>
    JSON.stringify(createDefaultBoundsForMagnet('single', { width: '36px', height: '36px' }), null, 2)
  );
  const [animationJson, setAnimationJson] = useState<string>(() =>
    JSON.stringify(
      {
        transition: DEFAULT_MAGNET_TRANSITION,
        hoverStyle: {
          transform: 'scale(1.05)',
          filter: 'brightness(1.1)',
        },
        activeStyle: {
          transform: 'scale(0.95)',
          filter: 'brightness(0.9)',
        },
      },
      null,
      2
    )
  );
  const [variant, setVariant] = useState('');
  const [skinPropsJson, setSkinPropsJson] = useState('{}');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MagnetHistory[]>([]);
  const [sourceMagnet, setSourceMagnet] = useState<Magnet | null>(editingMagnet ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const isBuiltinMagnet = useMemo(() => {
    return mode === 'edit' && defaultMagnet !== undefined;
  }, [mode, defaultMagnet]);
  const parsedStyleResult = useMemo(() => {
    try {
      return {
        value: JSON.parse(styleJson) as Magnet['style'],
        error: '',
      };
    } catch (error) {
      return {
        value: {} as Magnet['style'],
        error: 'common.error.jsonFormat',
      };
    }
  }, [styleJson]);
  const parsedStyle = parsedStyleResult.value;
  const styleError = parsedStyleResult.error;
  const parsedAnimationResult = useMemo(() => {
    try {
      return {
        value: JSON.parse(animationJson) as Magnet['animation'],
        error: '',
      };
    } catch (error) {
      return {
        value: undefined,
        error: 'common.error.jsonFormat',
      };
    }
  }, [animationJson]);
  const parsedAnimation = parsedAnimationResult.value;
  const animationError = parsedAnimationResult.error;

  const parsedChromeInset = useMemo(() => parseInsetDraft(chromeInsetDraft), [chromeInsetDraft]);
  const parsedChromeOutset = useMemo(() => parseInsetDraft(chromeOutsetDraft), [chromeOutsetDraft]);
  const parsedSkinPropsResult = useMemo(() => {
    try {
      const parsed = parseMagnetSkinPropsDraft(skinPropsJson);
      return {
        value: parsed,
        error: '',
      };
    } catch {
      return {
        value: null,
        error: 'editor.magnet-library.editor.error.skinPropsObject',
      };
    }
  }, [skinPropsJson]);
  const parsedSkinProps = parsedSkinPropsResult.value;
  const skinPropsError = parsedSkinPropsResult.error;

  const parsedBoundsResult = useMemo(() => {
    try {
      const parsed = JSON.parse(boundsJson) as Magnet['bounds'];
      if (
        !parsed ||
        !parsed.horizontal?.start ||
        !parsed.horizontal?.end ||
        !parsed.vertical?.start ||
        !parsed.vertical?.end
      ) {
        throw new Error('invalid-bounds');
      }

      return {
        value: parsed,
        error: '',
      };
    } catch (error) {
      return {
        value: undefined,
        error: 'common.error.jsonFormat',
      };
    }
  }, [boundsJson]);
  const parsedBounds = parsedBoundsResult.value;
  const boundsError = parsedBoundsResult.error;

  const anchorDimensions = useMemo(
    () => ({ horizontalPixels, verticalPixels, rectWidth, rectHeight }),
    [horizontalPixels, verticalPixels, rectWidth, rectHeight]
  );

  const loadMagnetConfig = useCallback((magnet: Magnet) => {
    setIsSaving(false);
    setSourceMagnet(magnet);
    setId(magnet.id);
    setName(magnet.name);
    setAnchorType(magnet.anchorType);
    setContent(typeof magnet.content === 'string' ? magnet.content : '');
    setBoundsJson(JSON.stringify(magnet.bounds, null, 2));
    setChromeInsetDraft(createInsetDraft(magnet.chrome?.inset));
    setChromeOutsetDraft(createInsetDraft(magnet.chrome?.outset));

    const dimensions = resolveMagnetAnchorDraftDimensions(magnet);
    setHorizontalPixels(dimensions.horizontalPixels);
    setVerticalPixels(dimensions.verticalPixels);
    setRectWidth(dimensions.rectWidth);
    setRectHeight(dimensions.rectHeight);

    if (magnet.style) {
      setStyleJson(JSON.stringify(magnet.style, null, 2));
    }

    if (magnet.animation) {
      setAnimationJson(JSON.stringify(magnet.animation, null, 2));
    }

    setVariant(magnet.variant ?? '');
    setSkinPropsJson(JSON.stringify(magnet.skinProps ?? {}, null, 2));
  }, []);

  useEffect(() => {
    if (mode === 'edit' && editingMagnet) {
      loadMagnetConfig(editingMagnet);

      setHistory(loadMagnetHistory(editingMagnet.id));
    }
  }, [mode, editingMagnet, loadMagnetConfig]);

  const generateAnchors = useMemo((): PixelAnchor[] => {
    const origin = resolvePreviewAnchorOrigin(anchorType, anchorDimensions);
    return buildAnchorsFromOrigin(anchorType, origin.x, origin.y, anchorDimensions);
  }, [anchorType, anchorDimensions]);

  const anchorsValidation = useMemo(() => {
    const maxX = 26;
    const maxY = 19;
    const errors: string[] = [];
    const warnings: string[] = [];

    let anchorsToValidate: PixelAnchor[];
    const isCatalogFootprintOnly =
      mode === 'edit' && editingMagnet && (editingMagnet.anchors?.length ?? 0) === 0;

    if (mode === 'edit' && editingMagnet) {
      const origin = resolveMagnetAnchorOrigin(editingMagnet);

      anchorsToValidate = buildAnchorsFromOrigin(
        anchorType,
        origin.x,
        origin.y,
        anchorDimensions
      );
    } else {

      anchorsToValidate = generateAnchors;
    }

    if (!isCatalogFootprintOnly) {
      anchorsToValidate.forEach((anchor) => {
        if (anchor.gridX < 0 || anchor.gridX > maxX) {
          errors.push(
            t('editor.magnet-creator.validation.anchorOutOfRangeX', {
              id: anchor.id,
              value: anchor.gridX,
            })
          );
        }
        if (anchor.gridY < 0 || anchor.gridY > maxY) {
          errors.push(
            t('editor.magnet-creator.validation.anchorOutOfRangeY', {
              id: anchor.id,
              value: anchor.gridY,
            })
          );
        }
      });
    }

    if (
      mode === 'edit' &&
      editingMagnet &&
      !isCatalogFootprintOnly &&
      anchorsToValidate.length > 0
    ) {

      const tempMagnet: Magnet = {
        ...editingMagnet,
        anchorType,
        anchors: anchorsToValidate,
      };

      const occupiedPixels = getMagnetOccupiedPixels(tempMagnet);

      const conflictingPixels: Array<{ x: number; y: number; occupiedBy: string }> = [];
      occupiedPixels.forEach((pixel) => {
        const key = `${pixel.x},${pixel.y}`;
        const occupancy = occupancyMap.get(key);

        if (
          occupancy?.isOccupied &&
          occupancy.occupiedBy &&
          occupancy.occupiedBy !== editingMagnet.id
        ) {
          conflictingPixels.push({
            x: pixel.x,
            y: pixel.y,
            occupiedBy: occupancy.occupiedBy,
          });
        }
      });

      if (conflictingPixels.length > 0) {

        const conflictingMagnets = new Set(conflictingPixels.map((p) => p.occupiedBy));
        errors.push(
          t('editor.magnet-creator.validation.conflict', {
            magnets: conflictingMagnets.size,
            pixels: conflictingPixels.length,
          })
        );
      }
    }

    if (mode === 'create') {
      if (anchorType === 'horizontal' && horizontalPixels > 17) {
        warnings.push(t('editor.magnet-creator.validation.largeWidthWarning'));
      }
      if (anchorType === 'vertical' && verticalPixels > 10) {
        warnings.push(t('editor.magnet-creator.validation.largeHeightWarning'));
      }
      if (anchorType === 'rectangular') {
        if (rectWidth > 17) warnings.push(t('editor.magnet-creator.validation.largeWidthWarning'));
        if (rectHeight > 10) warnings.push(t('editor.magnet-creator.validation.largeHeightWarning'));
      }
    }

    return { hasErrors: errors.length > 0, errors, warnings };
  }, [
    mode,
    editingMagnet,
    generateAnchors,
    anchorDimensions,
    anchorType,
    horizontalPixels,
    verticalPixels,
    rectWidth,
    rectHeight,
    occupancyMap,
    t,
  ]);
  const previewMagnet = useMemo<Magnet | null>(() => {
    if (!id || !name || !parsedBounds) return null;

    return buildEditorMagnet({
      seedMagnet: sourceMagnet ?? undefined,
      id,
      name,
      anchorType,
      anchors: generateAnchors,
      gridFootprint: buildMagnetGridFootprint(anchorType, anchorDimensions),
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
      variant,
      skinProps: parsedSkinProps,
    });
  }, [
    anchorType,
    content,
    generateAnchors,
    id,
    name,
    parsedAnimation,
    parsedBounds,
    parsedChromeInset,
    parsedChromeOutset,
    parsedSkinProps,
    parsedStyle,
    variant,
    sourceMagnet,
    anchorDimensions,
  ]);

  const previewBounds = useMemo(() => {
    if (!previewMagnet) return null;
    return computeMagnetVisualBounds(previewMagnet, PREVIEW_PIXEL_POSITIONS);
  }, [previewMagnet]);

  const previewScale = useMemo(() => getPreviewScaleFromBounds(previewBounds), [previewBounds]);
  const shouldRenderPreview = windowActivity.isVisible && previewMagnet !== null;

  const handleSave = () => {
    if (isSaving || !id || !name || !parsedBounds) return;

    const preserveCatalogFootprint =
      mode === 'edit' && editingMagnet && (editingMagnet.anchors?.length ?? 0) === 0;
    const origin = editingMagnet ? resolveMagnetAnchorOrigin(editingMagnet) : { x: 10, y: 10 };
    const anchorsToSave = preserveCatalogFootprint
      ? []
      : buildAnchorsFromOrigin(anchorType, origin.x, origin.y, anchorDimensions);

    const magnetToSave = buildEditorMagnet({
      seedMagnet: sourceMagnet ?? editingMagnet ?? undefined,
      fallbackType: editingMagnet?.type ?? 'custom',
      fallbackInteractions: editingMagnet?.interactions,
      id,
      name,
      anchorType,
      anchors: anchorsToSave,
      gridFootprint: buildMagnetGridFootprint(anchorType, anchorDimensions),
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
      variant: normalizeMagnetVariant(variant),
      skinProps: parsedSkinProps,
    });

    const lastMagnet = mode === 'edit' && history.length > 0 ? history[0].magnet : null;

    if (hasMagnetConfigChanges(lastMagnet, magnetToSave)) {
      appendMagnetHistory(
        magnetToSave,
        mode === 'create'
          ? 'editor.magnet-creator.history.created'
          : 'editor.magnet-creator.history.editedSave'
      );
    }

    setIsSaving(true);
    void Promise.resolve(onSave(magnetToSave)).catch(() => {
      setIsSaving(false);
    });
  };

  const handleRestore = () => {
    if (!defaultMagnet) return;
    loadMagnetConfig(defaultMagnet);
    appendMagnetHistory(defaultMagnet, 'editor.magnet-creator.history.restoreDefault');
  };

  const handleApplyHistory = (historyItem: MagnetHistory) => {
    loadMagnetConfig(historyItem.magnet);
    setShowHistory(false);
  };

  const handleDeleteHistory = (historyId: string) => {
    const newHistory = history.filter((h) => h.id !== historyId);
    setHistory(newHistory);
    if (editingMagnet) {
      saveMagnetHistory(editingMagnet.id, newHistory);
    }
  };

  const isValid = Boolean(
    id &&
      name &&
      !anchorsValidation.hasErrors &&
      !boundsError &&
      !styleError &&
      !animationError &&
      !skinPropsError
  );
  const rendererRevision = useSyncExternalStore(
    subscribeMagnetRenderers,
    getMagnetRenderersRevision,
    getMagnetRenderersRevision
  );
  const variantRevision = useSyncExternalStore(
    subscribeMagnetVariants,
    getMagnetVariantsRevision,
    getMagnetVariantsRevision
  );
  const rendererId = sourceMagnet?.renderer ?? sourceMagnet?.id ?? id;
  const rendererVariants = useMemo(() => {
    void variantRevision;
    return rendererId ? listMagnetVariants(rendererId) : [];
  }, [rendererId, variantRevision]);
  const selectableRendererVariants = useMemo(
    () => rendererVariants.filter((candidate) => candidate.id !== 'default'),
    [rendererVariants]
  );
  const selectedVariantKnown =
    !variant || rendererVariants.some((candidate) => candidate.id === variant);
  const staticPreviewContent = useMemo(() => {
    void rendererRevision;
    return previewMagnet ? getMagnetPreviewNode(previewMagnet) : null;
  }, [previewMagnet, rendererRevision]);
  const shouldMountLiveRenderer =
    windowActivity.isActive && selectableRendererVariants.length > 0;

  return (
    <div className="editor-creator">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.creator.title')}
        </span>
      </div>

      <div className="creator-preview-fixed">
        <div className="creator-section-title">{t('editor.magnet-creator.preview.title')}</div>
        {shouldRenderPreview ? (
          <>
            <div className="creator-preview">
              <div
                className="creator-preview-content"
                style={{
                  transform: `scale(${previewScale})`,
                  transition: 'transform 0.2s ease',
                }}
              >
                <div
                  className="creator-preview-stage"
                  style={{
                    width: `${PREVIEW_STAGE_SIZE}px`,
                    height: `${PREVIEW_STAGE_SIZE}px`,
                  }}
                >
                  <MagnetPreviewBoundary
                    key={`${previewMagnet.id}:${rendererId}:${variant}:${shouldMountLiveRenderer}`}
                    magnetId={previewMagnet.id}
                    fallback={staticPreviewContent ?? previewMagnet.name}
                  >
                    <MagnetComponent
                      magnet={previewMagnet}
                      pixelPositions={PREVIEW_PIXEL_POSITIONS}
                      disableMotion={windowActivity.renderMode !== 'full'}
                      rendererContentOverride={
                        shouldMountLiveRenderer
                          ? undefined
                          : (staticPreviewContent ?? previewMagnet.name)
                      }
                    />
                  </MagnetPreviewBoundary>
                </div>
              </div>
            </div>
            <div className="creator-preview-hint">
              {t('editor.magnet-creator.preview.hintHover')}
              <br />
              {t('editor.magnet-creator.preview.hintActive')}
              {previewBounds && previewScale < 1 && (
                <>
                  <br />
                  <span style={{ color: 'rgba(255, 204, 0, 0.9)' }}>
                    {t('editor.magnet-creator.preview.scaled', {
                      percent: Math.round(previewScale * 100),
                    })}
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="creator-preview-empty">{t('editor.magnet-creator.preview.empty')}</div>
        )}
      </div>

      <div className="editor-window-content">
        <div className="creator-mode-title">
          {t('editor.magnet-creator.mode.edit')}
        </div>

        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.basic')}</div>
          <div className="creator-form">
            {/* ID */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.id')} <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="my-magnet"
                disabled={mode === 'edit'}
              />
            </div>

            {/* Name */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.name')} <span className="creator-required">*</span>
              </label>
              <input
                type="text"
                className="creator-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('editor.magnet-creator.field.name.placeholder')}
              />
            </div>

            {/* Content */}
            <div className="creator-form-row">
              <label className="creator-label">{t('editor.magnet-creator.field.content')}</label>
              <input
                type="text"
                className="creator-input"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('editor.magnet-creator.field.content.placeholder')}
              />
            </div>

            {/* Anchor Type */}
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-creator.field.anchorType')}{' '}
                <span className="creator-required">*</span>
              </label>
              <select
                className="creator-select"
                value={anchorType}
                onChange={(e) => {
                  const nextAnchorType = e.target.value as AnchorType;
                  setAnchorType(nextAnchorType);
                  setBoundsJson(JSON.stringify(createDefaultBoundsForMagnet(nextAnchorType, parsedStyle), null, 2));
                }}
              >
                <option value="single">{t('editor.magnet-creator.anchorType.single')}</option>
                <option value="horizontal">{t('editor.magnet-creator.anchorType.horizontal')}</option>
                <option value="vertical">{t('editor.magnet-creator.anchorType.vertical')}</option>
                <option value="rectangular">
                  {t('editor.magnet-creator.anchorType.rectangular')}
                </option>
              </select>
            </div>

            {/* Horizontal Pixel Count */}
            {anchorType === 'horizontal' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.horizontalPixels')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={horizontalPixels}
                      onChange={(e) => setHorizontalPixels(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={horizontalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setHorizontalPixels(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                <AnchorValidationNotice validation={anchorsValidation} t={t} />
              </>
            )}

            {/* Vertical Pixel Count */}
            {anchorType === 'vertical' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.verticalPixels')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={verticalPixels}
                      onChange={(e) => setVerticalPixels(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={verticalPixels}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setVerticalPixels(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                <AnchorValidationNotice validation={anchorsValidation} t={t} />
              </>
            )}

            {/* Rectangular Dimensions */}
            {anchorType === 'rectangular' && (
              <>
                <div className="creator-form-row">
                  <label className="creator-label">{t('editor.magnet-creator.field.rectWidth')}</label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectWidth}
                      onChange={(e) => setRectWidth(parseInt(e.target.value))}
                      min="1"
                      max="27"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectWidth}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectWidth(Math.max(1, Math.min(27, val)));
                      }}
                      min="1"
                      max="27"
                    />
                  </div>
                </div>
                <div className="creator-form-row">
                  <label className="creator-label">
                    {t('editor.magnet-creator.field.rectHeight')}
                  </label>
                  <div className="creator-slider-group">
                    <input
                      type="range"
                      className="creator-slider"
                      value={rectHeight}
                      onChange={(e) => setRectHeight(parseInt(e.target.value))}
                      min="1"
                      max="20"
                      step="1"
                    />
                    <input
                      type="number"
                      className="creator-input creator-input-number"
                      value={rectHeight}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 1;
                        setRectHeight(Math.max(1, Math.min(20, val)));
                      }}
                      min="1"
                      max="20"
                    />
                  </div>
                </div>
                <AnchorValidationNotice validation={anchorsValidation} t={t} />
              </>
            )}
          </div>
        </div>

        <div className="creator-section">
          <div className="creator-section-title">
            {t('editor.magnet-library.editor.section.appearance')}
          </div>
          <div className="creator-form">
            <div className="creator-form-row">
              <label className="creator-label">
                {t('editor.magnet-library.magnet.variant.label')}
              </label>
              {selectableRendererVariants.length > 0 ? (
                <select
                  className="creator-select"
                  value={variant === 'default' ? '' : variant}
                  onChange={(e) => setVariant(e.target.value)}
                >
                  <option value="">{t('editor.magnet-library.magnet.variant.default')}</option>
                  {selectableRendererVariants.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </option>
                  ))}
                  {variant && !selectedVariantKnown ? (
                    <option value={variant}>
                      {t('editor.magnet-library.magnet.variant.unknown', { variant })}
                    </option>
                  ) : null}
                </select>
              ) : variant ? (
                <button
                  type="button"
                  className="creator-variant-clear"
                  onClick={() => setVariant('')}
                >
                  {t('common.action.clear')}: {variant}
                </button>
              ) : null}
            </div>
            <div className="creator-hint">
              {selectableRendererVariants.length > 0
                ? t('editor.magnet-library.magnet.variant.hint', {
                    count: selectableRendererVariants.length,
                  })
                : t('editor.magnet-library.editor.variantEmpty', { rendererId: rendererId || '-' })}
            </div>
            <div className="creator-form-column">
              <label className="creator-label">
                {t('editor.magnet-library.editor.field.skinProps')}
              </label>
              <textarea
                className="creator-textarea"
                value={skinPropsJson}
                onChange={(e) => setSkinPropsJson(e.target.value)}
                spellCheck={false}
                rows={6}
              />
              {skinPropsError && <div className="creator-error">{t(skinPropsError)}</div>}
            </div>
          </div>
        </div>

        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.layout')}</div>
          <div className="creator-form">
            <div className="creator-layout-hint">{t('editor.magnet-creator.layout.hint')}</div>
            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.boundsTitle')}
              </div>
              <div className="creator-layout-hint">{t('editor.magnet-creator.layout.boundsHint')}</div>
              <div className="creator-form-column">
                <textarea
                  className="creator-textarea"
                  value={boundsJson}
                  onChange={(e) => setBoundsJson(e.target.value)}
                  placeholder='{"horizontal":{"start":{"source":"slot","edge":"center","offset":-18},"end":{"source":"slot","edge":"center","offset":18}},"vertical":{"start":{"source":"slot","edge":"center","offset":-18},"end":{"source":"slot","edge":"center","offset":18}}}'
                  rows={12}
                />
                {boundsError && <div className="creator-error">{t(boundsError)}</div>}
              </div>
            </div>

            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.chromeInsetTitle')}
              </div>
              <div className="creator-layout-hint">
                {t('editor.magnet-creator.layout.chromeInsetHint')}
              </div>
              <div className="creator-layout-grid">
                {INSET_SIDES.map((side) => (
                  <div key={`chrome-${side}`} className="creator-form-column">
                    <label className="creator-label">
                      {t(`editor.magnet-creator.field.chromeInset${side[0].toUpperCase()}${side.slice(1)}`)}
                    </label>
                    <input
                      type="number"
                      className="creator-input creator-input-number creator-layout-input"
                      value={chromeInsetDraft[side]}
                      onChange={(e) =>
                        setChromeInsetDraft((current) => ({
                          ...current,
                          [side]: e.target.value,
                        }))
                      }
                      min="0"
                      step="1"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="creator-layout-subsection">
              <div className="creator-layout-subtitle">
                {t('editor.magnet-creator.layout.chromeOutsetTitle')}
              </div>
              <div className="creator-layout-hint">
                {t('editor.magnet-creator.layout.chromeOutsetHint')}
              </div>
              <div className="creator-layout-grid">
                {INSET_SIDES.map((side) => (
                  <div key={`chrome-outset-${side}`} className="creator-form-column">
                    <label className="creator-label">
                      {t(`editor.magnet-creator.field.chromeOutset${side[0].toUpperCase()}${side.slice(1)}`)}
                    </label>
                    <input
                      type="number"
                      className="creator-input creator-input-number creator-layout-input"
                      value={chromeOutsetDraft[side]}
                      onChange={(e) =>
                        setChromeOutsetDraft((current) => ({
                          ...current,
                          [side]: e.target.value,
                        }))
                      }
                      min="0"
                      step="1"
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="creator-section">
          <div className="creator-section-title">{t('editor.magnet-creator.section.styleJson')}</div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">
                {t('editor.magnet-creator.styleJson.label')} <span className="creator-required">*</span>
              </label>
              <textarea
                className="creator-textarea"
                value={styleJson}
                onChange={(e) => setStyleJson(e.target.value)}
                placeholder='{"width": "36px", "height": "36px", ...}'
                rows={10}
              />
              {styleError && <div className="creator-error">{t(styleError)}</div>}
              <div className="creator-hint">
                {t('editor.magnet-creator.styleJson.commonStyles')}
              </div>
            </div>
          </div>
        </div>

        <div className="creator-section">
          <div className="creator-section-title">
            {t('editor.magnet-creator.section.animationJson')}
          </div>
          <div className="creator-form">
            <div className="creator-form-column">
              <label className="creator-label">{t('editor.magnet-creator.animationJson.label')}</label>
              <textarea
                className="creator-textarea"
                value={animationJson}
                onChange={(e) => setAnimationJson(e.target.value)}
                placeholder='{"transition": "opacity 140ms ease, transform 140ms ease", "hoverStyle": {...}, "activeStyle": {...}}'
                rows={12}
              />
              {animationError && <div className="creator-error">{t(animationError)}</div>}
              <div className="creator-hint">
                <div>{t('editor.magnet-creator.animation.hint.title')}</div>
                <div>
                  <strong>transition</strong>: {t('editor.magnet-creator.animation.hint.transition')}
                </div>
                <div>
                  <strong>hoverStyle</strong>: {t('editor.magnet-creator.animation.hint.hoverStyle')}
                </div>
                <div>
                  <strong>activeStyle</strong>: {t('editor.magnet-creator.animation.hint.activeStyle')}
                </div>
                <div>{t('editor.magnet-creator.animation.hint.commonProps')}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="creator-footer-fixed">
        <button className="creator-btn creator-btn-cancel" onClick={onCancel}>
          {t('common.action.cancel')}
        </button>
        {isBuiltinMagnet && (
          <button className="creator-btn creator-btn-restore" onClick={handleRestore}>
            {t('editor.magnet-creator.action.restoreDefault')}
          </button>
        )}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-history"
            onClick={() => setShowHistory(!showHistory)}
          >
            {history.length > 0
              ? t('editor.magnet-creator.action.historyWithCount', { count: history.length })
              : t('editor.magnet-creator.action.history')}
          </button>
        )}
        <button
          className="creator-btn creator-btn-save"
          onClick={handleSave}
          disabled={!isValid || isSaving}
        >
          {t('common.action.done')}
        </button>
      </div>

      {showHistory && mode === 'edit' && (
        <div className="creator-history-panel">
          <div className="creator-history-header">
            <h3>{t('editor.magnet-creator.history.title')}</h3>
          </div>
          <div className="creator-history-list">
            {history.length === 0 ? (
              <div className="creator-history-empty">{t('editor.magnet-creator.history.empty')}</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="creator-history-item">
                  <div className="creator-history-item-info">
                    <div className="creator-history-item-desc">{t(item.description)}</div>
                    <div className="creator-history-item-time">
                      {new Date(item.timestamp).toLocaleString(locale, {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="creator-history-item-actions">
                    <button
                      className="creator-history-btn creator-history-btn-apply"
                      onClick={() => handleApplyHistory(item)}
                      title={t('editor.magnet-creator.history.action.applyTitle')}
                    >
                      {t('common.action.apply')}
                    </button>
                    <button
                      className="creator-history-btn creator-history-btn-delete"
                      onClick={() => handleDeleteHistory(item.id)}
                      title={t('editor.magnet-creator.history.action.deleteTitle')}
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

    </div>
  );
}
