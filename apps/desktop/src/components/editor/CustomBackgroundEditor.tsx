import { useState, useCallback, memo, useEffect, useMemo, useRef } from 'react';
import { BackgroundConfig, BackgroundCropRect } from '../../types/background';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import {
  computeContainMediaBox,
  computeMediaCropLayout,
  convertViewportCropToMediaCrop,
  type GeometrySize,
} from '../../modules/background/cropGeometry';
import { readJson } from '../../modules/storage';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useT } from '../../i18n';
import './CustomBackgroundEditor.css';

interface CustomBackgroundEditorProps {
  initialConfig?: BackgroundConfig;
  onSave: (config: BackgroundConfig) => void;
}

type CustomType = 'image' | 'video' | 'html';
const DEFAULT_CROP_RECT: BackgroundCropRect = { x: 0, y: 0, width: 100, height: 100, space: 'media' };
const DEFAULT_IMAGE_IMPORT_SOFT_LIMIT_MB = 100;
const DEFAULT_VIDEO_IMPORT_SOFT_LIMIT_MB = 300;
const telemetry = getTelemetryLogger('editor', 'CustomBackgroundEditor');

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BackgroundImportInvokeResult =
  | string
  | {
      destPath: string;
      sourceBytes?: number;
    };

function toPositiveNumberOrZero(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

function formatBytesToMbText(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

export const CustomBackgroundEditor = memo(function CustomBackgroundEditor({
  initialConfig,
  onSave,
}: CustomBackgroundEditorProps) {
  const t = useT();

  const { renderMode } = useWindowActivity();
  const [customType, setCustomType] = useState<CustomType>(
    initialConfig?.type === 'image' ||
      initialConfig?.type === 'video' ||
      initialConfig?.type === 'html'
      ? initialConfig.type
      : 'image'
  );
  const [imageUrl, setImageUrl] = useState(initialConfig?.image?.url || '');
  const [imagePreviewUrl, setImagePreviewUrl] = useState(initialConfig?.image?.url || '');
  const [videoUrl, setVideoUrl] = useState(initialConfig?.video?.url || '');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(initialConfig?.video?.url || '');

  // HTML 默认模板
  const defaultHtmlTemplate = `<style>

</style>
<div>

</div>
<script>

</script>`;

  const [htmlContent, setHtmlContent] = useState(
    initialConfig?.html?.content || defaultHtmlTemplate
  );

  // 裁剪区域状态
  const cropEnabled = customType !== 'html';
  const [cropRect, setCropRect] = useState<BackgroundCropRect>(() => {
    const crop =
      customType === 'image'
        ? initialConfig?.image?.crop
        : customType === 'video'
          ? initialConfig?.video?.crop
          : null;
    return crop || DEFAULT_CROP_RECT;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // 选取功能状态
  const [selectionApplied, setSelectionApplied] = useState(false); // 是否应用选取预览
  const [selectionHistory, setSelectionHistory] = useState<Array<typeof cropRect>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // 错误弹窗状态
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importWarningMessage, setImportWarningMessage] = useState<string | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const cropCanvasRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState<GeometrySize>({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<GeometrySize | null>(null);
  const [videoNaturalSize, setVideoNaturalSize] = useState<GeometrySize | null>(null);
  const [confirmedMediaCrop, setConfirmedMediaCrop] = useState<BackgroundCropRect | null>(() => {
    const crop =
      customType === 'image'
        ? initialConfig?.image?.crop
        : customType === 'video'
          ? initialConfig?.video?.crop
          : null;
    return crop?.space === 'media' ? crop : null;
  });
  const imageDisplayUrl = imagePreviewUrl || imageUrl;
  const videoDisplayUrl = videoPreviewUrl || videoUrl;

  const clearAppliedSelection = useCallback(() => {
    setSelectionApplied(false);
    setConfirmedMediaCrop(null);
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    setImageNaturalSize(null);
  }, [imageDisplayUrl]);

  useEffect(() => {
    setVideoNaturalSize(null);
  }, [videoDisplayUrl]);

  useEffect(() => {
    if (!imageDisplayUrl) return;
    let disposed = false;
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      setImageNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (disposed) return;
      setImageNaturalSize(null);
    };
    image.src = imageDisplayUrl;
    return () => {
      disposed = true;
    };
  }, [imageDisplayUrl]);

  useEffect(() => {
    if (!videoDisplayUrl) return;
    let disposed = false;
    const video = document.createElement('video');

    const handleLoadedMetadata = () => {
      if (disposed) return;
      setVideoNaturalSize({ width: video.videoWidth, height: video.videoHeight });
    };

    const handleError = () => {
      if (disposed) return;
      setVideoNaturalSize(null);
    };

    video.preload = 'metadata';
    video.src = videoDisplayUrl;
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('error', handleError);

    return () => {
      disposed = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('error', handleError);
      video.removeAttribute('src');
      video.load();
    };
  }, [videoDisplayUrl]);

  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      setPreviewSize({ width: container.clientWidth, height: container.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!cropEnabled) return;
    if (cropRect.space === 'media') return;

    const mediaSize = customType === 'image' ? imageNaturalSize : videoNaturalSize;
    if (!mediaSize) return;

    const convertedCrop = convertViewportCropToMediaCrop(cropRect, previewSize, mediaSize);
    if (convertedCrop) {
      setCropRect(convertedCrop);
      if (selectionApplied && !confirmedMediaCrop) {
        setConfirmedMediaCrop(convertedCrop);
      }
    }
  }, [
    cropEnabled,
    cropRect,
    customType,
    confirmedMediaCrop,
    imageNaturalSize,
    previewSize,
    selectionApplied,
    videoNaturalSize,
  ]);

  // 窗口打开时自动聚焦
  useEffect(() => {
    const focusWindow = async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        await appWindow.setFocus();
      } catch (error) {
        telemetry.warn('editor.custom-background.focus.failed', {
          message: getErrorMessage(error),
        });
      }
    };
    focusWindow();
  }, []);

  // 切换类型时更新选取状态
  useEffect(() => {
    if (customType === 'image') {
      setCropRect(initialConfig?.image?.crop || DEFAULT_CROP_RECT);
      setSelectionApplied(false);
      setConfirmedMediaCrop(null);
    } else if (customType === 'video') {
      setCropRect(initialConfig?.video?.crop || DEFAULT_CROP_RECT);
      setSelectionApplied(false);
      setConfirmedMediaCrop(null);
    } else if (customType === 'html') {
      setSelectionApplied(false);
      setCropRect(DEFAULT_CROP_RECT);
      setConfirmedMediaCrop(null);
    } else {
      setSelectionApplied(false);
      setCropRect(DEFAULT_CROP_RECT);
      setConfirmedMediaCrop(null);
    }
    setSelectionHistory([]);
    setHistoryIndex(-1);
    setImportWarningMessage(null);
  }, [customType, initialConfig]);

  // 切换选取模式时重置应用状态
  useEffect(() => {
    if (!cropEnabled) {
      setSelectionApplied(false);
      setSelectionHistory([]);
      setHistoryIndex(-1);
      setConfirmedMediaCrop(null);
    }
  }, [cropEnabled]);

  // 处理裁剪框拖拽
  const handleCropMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | string) => {
      if (!cropEnabled) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = cropCanvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const startX = ((e.clientX - rect.left) / rect.width) * 100;
      const startY = ((e.clientY - rect.top) / rect.height) * 100;

      setDragStart({ x: startX, y: startY });
      if (type === 'move') {
        setIsDragging(true);
      } else {
        setIsResizing(type);
      }
      // 开始拖动时取消应用状态，显示选取框
      clearAppliedSelection();
    },
    [clearAppliedSelection, cropEnabled]
  );

  // 处理鼠标移动
  const saveToHistory = useCallback(
    (rect: typeof cropRect) => {
      setSelectionHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(rect);
        return newHistory;
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;

      const previewElement = cropCanvasRef.current ?? previewContainerRef.current;
      if (!previewElement) return;

      const rect = previewElement.getBoundingClientRect();
      const currentX = ((e.clientX - rect.left) / rect.width) * 100;
      const currentY = ((e.clientY - rect.top) / rect.height) * 100;

      setCropRect((prev) => {
        const newRect = { ...prev };

        if (isDragging) {
          // 拖动
          const deltaX = currentX - dragStart.x;
          const deltaY = currentY - dragStart.y;
          newRect.x = Math.max(0, Math.min(100 - prev.width, prev.x + deltaX));
          newRect.y = Math.max(0, Math.min(100 - prev.height, prev.y + deltaY));
          setDragStart({ x: currentX, y: currentY });
        } else if (isResizing) {
          // 调整大小
          const minSize = 10;
          switch (isResizing) {
            case 'se':
              newRect.width = Math.max(minSize, Math.min(100 - prev.x, currentX - prev.x));
              newRect.height = Math.max(minSize, Math.min(100 - prev.y, currentY - prev.y));
              break;
            case 'sw': {
              const newWidth = Math.max(minSize, prev.x + prev.width - currentX);
              newRect.x = Math.max(0, prev.x + prev.width - newWidth);
              newRect.width = newWidth;
              newRect.height = Math.max(minSize, Math.min(100 - prev.y, currentY - prev.y));
              break;
            }
            case 'ne': {
              newRect.width = Math.max(minSize, Math.min(100 - prev.x, currentX - prev.x));
              const newHeight = Math.max(minSize, prev.y + prev.height - currentY);
              newRect.y = Math.max(0, prev.y + prev.height - newHeight);
              newRect.height = newHeight;
              break;
            }
            case 'nw': {
              const nwNewWidth = Math.max(minSize, prev.x + prev.width - currentX);
              newRect.x = Math.max(0, prev.x + prev.width - nwNewWidth);
              newRect.width = nwNewWidth;
              const nwNewHeight = Math.max(minSize, prev.y + prev.height - currentY);
              newRect.y = Math.max(0, prev.y + prev.height - nwNewHeight);
              newRect.height = nwNewHeight;
              break;
            }
            case 'n': {
              const nNewHeight = Math.max(minSize, prev.y + prev.height - currentY);
              newRect.y = Math.max(0, prev.y + prev.height - nNewHeight);
              newRect.height = nNewHeight;
              break;
            }
            case 's':
              newRect.height = Math.max(minSize, Math.min(100 - prev.y, currentY - prev.y));
              break;
            case 'w': {
              const wNewWidth = Math.max(minSize, prev.x + prev.width - currentX);
              newRect.x = Math.max(0, prev.x + prev.width - wNewWidth);
              newRect.width = wNewWidth;
              break;
            }
            case 'e':
              newRect.width = Math.max(minSize, Math.min(100 - prev.x, currentX - prev.x));
              break;
          }
        }

        return newRect;
      });
    };

    const handleMouseUp = () => {
      if (isDragging || isResizing) {
        // 拖动结束，保存到历史记录
        saveToHistory(cropRect);
      }
      setIsDragging(false);
      setIsResizing(null);
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, dragStart, cropRect, saveToHistory]);

  // 撤销
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      setCropRect(selectionHistory[historyIndex - 1]);
      clearAppliedSelection();
    }
  }, [clearAppliedSelection, historyIndex, selectionHistory]);

  // 恢复
  const handleRedo = useCallback(() => {
    if (historyIndex < selectionHistory.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setCropRect(selectionHistory[historyIndex + 1]);
      clearAppliedSelection();
    }
  }, [clearAppliedSelection, historyIndex, selectionHistory]);

  // 重置
  const handleReset = useCallback(() => {
    setCropRect(DEFAULT_CROP_RECT);
    saveToHistory(DEFAULT_CROP_RECT);
    clearAppliedSelection();
  }, [clearAppliedSelection, saveToHistory]);

  // 确认选取
  const handleConfirmSelection = useCallback(() => {
    const mediaSize = customType === 'image' ? imageNaturalSize : videoNaturalSize;
    const normalizedCrop =
      cropRect.space === 'media'
        ? { ...cropRect, space: 'media' as const }
        : mediaSize
          ? convertViewportCropToMediaCrop(cropRect, previewSize, mediaSize)
          : { ...cropRect, space: 'media' as const };

    if (normalizedCrop) {
      setCropRect(normalizedCrop);
      setConfirmedMediaCrop(normalizedCrop);
    }
    setSelectionApplied(true);
  }, [cropRect, customType, imageNaturalSize, previewSize, videoNaturalSize]);

  // 处理文件选择
  const handleFileSelect = useCallback(async (type: 'image' | 'video') => {
    try {
      setImportWarningMessage(null);
      const dialog = await import('@tauri-apps/api/dialog');
      const tauri = await import('@tauri-apps/api/tauri');

      const filterConfig =
        type === 'image'
          ? {
              name: t('editor.custom-background-editor.fileFilter.image'),
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
            }
          : {
              name: t('editor.custom-background-editor.fileFilter.video'),
              extensions: ['mp4', 'webm', 'ogg', 'mov'],
            };

      const selected = await dialog.open({
        multiple: false,
        filters: [filterConfig],
      });

      if (selected && typeof selected === 'string') {
        try {
          const gifMaxFpsRaw =
            type === 'image'
              ? readJson<number>(STORAGE_KEYS.BACKGROUND_GIF_IMPORT_MAX_FPS, 30)
              : undefined;
          const gifMaxFps =
            typeof gifMaxFpsRaw === 'number' && Number.isFinite(gifMaxFpsRaw)
              ? Math.max(0, Math.min(60, Math.round(gifMaxFpsRaw)))
              : 30;
          const importResult = await invokeWithTelemetry<BackgroundImportInvokeResult>(
            'background_import_media',
            {
              sourcePath: selected,
              kind: type,
              gifMaxFps: type === 'image' ? gifMaxFps : undefined,
            },
            {
              moduleId: 'editor',
              component: 'CustomBackgroundEditor',
              event: 'editor.background.media.import',
            }
          );
          const destPath =
            typeof importResult === 'string' ? importResult : importResult?.destPath || '';
          const sourceBytes =
            typeof importResult === 'string'
              ? undefined
              : typeof importResult?.sourceBytes === 'number'
                ? importResult.sourceBytes
                : undefined;
          if (!destPath) {
            throw new Error('background_import_media returned empty destination path');
          }
          const persistedUrl = tauri.convertFileSrc(destPath);

          const softLimitMbRaw =
            type === 'image'
              ? readJson<number>(
                  STORAGE_KEYS.BACKGROUND_IMPORT_SOFT_LIMIT_IMAGE_MB,
                  DEFAULT_IMAGE_IMPORT_SOFT_LIMIT_MB
                )
              : readJson<number>(
                  STORAGE_KEYS.BACKGROUND_IMPORT_SOFT_LIMIT_VIDEO_MB,
                  DEFAULT_VIDEO_IMPORT_SOFT_LIMIT_MB
                );
          const softLimitMb = toPositiveNumberOrZero(softLimitMbRaw);
          const softLimitBytes = mbToBytes(softLimitMb);
          if (
            typeof sourceBytes === 'number' &&
            Number.isFinite(sourceBytes) &&
            sourceBytes > 0 &&
            softLimitBytes > 0 &&
            sourceBytes > softLimitBytes
          ) {
            setImportWarningMessage(
              t('editor.custom-background-editor.warning.largeImport', {
                sizeMb: formatBytesToMbText(sourceBytes),
                limitMb: String(softLimitMb),
              })
            );
          } else {
            setImportWarningMessage(null);
          }

          if (type === 'image') {
            setImageUrl(persistedUrl);
            setImagePreviewUrl(persistedUrl);
            setCropRect(DEFAULT_CROP_RECT);
            setSelectionHistory([]);
            setHistoryIndex(-1);
            clearAppliedSelection();
          } else {
            setVideoUrl(persistedUrl);
            setVideoPreviewUrl(persistedUrl);
            setCropRect(DEFAULT_CROP_RECT);
            setSelectionHistory([]);
            setHistoryIndex(-1);
            clearAppliedSelection();
          }
        } catch (readError) {
          telemetry.error('editor.background.media.import.failed', {
            message: getErrorMessage(readError),
            fields: {
              kind: type,
            },
          });
          setImportWarningMessage(null);
          const details = readError instanceof Error ? readError.message : String(readError);
          setErrorMessage(
            `<FILE_IMPORT_ERROR>\n` +
              t('editor.custom-background-editor.error.fileImportFailed', { details })
          );
          return;
        }
      }
    } catch (error) {
      telemetry.error('editor.background.media.select.failed', {
        message: getErrorMessage(error),
      });
      setImportWarningMessage(null);
      const details = error instanceof Error ? error.message : String(error);
      setErrorMessage(
        `<FILE_SELECT_ERROR>\n` +
          t('editor.custom-background-editor.error.fileSelectFailed', { details })
      );
    }
  }, [clearAppliedSelection, t]);

  // 取消并关闭窗口
  const handleCancel = useCallback(async () => {
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.close();
    } catch (error) {
      telemetry.error('editor.custom-background.window.close.failed', {
        message: getErrorMessage(error),
      });
    }
  }, []);

  // Cached windows keep running even when hidden; pause video decode/render work while inactive.
  useEffect(() => {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video.preview-video'));
    if (videos.length === 0) return;

    if (renderMode !== 'full') {
      for (const video of videos) {
        try {
          video.pause();
        } catch {
          // ignore
        }
      }
      return;
    }

    for (const video of videos) {
      try {
        const p = video.play();
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => {});
        }
      } catch {
        // ignore
      }
    }
  }, [renderMode]);

  // 保存配置
  const handleSave = useCallback(() => {
    let config: BackgroundConfig;
    const currentMediaSize =
      customType === 'image'
        ? imageNaturalSize
        : customType === 'video'
          ? videoNaturalSize
          : null;
    const normalizedDraftCrop =
      cropRect.space === 'media'
        ? ({ ...cropRect, space: 'media' } as BackgroundCropRect)
        : currentMediaSize
          ? convertViewportCropToMediaCrop(cropRect, previewSize, currentMediaSize)
          : DEFAULT_CROP_RECT;
    const savedCrop =
      customType === 'image' || customType === 'video'
        ? (confirmedMediaCrop ?? normalizedDraftCrop)
        : undefined;

    switch (customType) {
      case 'image':
        config = {
          type: 'image',
          image: {
            url: imageUrl,
            fit: 'cover',
            position: 'center center',
            repeat: 'no-repeat',
            ...(savedCrop && { crop: savedCrop }),
          },
        };
        break;
      case 'video':
        config = {
          type: 'video',
          video: {
            url: videoUrl,
            fit: 'cover',
            loop: true,
            muted: true,
            ...(savedCrop && { crop: savedCrop }),
          },
        };
        break;
      case 'html':
        config = {
          type: 'html',
          html: {
            content: htmlContent,
          },
        };
        break;
    }

    onSave(config);
  }, [
    customType,
    imageUrl,
    imageNaturalSize,
    videoUrl,
    videoNaturalSize,
    htmlContent,
    onSave,
    confirmedMediaCrop,
    cropRect,
    previewSize,
  ]);

  // 获取预览样式
  const getPreviewStyle = useCallback((): React.CSSProperties => {
    const style = (() => {
      switch (customType) {
        case 'image': {
          if (!imageDisplayUrl) return { background: 'rgba(255, 255, 255, 0.05)' };

          // 选取模式且已应用：不使用背景图，用 img 元素
          if (cropEnabled && selectionApplied) {
            return {};
          }

          // 选取模式未应用：使用contain模式显示完整图片方便选取
          if (cropEnabled) {
            if (!imageNaturalSize) {
              return {
                backgroundImage: `url(${imageDisplayUrl})`,
                backgroundSize: 'contain',
                backgroundPosition: 'center center',
                backgroundRepeat: 'no-repeat',
              };
            }
            return {};
          }

          // 普通模式
          const backgroundSize = 'contain';
          return {
            backgroundImage: `url(${imageDisplayUrl})`,
            backgroundSize,
            backgroundPosition: 'center center',
            backgroundRepeat: 'no-repeat',
          };
        }
        case 'video':
          return {};
        case 'html':
          return {};
        default:
          return {};
      }
    })();
    return style;
  }, [customType, imageNaturalSize, imageDisplayUrl, cropEnabled, selectionApplied]);

  // 获取视频样式
  const getVideoStyle = useCallback((): React.CSSProperties => {
    if (!cropEnabled || !selectionApplied) {
      return { objectFit: 'contain' };
    }

    // 选取模式 - 使用clip-path裁剪
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    };
  }, [cropEnabled, selectionApplied]);

  const imageAppliedLayout = useMemo(() => {
    if (!cropEnabled || !selectionApplied) return null;
    if (confirmedMediaCrop?.space !== 'media' || !imageNaturalSize || !imageDisplayUrl) return null;
    return computeMediaCropLayout(confirmedMediaCrop, previewSize, imageNaturalSize);
  }, [
    cropEnabled,
    selectionApplied,
    confirmedMediaCrop,
    imageNaturalSize,
    imageDisplayUrl,
    previewSize,
  ]);

  const videoAppliedLayout = useMemo(() => {
    if (!cropEnabled || !selectionApplied) return null;
    if (confirmedMediaCrop?.space !== 'media' || !videoNaturalSize || !videoDisplayUrl) return null;
    return computeMediaCropLayout(confirmedMediaCrop, previewSize, videoNaturalSize);
  }, [
    cropEnabled,
    selectionApplied,
    confirmedMediaCrop,
    videoNaturalSize,
    videoDisplayUrl,
    previewSize,
  ]);

  const cropCanvasLayout = useMemo(() => {
    if (!cropEnabled || selectionApplied) return null;

    if (customType === 'image' && imageDisplayUrl && imageNaturalSize) {
      return computeContainMediaBox(previewSize, imageNaturalSize);
    }

    if (customType === 'video' && videoDisplayUrl && videoNaturalSize) {
      return computeContainMediaBox(previewSize, videoNaturalSize);
    }

    return null;
  }, [
    cropEnabled,
    customType,
    imageDisplayUrl,
    imageNaturalSize,
    previewSize,
    selectionApplied,
    videoDisplayUrl,
    videoNaturalSize,
  ]);

  return (
    <div className="editor-custom-background">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          {t('windows.editor.custom-background.title')}
        </span>
      </div>

      {/* 内容区域 */}
      <div className="editor-window-content">
        {/* 效果可视化区域 */}
          <div className="preview-section">
            <div className="section-title">
              {t('editor.custom-background-editor.section.preview')}
              {cropEnabled && (
                <span
                style={{
                  marginLeft: '12px',
                  fontSize: '11px',
                  color: 'rgba(0, 255, 255, 0.8)',
                  fontWeight: 'normal',
                }}
                >
                  {!selectionApplied
                    ? t('editor.custom-background-editor.preview.selectionHint')
                    : t('editor.custom-background-editor.preview.selectionConfirmed')}
                </span>
              )}
            </div>
          <div ref={previewContainerRef} className="preview-container" style={getPreviewStyle()}>
            {cropEnabled &&
              !selectionApplied &&
              cropCanvasLayout &&
              customType === 'image' &&
              imageDisplayUrl && (
              <div
                ref={cropCanvasRef}
                className="preview-selection-wrapper crop-canvas-wrapper"
                style={{
                  left: cropCanvasLayout.x,
                  top: cropCanvasLayout.y,
                  width: cropCanvasLayout.width,
                  height: cropCanvasLayout.height,
                }}
              >
                <img
                  src={imageDisplayUrl}
                  className="preview-selection-image"
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    setImageNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                  }}
                  style={{ left: 0, top: 0, width: '100%', height: '100%' }}
                />
                <div className="crop-overlay" />
                <div
                  className="crop-selector"
                  style={{
                    left: `${cropRect.x}%`,
                    top: `${cropRect.y}%`,
                    width: `${cropRect.width}%`,
                    height: `${cropRect.height}%`,
                  }}
                  onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                >
                  <div className="crop-handle nw" onMouseDown={(e) => handleCropMouseDown(e, 'nw')} />
                  <div className="crop-handle ne" onMouseDown={(e) => handleCropMouseDown(e, 'ne')} />
                  <div className="crop-handle sw" onMouseDown={(e) => handleCropMouseDown(e, 'sw')} />
                  <div className="crop-handle se" onMouseDown={(e) => handleCropMouseDown(e, 'se')} />
                  <div className="crop-handle n" onMouseDown={(e) => handleCropMouseDown(e, 'n')} />
                  <div className="crop-handle s" onMouseDown={(e) => handleCropMouseDown(e, 's')} />
                  <div className="crop-handle w" onMouseDown={(e) => handleCropMouseDown(e, 'w')} />
                  <div className="crop-handle e" onMouseDown={(e) => handleCropMouseDown(e, 'e')} />
                </div>
              </div>
            )}

            {cropEnabled &&
              !selectionApplied &&
              cropCanvasLayout &&
              customType === 'video' &&
              videoDisplayUrl && (
              <div
                ref={cropCanvasRef}
                className="preview-selection-wrapper crop-canvas-wrapper"
                style={{
                  left: cropCanvasLayout.x,
                  top: cropCanvasLayout.y,
                  width: cropCanvasLayout.width,
                  height: cropCanvasLayout.height,
                }}
              >
                <video
                  src={videoDisplayUrl}
                  className="preview-video"
                  autoPlay
                  loop
                  muted
                  onLoadedMetadata={(event) => {
                    setVideoNaturalSize({
                      width: event.currentTarget.videoWidth,
                      height: event.currentTarget.videoHeight,
                    });
                  }}
                  style={{ left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill' }}
                />
                <div className="crop-overlay" />
                <div
                  className="crop-selector"
                  style={{
                    left: `${cropRect.x}%`,
                    top: `${cropRect.y}%`,
                    width: `${cropRect.width}%`,
                    height: `${cropRect.height}%`,
                  }}
                  onMouseDown={(e) => handleCropMouseDown(e, 'move')}
                >
                  <div className="crop-handle nw" onMouseDown={(e) => handleCropMouseDown(e, 'nw')} />
                  <div className="crop-handle ne" onMouseDown={(e) => handleCropMouseDown(e, 'ne')} />
                  <div className="crop-handle sw" onMouseDown={(e) => handleCropMouseDown(e, 'sw')} />
                  <div className="crop-handle se" onMouseDown={(e) => handleCropMouseDown(e, 'se')} />
                  <div className="crop-handle n" onMouseDown={(e) => handleCropMouseDown(e, 'n')} />
                  <div className="crop-handle s" onMouseDown={(e) => handleCropMouseDown(e, 's')} />
                  <div className="crop-handle w" onMouseDown={(e) => handleCropMouseDown(e, 'w')} />
                  <div className="crop-handle e" onMouseDown={(e) => handleCropMouseDown(e, 'e')} />
                </div>
              </div>
            )}

            {cropEnabled && !selectionApplied && cropCanvasLayout && (
              <div className="crop-info">
                X:{cropRect.x.toFixed(0)}% Y:{cropRect.y.toFixed(0)}% | W:{cropRect.width.toFixed(0)}% H:
                {cropRect.height.toFixed(0)}%
              </div>
            )}
            {/* 图片选取预览 - 精确复制选取区域 */}
            {customType === 'image' &&
              imageDisplayUrl &&
              cropEnabled &&
              selectionApplied &&
              imageAppliedLayout && (
              <div className="preview-selection-wrapper">
                <img
                  src={imageDisplayUrl}
                  className="preview-selection-image"
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    setImageNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                  }}
                  style={{
                    left: imageAppliedLayout.left,
                    top: imageAppliedLayout.top,
                    width: imageAppliedLayout.width,
                    height: imageAppliedLayout.height,
                  }}
                />
              </div>
            )}

            {customType === 'image' &&
              imageDisplayUrl &&
              cropEnabled &&
              selectionApplied &&
              !imageAppliedLayout && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'hidden',
                }}
              >
                {/* 背景层 - 与选取时相同 */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundImage: `url(${imageDisplayUrl})`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center center',
                    backgroundRepeat: 'no-repeat',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  }}
                />
              </div>
            )}

            {/* 视频预览 */}
            {customType === 'video' &&
              videoDisplayUrl &&
              cropEnabled &&
              selectionApplied &&
              videoAppliedLayout && (
              <div className="preview-selection-wrapper">
                <video
                  src={videoDisplayUrl}
                  className="preview-video"
                  autoPlay
                  loop
                  muted
                  onLoadedMetadata={(event) => {
                    setVideoNaturalSize({
                      width: event.currentTarget.videoWidth,
                      height: event.currentTarget.videoHeight,
                    });
                  }}
                  style={{
                    left: videoAppliedLayout.left,
                    top: videoAppliedLayout.top,
                    width: videoAppliedLayout.width,
                    height: videoAppliedLayout.height,
                    objectFit: 'fill',
                  }}
                />
              </div>
            )}

            {customType === 'video' &&
              videoDisplayUrl &&
              (!cropEnabled ||
                (selectionApplied && !videoAppliedLayout) ||
                (!selectionApplied && !cropCanvasLayout)) && (
              <>
                {cropEnabled && selectionApplied ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <video
                        src={videoDisplayUrl}
                        className="preview-video"
                        autoPlay
                        loop
                        muted
                        onLoadedMetadata={(event) => {
                          setVideoNaturalSize({
                            width: event.currentTarget.videoWidth,
                            height: event.currentTarget.videoHeight,
                          });
                        }}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '100%',
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <video
                    src={videoDisplayUrl}
                    className="preview-video"
                    autoPlay
                    loop
                    muted
                    onLoadedMetadata={(event) => {
                      setVideoNaturalSize({
                        width: event.currentTarget.videoWidth,
                        height: event.currentTarget.videoHeight,
                      });
                    }}
                    style={getVideoStyle()}
                  />
                )}
              </>
            )}

            {customType === 'html' && htmlContent && (
              <div className="preview-html" dangerouslySetInnerHTML={{ __html: htmlContent }} />
            )}

            {!imageUrl && !videoUrl && !htmlContent && (
              <div className="preview-placeholder">
                <span>{t('editor.custom-background-editor.preview.placeholder.title')}</span>
                <span className="placeholder-hint">
                  {t('editor.custom-background-editor.preview.placeholder.hint')}
                </span>
              </div>
            )}

            {/* 选取框 */}
          </div>

          {/* 选取控制按钮 - 集成在预览区域内 */}
          {cropEnabled &&
            (customType === 'image' || customType === 'video') &&
            (selectionApplied || cropCanvasLayout) &&
            (imageDisplayUrl || videoDisplayUrl) && (
              <>
                <div className="preview-selection-controls">
                  <button
                    className="selection-btn selection-confirm-btn"
                    onClick={handleConfirmSelection}
                    disabled={selectionApplied}
                  >
                    {selectionApplied
                      ? t('editor.custom-background-editor.selection.confirmed')
                      : t('editor.custom-background-editor.selection.confirm')}
                  </button>
                  <button className="selection-btn selection-reset-btn" onClick={handleReset}>
                    {t('common.action.reset')}
                  </button>
                  <button
                    className="selection-btn selection-undo-btn"
                    onClick={handleUndo}
                    disabled={historyIndex <= 0}
                  >
                    {t('common.action.undo')}
                  </button>
                  <button
                    className="selection-btn selection-redo-btn"
                    onClick={handleRedo}
                    disabled={historyIndex >= selectionHistory.length - 1}
                  >
                    {t('common.action.redo')}
                  </button>
                </div>
                <div
                  style={{
                    marginTop: '8px',
                    fontSize: '10px',
                    color: 'rgba(255, 255, 255, 0.4)',
                    textAlign: 'center',
                    lineHeight: '1.4',
                  }}
                >
                  💡 {t('editor.custom-background-editor.preview.selectionHint2')}
                </div>
              </>
            )}
          {importWarningMessage && (
            <div className="background-import-warning">⚠ {importWarningMessage}</div>
          )}
        </div>

        {/* 显示模式 */}


        {/* 类型选择 */}
        <div className="config-section">
          <div className="section-title">{t('editor.custom-background-editor.section.type')}</div>
          <div className="type-buttons">
            <button
              className={`type-btn ${customType === 'image' ? 'active' : ''}`}
              onClick={() => setCustomType('image')}
            >
              {t('editor.custom-background-editor.type.image')}
            </button>
            <button
              className={`type-btn ${customType === 'video' ? 'active' : ''}`}
              onClick={() => setCustomType('video')}
            >
              {t('editor.custom-background-editor.type.video')}
            </button>
            <button
              className={`type-btn ${customType === 'html' ? 'active' : ''}`}
              onClick={() => setCustomType('html')}
            >
              {t('editor.custom-background-editor.type.html')}
            </button>
          </div>
        </div>

        {/* 操作区域 - 图片 */}
        {customType === 'image' && (
          <div className="config-section">
            <div className="section-title">{t('editor.custom-background-editor.section.imageConfig')}</div>
            <button className="file-select-btn" onClick={() => handleFileSelect('image')}>
              {t('editor.custom-background-editor.action.selectImageFile')}
            </button>
            <input
              type="text"
              className="url-input"
              placeholder={t('editor.custom-background-editor.placeholder.imageUrl')}
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImagePreviewUrl(e.target.value);
                setCropRect(DEFAULT_CROP_RECT);
                setSelectionHistory([]);
                setHistoryIndex(-1);
                clearAppliedSelection();
                setImportWarningMessage(null);
              }}
            />
          </div>
        )}

        {/* 操作区域 - 视频 */}
        {customType === 'video' && (
          <div className="config-section">
            <div className="section-title">{t('editor.custom-background-editor.section.videoConfig')}</div>
            <button className="file-select-btn" onClick={() => handleFileSelect('video')}>
              {t('editor.custom-background-editor.action.selectVideoFile')}
            </button>
            <input
              type="text"
              className="url-input"
              placeholder={t('editor.custom-background-editor.placeholder.videoUrl')}
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setVideoPreviewUrl(e.target.value);
                setCropRect(DEFAULT_CROP_RECT);
                setSelectionHistory([]);
                setHistoryIndex(-1);
                clearAppliedSelection();
                setImportWarningMessage(null);
              }}
            />
          </div>
        )}

        {/* 操作区域 - HTML */}
        {customType === 'html' && (
          <div className="config-section">
            <div className="section-title">{t('editor.custom-background-editor.section.htmlContent')}</div>
            <textarea
              className="html-textarea"
              placeholder={t('editor.custom-background-editor.placeholder.html')}
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={10}
            />
            <div className="html-hint">{t('editor.custom-background-editor.htmlHint')}</div>
          </div>
        )}

        {/* 按钮区域 */}
        <div className="action-section">
          <button className="cancel-btn" onClick={handleCancel}>
            {t('common.action.cancel')}
          </button>
          <button className="save-btn" onClick={handleSave}>
            {t('editor.custom-background-editor.action.saveAndApply')}
          </button>
        </div>
      </div>

      {/* 赛博风格错误弹窗 */}
      {errorMessage && (
        <div className="cyber-error-overlay" onClick={() => setErrorMessage(null)}>
          <div className="cyber-error-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cyber-error-header">
              <span className="error-icon">▲</span>
              <span className="error-title">{t('editor.custom-background-editor.errorModal.title')}</span>
            </div>
            <div className="cyber-error-body">
              <pre className="error-content">{errorMessage}</pre>
            </div>
            <div className="cyber-error-footer">
              <button className="error-btn" onClick={() => setErrorMessage(null)}>
                {t('editor.custom-background-editor.errorModal.confirmButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
