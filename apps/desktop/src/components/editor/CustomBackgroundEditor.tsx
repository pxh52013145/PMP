import { useState, useCallback, memo, useEffect } from 'react';
import { BackgroundConfig } from '../../types/background';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
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
  const { isActive } = useWindowActivity();
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
      const fs = await import('@tauri-apps/api/fs');
      const pathApi = await import('@tauri-apps/api/path');
      const tauri = await import('@tauri-apps/api/tauri');

      const filterConfig =
        type === 'image'
          ? {
              name: '图片文件',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
            }
          : {
              name: '视频文件',
              extensions: ['mp4', 'webm', 'ogg', 'mov'],
            };

      const selected = await dialog.open({
        multiple: false,
        filters: [filterConfig],
      });

      if (selected && typeof selected === 'string') {
        let stage = 'init';
        try {
          stage = 'read';
          const contents = await fs.readBinaryFile(selected);
          const fileSizeMB = contents.length / 1024 / 1024;

          // 文件大小限制
          const maxSize = type === 'image' ? 5 * 1024 * 1024 : 20 * 1024 * 1024; // 图片5MB，视频20MB
          if (contents.length > maxSize) {
            const limitMB = maxSize / 1024 / 1024;
            console.error(`File too large: ${fileSizeMB.toFixed(2)}MB > ${limitMB}MB`);
            setErrorMessage(
              `<FILE_OVERSIZE>\n` +
                `当前大小: ${fileSizeMB.toFixed(2)}MB\n` +
                `最大限制: ${limitMB}MB\n\n` +
                `[建议操作]\n` +
                `> 压缩文件后重试\n` +
                `> 使用在线 URL 地址`
            );
            return;
          }

          const ext = selected.split('.').pop()?.toLowerCase() || '';
          const mimeTypes: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
            bmp: 'image/bmp',
            mp4: 'video/mp4',
            webm: 'video/webm',
            ogg: 'video/ogg',
          };
          const mimeType = mimeTypes[ext] || 'application/octet-stream';

          // Preview uses a blob URL (fast, no base64). Persisted value is a stable AppData file URL.
          stage = 'preview';
          const blobBytes = Uint8Array.from(contents);
          const blobUrl = URL.createObjectURL(new Blob([blobBytes], { type: mimeType }));

          const fileName = `background-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext || (type === 'image' ? 'png' : 'mp4')}`;
          const relativePath = `background-media/${fileName}`;

          let persistedUrl: string;
          try {
            stage = 'persist';
            const appDataDirKey = fs.BaseDirectory.AppData;
            await fs.createDir('background-media', { dir: appDataDirKey, recursive: true });
            await fs.writeBinaryFile({ path: relativePath, contents: blobBytes }, { dir: appDataDirKey });

            stage = 'persist-url';
            const appDataDir = await pathApi.appDataDir();
            const fullPath = await pathApi.join(appDataDir, 'background-media', fileName);
            persistedUrl = tauri.convertFileSrc(fullPath);
          } catch (persistError) {
            // Fallback: reference the original file path directly if writing to AppData fails.
            console.warn('[CustomBackgroundEditor] Failed to persist media into AppData; falling back to source path.', persistError);
            persistedUrl = tauri.convertFileSrc(selected);
          }

          if (type === 'image') {
            setImageUrl(persistedUrl);
            setImagePreviewUrl((prev) => {
              if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
              return blobUrl;
            });
            setSelectionApplied(false);
          } else {
            setVideoUrl(persistedUrl);
            setVideoPreviewUrl((prev) => {
              if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
              return blobUrl;
            });
            setSelectionApplied(false);
          }
        } catch (readError) {
          console.error(`❌ File processing failed (stage=${stage}):`, readError);
          setErrorMessage(
            `<FILE_READ_ERROR>\n` +
              `文件处理失败\n\n` +
              `[阶段]\n` +
              `${stage}\n\n` +
              `[错误详情]\n` +
              `${readError instanceof Error ? readError.message : String(readError)}`
          );
          return;
        }
      }
    } catch (error) {
      console.error('文件选择错误详情:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      setErrorMessage(
        `<FILE_SELECT_ERROR>\n` +
          `文件选择失败\n\n` +
          `[错误详情]\n` +
          `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, []);

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

    if (!isActive) {
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
  }, [isActive]);

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
            效果预览
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
                  ? '框选容器内任意区域（包含背景） → 点击"确认"将该区域填满容器'
                  : '✓ 已确认 (选取的容器区域已放大填满)'}
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
                <span>预览区域</span>
                <span className="placeholder-hint">请选择或输入内容</span>
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
                    {selectionApplied ? '✓ 已确认' : '确认'}
                  </button>
                  <button className="selection-btn selection-reset-btn" onClick={handleReset}>
                    重置
                  </button>
                  <button
                    className="selection-btn selection-undo-btn"
                    onClick={handleUndo}
                    disabled={historyIndex <= 0}
                  >
                    撤销
                  </button>
                  <button
                    className="selection-btn selection-redo-btn"
                    onClick={handleRedo}
                    disabled={historyIndex >= selectionHistory.length - 1}
                  >
                    恢复
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
                  💡 选取框基于容器坐标，可框选包含背景的任意区域并放大填满
                </div>
              </>
            )}
        </div>

        {/* 显示模式 */}
        {(customType === 'image' || customType === 'video') && (imageUrl || videoUrl) && (
          <div className="config-section">
            <div className="section-title">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>显示模式</span>
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
                    '（完整显示，保持比例）'}
                  {customType === 'image' &&
                    !cropEnabled &&
                    imageFit === 'cover' &&
                    '（填满区域，可能裁边）'}
                  {customType === 'image' &&
                    !cropEnabled &&
                    imageFit === 'fill' &&
                    '（强制填满，变形拉伸）'}
                  {customType === 'video' &&
                    !cropEnabled &&
                    videoFit === 'contain' &&
                    '（完整显示，保持比例）'}
                  {customType === 'video' &&
                    !cropEnabled &&
                    videoFit === 'cover' &&
                    '（填满区域，可能裁边）'}
                  {cropEnabled && '（手动选取显示区域）'}
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
                  title="包含 - 完整显示图片（推荐）"
                >
                  完整
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && imageFit === 'cover' ? 'active' : ''}`}
                  onClick={() => {
                    setImageFit('cover');
                    setCropEnabled(false);
                  }}
                  title="覆盖 - 填充区域，可能裁剪边缘"
                >
                  填充
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && imageFit === 'fill' ? 'active' : ''}`}
                  onClick={() => {
                    setImageFit('fill');
                    setCropEnabled(false);
                  }}
                  title="拉伸 - 强制填满区域"
                >
                  拉伸
                </button>
                <button
                  className={`fit-btn ${cropEnabled ? 'active' : ''}`}
                  onClick={() => setCropEnabled(true)}
                  title="选取 - 选择图片特定区域作为背景"
                >
                  选取
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
                  title="包含 - 完整显示视频（推荐）"
                >
                  完整
                </button>
                <button
                  className={`fit-btn ${!cropEnabled && videoFit === 'cover' ? 'active' : ''}`}
                  onClick={() => {
                    setVideoFit('cover');
                    setCropEnabled(false);
                  }}
                  title="覆盖 - 填充区域，可能裁剪边缘"
                >
                  填充
                </button>
                <button
                  className={`fit-btn ${cropEnabled ? 'active' : ''}`}
                  onClick={() => setCropEnabled(true)}
                  title="选取 - 选择视频特定区域作为背景"
                >
                  选取
                </button>
              </div>
            )}
          </div>
        )}

        {/* 类型选择 */}
        <div className="config-section">
          <div className="section-title">类型选择</div>
          <div className="type-buttons">
            <button
              className={`type-btn ${customType === 'image' ? 'active' : ''}`}
              onClick={() => setCustomType('image')}
            >
              图片
            </button>
            <button
              className={`type-btn ${customType === 'video' ? 'active' : ''}`}
              onClick={() => setCustomType('video')}
            >
              视频
            </button>
            <button
              className={`type-btn ${customType === 'html' ? 'active' : ''}`}
              onClick={() => setCustomType('html')}
            >
              HTML
            </button>
          </div>
        </div>

        {/* 操作区域 - 图片 */}
        {customType === 'image' && (
          <div className="config-section">
            <div className="section-title">图片配置</div>
            <button className="file-select-btn" onClick={() => handleFileSelect('image')}>
              选择图片文件
              <span className="file-size-limit">（限制 5MB）</span>
            </button>
            <input
              type="text"
              className="url-input"
              placeholder="或输入图片 URL"
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
            <div className="section-title">视频配置</div>
            <button className="file-select-btn" onClick={() => handleFileSelect('video')}>
              选择视频文件
              <span className="file-size-limit">（限制 20MB）</span>
            </button>
            <input
              type="text"
              className="url-input"
              placeholder="或输入视频 URL"
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
            <div className="section-title">HTML 内容</div>
            <textarea
              className="html-textarea"
              placeholder="输入自定义 HTML 代码..."
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
              rows={10}
            />
            <div className="html-hint">提示：支持完整的 HTML/CSS/JavaScript 代码</div>
          </div>
        )}

        {/* 按钮区域 */}
        <div className="action-section">
          <button className="cancel-btn" onClick={handleCancel}>
            取消
          </button>
          <button className="save-btn" onClick={handleSave}>
            保存并应用
          </button>
        </div>
      </div>

      {/* 赛博风格错误弹窗 */}
      {errorMessage && (
        <div className="cyber-error-overlay" onClick={() => setErrorMessage(null)}>
          <div className="cyber-error-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cyber-error-header">
              <span className="error-icon">▲</span>
              <span className="error-title">SYSTEM ERROR</span>
            </div>
            <div className="cyber-error-body">
              <pre className="error-content">{errorMessage}</pre>
            </div>
            <div className="cyber-error-footer">
              <button className="error-btn" onClick={() => setErrorMessage(null)}>
                [确认] CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
