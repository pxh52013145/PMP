import { useState, useCallback, memo, useEffect } from 'react';
import { BackgroundConfig } from '../../types/background';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import { readJson } from '../../modules/storage';
import { STORAGE_KEYS } from '../../utils/windowCommunication';
import { useT } from '../../i18n';
import './CustomBackgroundEditor.css';

interface CustomBackgroundEditorProps {
  initialConfig?: BackgroundConfig;
  onSave: (config: BackgroundConfig) => void;
}

type CustomType = 'image' | 'video' | 'html';
type ImageFitMode = 'cover' | 'contain' | 'fill';
type VideoFitMode = 'cover' | 'contain';

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
  const [imageFit, setImageFit] = useState<ImageFitMode>(
    initialConfig?.image?.fit === 'cover' ||
      initialConfig?.image?.fit === 'contain' ||
      initialConfig?.image?.fit === 'fill'
      ? initialConfig.image.fit
      : 'contain'
  );
  const [videoUrl, setVideoUrl] = useState(initialConfig?.video?.url || '');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(initialConfig?.video?.url || '');
  const [videoFit, setVideoFit] = useState<VideoFitMode>(
    initialConfig?.video?.fit === 'cover' || initialConfig?.video?.fit === 'contain'
      ? initialConfig.video.fit
      : 'contain'
  );

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
  const [cropEnabled, setCropEnabled] = useState(() => {
    const hasCrop =
      (customType === 'image' && initialConfig?.image?.crop) ||
      (customType === 'video' && initialConfig?.video?.crop);
    return !!hasCrop;
  });
  const [cropRect, setCropRect] = useState(() => {
    const crop =
      customType === 'image'
        ? initialConfig?.image?.crop
        : customType === 'video'
          ? initialConfig?.video?.crop
          : null;
    return crop || { x: 10, y: 10, width: 80, height: 80 };
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

  // 窗口打开时自动聚焦
  useEffect(() => {
    const focusWindow = async () => {
      try {
        const { appWindow } = await import('@tauri-apps/api/window');
        await appWindow.setFocus();
      } catch (error) {
        console.error('Failed to focus window:', error);
      }
    };
    focusWindow();
  }, []);

  // 切换类型时更新选取状态
  useEffect(() => {
    if (customType === 'image' && initialConfig?.image?.crop) {
      setCropRect(initialConfig.image.crop);
      setCropEnabled(true);
      setSelectionApplied(true);
    } else if (customType === 'video' && initialConfig?.video?.crop) {
      setCropRect(initialConfig.video.crop);
      setCropEnabled(true);
      setSelectionApplied(true);
    } else if (customType === 'html') {
      setCropEnabled(false);
    }
    setSelectionHistory([]);
    setHistoryIndex(-1);
  }, [customType, initialConfig]);

  // 切换选取模式时重置应用状态
  useEffect(() => {
    if (!cropEnabled) {
      setSelectionApplied(false);
      setSelectionHistory([]);
      setHistoryIndex(-1);
    }
  }, [cropEnabled]);

  // 处理裁剪框拖拽
  const handleCropMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | string) => {
      if (!cropEnabled) return;
      e.preventDefault();
      e.stopPropagation();

      const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
      const startX = ((e.clientX - rect.left) / rect.width) * 100;
      const startY = ((e.clientY - rect.top) / rect.height) * 100;

      setDragStart({ x: startX, y: startY });
      if (type === 'move') {
        setIsDragging(true);
      } else {
        setIsResizing(type);
      }
      // 开始拖动时取消应用状态，显示选取框
      setSelectionApplied(false);
    },
    [cropEnabled]
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

      const previewElement = document.querySelector('.preview-container');
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
      setSelectionApplied(false);
    }
  }, [historyIndex, selectionHistory]);

  // 恢复
  const handleRedo = useCallback(() => {
    if (historyIndex < selectionHistory.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      setCropRect(selectionHistory[historyIndex + 1]);
      setSelectionApplied(false);
    }
  }, [historyIndex, selectionHistory]);

  // 重置
  const handleReset = useCallback(() => {
    const defaultRect = { x: 10, y: 10, width: 80, height: 80 };
    setCropRect(defaultRect);
    saveToHistory(defaultRect);
    setSelectionApplied(false);
  }, [saveToHistory]);

  // 确认选取
  const handleConfirmSelection = useCallback(() => {
    console.log('=== 确认选取 ===');
    console.log('选取区域:', cropRect);
    console.log('Transform values:', {
      top: `${(-cropRect.y * 100) / cropRect.height}%`,
      left: `${(-cropRect.x * 100) / cropRect.width}%`,
      width: `${10000 / cropRect.width}%`,
      height: `${10000 / cropRect.height}%`,
    });
    setSelectionApplied(true);
  }, [cropRect]);

  // 处理文件选择
  const handleFileSelect = useCallback(async (type: 'image' | 'video') => {
    try {
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
          const destPath = await tauri.invoke<string>('background_import_media', {
            sourcePath: selected,
            kind: type,
            gifMaxFps: type === 'image' ? gifMaxFps : undefined,
          });
          const persistedUrl = tauri.convertFileSrc(destPath);

          if (type === 'image') {
            setImageUrl(persistedUrl);
            setImagePreviewUrl(persistedUrl);
            setSelectionApplied(false);
          } else {
            setVideoUrl(persistedUrl);
            setVideoPreviewUrl(persistedUrl);
            setSelectionApplied(false);
          }
        } catch (readError) {
          console.error('[CustomBackgroundEditor] File import failed:', readError);
          const details = readError instanceof Error ? readError.message : String(readError);
          setErrorMessage(
            `<FILE_IMPORT_ERROR>\n` +
              t('editor.custom-background-editor.error.fileImportFailed', { details })
          );
          return;
        }
      }
    } catch (error) {
      console.error('文件选择错误详情:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      const details = error instanceof Error ? error.message : String(error);
      setErrorMessage(
        `<FILE_SELECT_ERROR>\n` +
          t('editor.custom-background-editor.error.fileSelectFailed', { details })
      );
    }
  }, [t]);

  // 取消并关闭窗口
  const handleCancel = useCallback(async () => {
    try {
      const { appWindow } = await import('@tauri-apps/api/window');
      await appWindow.close();
    } catch (error) {
      console.error('Failed to close window:', error);
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

    switch (customType) {
      case 'image':
        config = {
          type: 'image',
          image: {
            url: imageUrl,
            fit: imageFit,
            position: 'center center',
            repeat: 'no-repeat',
            // 保存容器坐标，不进行转换
            ...(cropEnabled && selectionApplied && { crop: cropRect }),
          },
        };
        break;
      case 'video':
        config = {
          type: 'video',
          video: {
            url: videoUrl,
            fit: videoFit as 'cover' | 'contain',
            loop: true,
            muted: true,
            // 保存容器坐标，不进行转换
            ...(cropEnabled && selectionApplied && { crop: cropRect }),
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

    console.log('Saving config:', config);
    onSave(config);
  }, [
    customType,
    imageUrl,
    imageFit,
    videoUrl,
    videoFit,
    htmlContent,
    onSave,
    cropEnabled,
    selectionApplied,
    cropRect,
  ]);

  // 获取预览样式
  const getPreviewStyle = useCallback((): React.CSSProperties => {
    const imageDisplayUrl = imagePreviewUrl || imageUrl;
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
            return {
              backgroundImage: `url(${imageDisplayUrl})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
            };
          }

          // 普通模式
          const backgroundSize = imageFit === 'fill' ? '100% 100%' : imageFit;
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
  }, [customType, imagePreviewUrl, imageUrl, imageFit, cropEnabled, selectionApplied]);

  // 获取视频样式
  const getVideoStyle = useCallback((): React.CSSProperties => {
    if (!cropEnabled || !selectionApplied) {
      return { objectFit: cropEnabled ? 'contain' : videoFit };
    }

    // 选取模式 - 使用clip-path裁剪
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    };
  }, [cropEnabled, videoFit, selectionApplied]);

  return (
    <div className="editor-custom-background">
      {/* 拖动标题栏 */}
      <div className="editor-window-header" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          ⋮⋮
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
          <div className="preview-container" style={getPreviewStyle()}>
            {/* 图片选取预览 - 精确复制选取区域 */}
            {customType === 'image' &&
              (imagePreviewUrl || imageUrl) &&
              cropEnabled &&
              selectionApplied && (
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
                    top: `${(-cropRect.y * 100) / cropRect.height}%`,
                    left: `${(-cropRect.x * 100) / cropRect.width}%`,
                    width: `${10000 / cropRect.width}%`,
                    height: `${10000 / cropRect.height}%`,
                    backgroundImage: `url(${imagePreviewUrl || imageUrl})`,
                    backgroundSize: 'contain',
                    backgroundPosition: 'center center',
                    backgroundRepeat: 'no-repeat',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  }}
                />
              </div>
            )}

            {/* 视频预览 */}
            {customType === 'video' && (videoPreviewUrl || videoUrl) && (
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
                        top: `${(-cropRect.y * 100) / cropRect.height}%`,
                        left: `${(-cropRect.x * 100) / cropRect.width}%`,
                        width: `${10000 / cropRect.width}%`,
                        height: `${10000 / cropRect.height}%`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <video
                        src={videoPreviewUrl || videoUrl}
                        className="preview-video"
                        autoPlay
                        loop
                        muted
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
                    src={videoPreviewUrl || videoUrl}
                    className="preview-video"
                    autoPlay
                    loop
                    muted
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
            {cropEnabled &&
              !selectionApplied &&
              (customType === 'image' || customType === 'video') &&
              (imagePreviewUrl || imageUrl || videoPreviewUrl || videoUrl) && (
                <>
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
                    <div
                      className="crop-handle nw"
                      onMouseDown={(e) => handleCropMouseDown(e, 'nw')}
                    />
                    <div
                      className="crop-handle ne"
                      onMouseDown={(e) => handleCropMouseDown(e, 'ne')}
                    />
                    <div
                      className="crop-handle sw"
                      onMouseDown={(e) => handleCropMouseDown(e, 'sw')}
                    />
                    <div
                      className="crop-handle se"
                      onMouseDown={(e) => handleCropMouseDown(e, 'se')}
                    />
                    <div
                      className="crop-handle n"
                      onMouseDown={(e) => handleCropMouseDown(e, 'n')}
                    />
                    <div
                      className="crop-handle s"
                      onMouseDown={(e) => handleCropMouseDown(e, 's')}
                    />
                    <div
                      className="crop-handle w"
                      onMouseDown={(e) => handleCropMouseDown(e, 'w')}
                    />
                    <div
                      className="crop-handle e"
                      onMouseDown={(e) => handleCropMouseDown(e, 'e')}
                    />
                  </div>
                  <div className="crop-info">
                    X:{cropRect.x.toFixed(0)}% Y:{cropRect.y.toFixed(0)}% | W:
                    {cropRect.width.toFixed(0)}% H:
                    {cropRect.height.toFixed(0)}%
                  </div>
                </>
              )}
          </div>

          {/* 选取控制按钮 - 集成在预览区域内 */}
          {cropEnabled &&
            (customType === 'image' || customType === 'video') &&
            (imagePreviewUrl || imageUrl || videoPreviewUrl || videoUrl) && (
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
        </div>

        {/* 显示模式 */}
        {(customType === 'image' || customType === 'video') && (imageUrl || videoUrl) && (
          <div className="config-section">
            <div className="section-title">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{t('editor.custom-background-editor.section.displayMode')}</span>
                <span
                  style={{
                    fontSize: '10px',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontWeight: 'normal',
                  }}
                >
                  {customType === 'image' &&
                    !cropEnabled &&
                    imageFit === 'contain' &&
                    t('editor.custom-background-editor.displayMode.containHint')}
                  {customType === 'image' &&
                    !cropEnabled &&
                    imageFit === 'cover' &&
                    t('editor.custom-background-editor.displayMode.coverHint')}
                  {customType === 'image' &&
                    !cropEnabled &&
                    imageFit === 'fill' &&
                    t('editor.custom-background-editor.displayMode.fillHint')}
                  {customType === 'video' &&
                    !cropEnabled &&
                    videoFit === 'contain' &&
                    t('editor.custom-background-editor.displayMode.containHint')}
                  {customType === 'video' &&
                    !cropEnabled &&
                    videoFit === 'cover' &&
                    t('editor.custom-background-editor.displayMode.coverHint')}
                  {cropEnabled && t('editor.custom-background-editor.displayMode.cropHint')}
                </span>
              </div>
            </div>
            {customType === 'image' && (
              <div className="fit-buttons">
                <button
                  className={`fit-btn ${!cropEnabled && imageFit === 'contain' ? 'active' : ''}`}
                  onClick={() => {
                    setImageFit('contain');
                    setCropEnabled(false);
                  }}
                  title={t('editor.custom-background-editor.fit.title.image.contain')}
                >
                  {t('editor.custom-background-editor.fit.option.contain')}
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && imageFit === 'cover' ? 'active' : ''}`}
                  onClick={() => {
                    setImageFit('cover');
                    setCropEnabled(false);
                  }}
                  title={t('editor.custom-background-editor.fit.title.image.cover')}
                >
                  {t('editor.custom-background-editor.fit.option.cover')}
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && imageFit === 'fill' ? 'active' : ''}`}
                  onClick={() => {
                    setImageFit('fill');
                    setCropEnabled(false);
                  }}
                  title={t('editor.custom-background-editor.fit.title.image.fill')}
                >
                  {t('editor.custom-background-editor.fit.option.fill')}
                </button>
                <button
                  className={`fit-btn ${cropEnabled ? 'active' : ''}`}
                  onClick={() => setCropEnabled(true)}
                  title={t('editor.custom-background-editor.fit.title.image.crop')}
                >
                  {t('editor.custom-background-editor.fit.option.crop')}
                </button>
              </div>
            )}
            {customType === 'video' && (
              <div className="fit-buttons video-fit-buttons">
                <button
                  className={`fit-btn ${!cropEnabled && videoFit === 'contain' ? 'active' : ''}`}
                  onClick={() => {
                    setVideoFit('contain');
                    setCropEnabled(false);
                  }}
                  title={t('editor.custom-background-editor.fit.title.video.contain')}
                >
                  {t('editor.custom-background-editor.fit.option.contain')}
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && videoFit === 'cover' ? 'active' : ''}`}
                  onClick={() => {
                    setVideoFit('cover');
                    setCropEnabled(false);
                  }}
                  title={t('editor.custom-background-editor.fit.title.video.cover')}
                >
                  {t('editor.custom-background-editor.fit.option.cover')}
                </button>
                <button
                  className={`fit-btn ${cropEnabled ? 'active' : ''}`}
                  onClick={() => setCropEnabled(true)}
                  title={t('editor.custom-background-editor.fit.title.video.crop')}
                >
                  {t('editor.custom-background-editor.fit.option.crop')}
                </button>
              </div>
            )}
          </div>
        )}

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
              <span className="file-size-limit">
                {t('editor.custom-background-editor.fileSizeLimit.image')}
              </span>
            </button>
            <input
              type="text"
              className="url-input"
              placeholder={t('editor.custom-background-editor.placeholder.imageUrl')}
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImagePreviewUrl(e.target.value);
                setSelectionApplied(false);
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
              <span className="file-size-limit">
                {t('editor.custom-background-editor.fileSizeLimit.video')}
              </span>
            </button>
            <input
              type="text"
              className="url-input"
              placeholder={t('editor.custom-background-editor.placeholder.videoUrl')}
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value);
                setVideoPreviewUrl(e.target.value);
                setSelectionApplied(false);
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
