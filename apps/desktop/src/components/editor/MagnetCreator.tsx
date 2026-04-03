import { useState, useEffect, useMemo, useCallback } from 'react';
import { Magnet, PixelAnchor, AnchorType } from '../../types/pixel';
import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import { useEditor } from '../../contexts/EditorContext';
import { MagnetComponent } from '../magnet/Magnet';
import { computeMagnetVisualBounds } from '../../modules/magnets/geometry';
import { getMagnetOccupiedPixels } from '../../utils/magnetEditor';
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
  createEmptyInsetDraft,
  createInsetDraft,
  getPreviewScaleFromBounds,
  hasMagnetConfigChanges,
  parseInsetDraft,
} from './magnetCreatorModel';
import { createDefaultBoundsForMagnet } from '../../modules/magnets/layoutPresets';
import { DEFAULT_MAGNET_TRANSITION } from '../../modules/magnets/chromePresets';
import { useLocale, useT } from '../../i18n';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import './MagnetCreator.css';

const telemetry = getTelemetryLogger('editor', 'MagnetCreator');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface MagnetCreatorProps {
  mode: 'create' | 'edit';
  editingMagnet?: Magnet;
  defaultMagnet?: Magnet;
  onSave: (magnet: Magnet) => void;
  onCancel: () => void;
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
  const [styleError, setStyleError] = useState('');
  const [boundsError, setBoundsError] = useState('');
  const [animationError, setAnimationError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MagnetHistory[]>([]);
  const [sourceMagnet, setSourceMagnet] = useState<Magnet | null>(editingMagnet ?? null);
  const isBuiltinMagnet = useMemo(() => {
    return mode === 'edit' && defaultMagnet !== undefined;
  }, [mode, defaultMagnet]);
  const parsedStyle = useMemo(() => {
    try {
      const parsed = JSON.parse(styleJson);
      setStyleError('');
      return parsed;
    } catch (error) {
      setStyleError('common.error.jsonFormat');
      return {};
    }
  }, [styleJson]);
  const parsedAnimation = useMemo(() => {
    try {
      const parsed = JSON.parse(animationJson);
      setAnimationError('');
      return parsed;
    } catch (error) {
      setAnimationError('common.error.jsonFormat');
      return undefined;
    }
  }, [animationJson]);

  const parsedChromeInset = useMemo(() => parseInsetDraft(chromeInsetDraft), [chromeInsetDraft]);
  const parsedChromeOutset = useMemo(() => parseInsetDraft(chromeOutsetDraft), [chromeOutsetDraft]);

  const parsedBounds = useMemo(() => {
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

      setBoundsError('');
      return parsed;
    } catch (error) {
      setBoundsError('common.error.jsonFormat');
      return undefined;
    }
  }, [boundsJson]);

  const anchorDimensions = useMemo(
    () => ({ horizontalPixels, verticalPixels, rectWidth, rectHeight }),
    [horizontalPixels, verticalPixels, rectWidth, rectHeight]
  );

  const loadMagnetConfig = useCallback((magnet: Magnet) => {
    setSourceMagnet(magnet);
    setId(magnet.id);
    setName(magnet.name);
    setAnchorType(magnet.anchorType);
    setContent(typeof magnet.content === 'string' ? magnet.content : '');
    setBoundsJson(JSON.stringify(magnet.bounds, null, 2));
    setChromeInsetDraft(createInsetDraft(magnet.chrome?.inset));
    setChromeOutsetDraft(createInsetDraft(magnet.chrome?.outset));

    if (magnet.anchors.length >= 2) {
      if (magnet.anchorType === 'horizontal') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        setHorizontalPixels(width);
      } else if (magnet.anchorType === 'vertical') {
        const height = Math.abs(magnet.anchors[1].gridY - magnet.anchors[0].gridY) + 1;
        setVerticalPixels(height);
      } else if (magnet.anchorType === 'rectangular') {
        const width = Math.abs(magnet.anchors[1].gridX - magnet.anchors[0].gridX) + 1;
        const height = Math.abs(magnet.anchors[2].gridY - magnet.anchors[0].gridY) + 1;
        setRectWidth(width);
        setRectHeight(height);
      }
    }

    if (magnet.style) {
      setStyleJson(JSON.stringify(magnet.style, null, 2));
    }

    if (magnet.animation) {
      setAnimationJson(JSON.stringify(magnet.animation, null, 2));
    }
  }, []);

  useEffect(() => {
    if (mode === 'edit' && editingMagnet) {
      loadMagnetConfig(editingMagnet);

      setHistory(loadMagnetHistory(editingMagnet.id));
    }
  }, [mode, editingMagnet, loadMagnetConfig]);

  const generateAnchors = useMemo((): PixelAnchor[] => {
    return buildAnchorsFromOrigin(anchorType, 10, 10, anchorDimensions);
  }, [anchorType, anchorDimensions]);

  const anchorsValidation = useMemo(() => {
    const maxX = 26;
    const maxY = 19;
    const errors: string[] = [];
    const warnings: string[] = [];

    let anchorsToValidate: PixelAnchor[];

    if (mode === 'edit' && editingMagnet) {
      const baseAnchor = editingMagnet.anchors[0];
      const baseX = baseAnchor.gridX;
      const baseY = baseAnchor.gridY;

      anchorsToValidate = buildAnchorsFromOrigin(anchorType, baseX, baseY, anchorDimensions);
    } else {

      anchorsToValidate = generateAnchors;
    }

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

    if (mode === 'edit' && editingMagnet && anchorsToValidate.length > 0) {

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
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
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
    parsedStyle,
    sourceMagnet,
  ]);

  const previewBounds = useMemo(() => {
    if (!previewMagnet) return null;
    return computeMagnetVisualBounds(previewMagnet, PREVIEW_PIXEL_POSITIONS);
  }, [previewMagnet]);

  const previewScale = useMemo(() => getPreviewScaleFromBounds(previewBounds), [previewBounds]);

  const handleSave = () => {
    if (!id || !name || !parsedBounds) return;

    const anchorsToSave =
      mode === 'edit' && editingMagnet
        ? buildAnchorsFromOrigin(
            anchorType,
            editingMagnet.anchors[0].gridX,
            editingMagnet.anchors[0].gridY,
            anchorDimensions
          )
        : generateAnchors;

    const magnetToSave = buildEditorMagnet({
      seedMagnet: sourceMagnet ?? editingMagnet ?? undefined,
      fallbackType: editingMagnet?.type ?? 'custom',
      fallbackInteractions: editingMagnet?.interactions,
      id,
      name,
      anchorType,
      anchors: anchorsToSave,
      bounds: parsedBounds,
      content,
      style: parsedStyle,
      animation: parsedAnimation,
      chromeInset: parsedChromeInset,
      chromeOutset: parsedChromeOutset,
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

    onSave(magnetToSave);
    onCancel();
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

  const handleImport = () => {
    try {
      const data = JSON.parse(importJson);

      if (!data.id) throw new Error(t('editor.magnet-creator.import.missingField.id'));
      if (!data.name) throw new Error(t('editor.magnet-creator.import.missingField.name'));
      if (!data.anchorType) throw new Error(t('editor.magnet-creator.import.missingField.anchorType'));
      if (!data.bounds) throw new Error(t('editor.magnet-creator.import.missingField.bounds'));
      if (!data.style) throw new Error(t('editor.magnet-creator.import.missingField.style'));

      loadMagnetConfig(data as Magnet);
      setShowImport(false);
      setImportJson('');
      setImportError('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'editor.magnet-creator.import.failed');
    }
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'JSON',
            extensions: ['json'],
          },
        ],
        title: t('editor.magnet-creator.import.dialogTitle'),
      });

      if (selected && typeof selected === 'string') {
        const content = await readTextFile(selected);
        setImportJson(content);
        setImportError('');
      }
    } catch (error) {
      telemetry.error('editor.magnet.import-file.failed', {
        message: getErrorMessage(error),
      });
      setImportError(
        error instanceof Error ? error.message : 'editor.magnet-creator.import.readFileFailed'
      );
    }
  };

  const handleExport = () => {
    if (!previewMagnet) return;

    const exportData = {
      id: previewMagnet.id,
      type: previewMagnet.type,
      renderer: previewMagnet.renderer,
      previewText: previewMagnet.previewText,
      description: previewMagnet.description,
      tags: previewMagnet.tags,
      variant: previewMagnet.variant,
      skinProps: previewMagnet.skinProps,
      name: previewMagnet.name,
      anchorType: previewMagnet.anchorType,
      anchors: previewMagnet.anchors,
      bounds: previewMagnet.bounds,
      content: previewMagnet.content,
      style: previewMagnet.style,
      chrome: previewMagnet.chrome,
      animation: previewMagnet.animation,
      state: previewMagnet.state,
      interactions: {
        draggable: previewMagnet.interactions.draggable,
        clickable: previewMagnet.interactions.clickable,
      },
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    navigator.clipboard
      .writeText(jsonStr)
      .then(() => {
        alert(t('editor.magnet-creator.export.copySuccess'));
      })
      .catch(() => {
        alert(t('editor.magnet-creator.export.copyFailed'));
        telemetry.warn('editor.magnet.export.clipboard-copy.failed', {
          fields: {
            fallbackBytes: jsonStr.length,
          },
        });
      });
  };

  const handleDeleteHistory = (historyId: string) => {
    const newHistory = history.filter((h) => h.id !== historyId);
    setHistory(newHistory);
    if (editingMagnet) {
      saveMagnetHistory(editingMagnet.id, newHistory);
    }
  };

  const isValid = Boolean(
    id && name && !anchorsValidation.hasErrors && !boundsError && !styleError && !animationError
  );

  return (
    <div className="editor-creator">
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.creator.title')}
        </span>
      </div>

      <div className="creator-preview-fixed">
        <div className="creator-section-title">{t('editor.magnet-creator.preview.title')}</div>
        {previewMagnet ? (
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
                  <MagnetComponent magnet={previewMagnet} pixelPositions={PREVIEW_PIXEL_POSITIONS} />
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
          {mode === 'edit'
            ? t('editor.magnet-creator.mode.edit')
            : t('editor.magnet-creator.mode.create')}
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
        {mode === 'create' && (
          <button
            className="creator-btn creator-btn-import"
            onClick={() => setShowImport(!showImport)}
          >
            {t('editor.magnet-creator.action.importConfig')}
          </button>
        )}
        {mode === 'edit' && (
          <button
            className="creator-btn creator-btn-export"
            onClick={handleExport}
            disabled={!previewMagnet}
          >
            {t('editor.magnet-creator.action.exportConfig')}
          </button>
        )}
        <button className="creator-btn creator-btn-save" onClick={handleSave} disabled={!isValid}>
          {mode === 'edit' ? t('common.action.done') : t('common.action.create')}
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

      {showImport && mode === 'create' && (
        <div className="creator-import-panel">
          <div className="creator-import-header">
            <h3>{t('editor.magnet-creator.import.title')}</h3>
            <button
              className="creator-import-close"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              &times;
            </button>
          </div>
          <div className="creator-import-content">
            <div className="creator-import-file-select">
              <button className="creator-btn creator-btn-import" onClick={handleImportFromFile}>
                {t('editor.magnet-creator.import.action.chooseFile')}
              </button>
              <span className="creator-import-or">{t('editor.magnet-creator.import.orPaste')}</span>
            </div>
            <textarea
              className="creator-import-textarea"
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={t('editor.magnet-creator.import.placeholder')}
              rows={15}
            />
            {importError && <div className="creator-import-error">{t(importError)}</div>}
            <div className="creator-import-hint">
              <div>{t('editor.magnet-creator.import.hint.usageTitle')}</div>
              <div>- {t('editor.magnet-creator.import.hint.usage1')}</div>
              <div>- {t('editor.magnet-creator.import.hint.usage2')}</div>
              <div>- {t('editor.magnet-creator.import.hint.usage3')}</div>
              <div style={{ marginTop: 8 }}>{t('editor.magnet-creator.import.hint.limitsTitle')}</div>
              <div>- {t('editor.magnet-creator.import.hint.limit1')}</div>
              <div>- {t('editor.magnet-creator.import.hint.limit2')}</div>
              <div>- {t('editor.magnet-creator.import.hint.limit3')}</div>
              <div style={{ marginTop: 8 }}>{t('editor.magnet-creator.import.hint.howToTitle')}</div>
              <div>
                {t('editor.magnet-creator.import.hint.howToSee')}{' '}
                <code>apps/desktop/src/data/custom/exampleCustomMagnet.ts</code>
              </div>
              <div>
                {t('editor.magnet-creator.import.hint.howToDoc')}{' '}
                <code>docs/architecture/magnet-generation-spec.md</code>
              </div>
            </div>
          </div>
          <div className="creator-import-actions">
            <button
              className="creator-btn creator-btn-cancel"
              onClick={() => {
                setShowImport(false);
                setImportJson('');
                setImportError('');
              }}
            >
              {t('common.action.cancel')}
            </button>
            <button
              className="creator-btn creator-btn-save"
              onClick={handleImport}
              disabled={!importJson.trim()}
            >
              {t('editor.magnet-creator.import.action.importAndEdit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
