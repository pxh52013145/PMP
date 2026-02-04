import { useEffect, useRef } from 'react';
import { BackgroundConfig } from '../../types/background';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import './Background.css';

interface BackgroundProps {
  config: BackgroundConfig;
}

function isLikelyGifUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('data:image/gif')) return true;
  return /\.gif($|[?#&])/.test(normalized);
}

/**
 * 背景组件
 * 支持纯色、渐变、图片、视频等多种背景类型
 */
export default function Background({ config }: BackgroundProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { renderMode } = useWindowActivity();

  const imageConfig = config.type === 'image' ? config.image : undefined;
  const shouldForceOpaqueBaseForGif =
    !!imageConfig && typeof imageConfig.url === 'string' && imageConfig.url.length > 0 && isLikelyGifUrl(imageConfig.url);
  const shouldRenderImageElement =
    !!imageConfig && !!imageConfig.url && !imageConfig.crop && imageConfig.repeat === 'no-repeat';

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (config.type !== 'video') return;

    if (renderMode !== 'full') {
      try {
        video.pause();
      } catch {
        // ignore
      }
      return;
    }

    try {
      const p = video.play();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch((err) => {
          console.warn('Video autoplay failed:', err);
        });
      }
    } catch (err) {
      console.warn('Video autoplay failed:', err);
    }
  }, [config.type, config.video?.url, config.video?.loop, config.video?.muted, renderMode]);

  const getBackgroundStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      opacity: config.opacity ?? 1,
      filter: config.blur ? `blur(${config.blur}px)` : undefined,
      // Some GIFs contain transparent frames/disposal gaps; in a transparent Tauri window this can
      // show through as "flicker". Provide an opaque base so those gaps render consistently.
      backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
    };

    switch (config.type) {
      case 'color':
        return {
          ...baseStyle,
          backgroundColor: config.color || '#000000',
        };

      case 'gradient':
        if (config.gradient) {
          const { type, colors, angle } = config.gradient;
          if (type === 'linear') {
            return {
              ...baseStyle,
              background: `linear-gradient(${angle || 135}deg, ${colors.join(', ')})`,
            };
          } else {
            return {
              ...baseStyle,
              background: `radial-gradient(circle, ${colors.join(', ')})`,
            };
          }
        }
        return baseStyle;

      case 'image':
        if (config.image) {
          // 如果 URL 为空，返回纯黑背景
          if (!config.image.url) {
            return {
              ...baseStyle,
              backgroundColor: '#000000',
              opacity: config.image.opacity ?? config.opacity ?? 1,
            };
          }

          // 处理裁剪 - 使用 img 元素而不是背景图
          if (config.image.crop) {
            return {
              ...baseStyle,
              opacity: config.image.opacity ?? config.opacity ?? 1,
            };
          }

          if (shouldRenderImageElement) {
            return {
              ...baseStyle,
              opacity: config.image.opacity ?? config.opacity ?? 1,
            };
          }

          // 处理 fill 模式（拉伸）
          const backgroundSize = config.image.fit === 'fill' ? '100% 100%' : config.image.fit;

          return {
            ...baseStyle,
            backgroundImage: `url(${config.image.url})`,
            backgroundSize,
            backgroundPosition: config.image.position,
            backgroundRepeat: config.image.repeat,
            opacity: config.image.opacity ?? config.opacity ?? 1,
          };
        }
        return baseStyle;

      case 'video':
      case 'html':
        return baseStyle;

      default:
        return baseStyle;
    }
  };

  // 获取视频样式（非裁剪模式）
  const getVideoStyle = (): React.CSSProperties => {
    if (!config.video) return {};
    return {
      objectFit: config.video.fit,
      opacity: config.video.opacity ?? 1,
    };
  };

  return (
    <div className="background-container" style={getBackgroundStyle()}>
      {shouldRenderImageElement && imageConfig && (
        <img
          className="background-image"
          src={imageConfig.url}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            objectFit: imageConfig.fit === 'fill' ? 'fill' : imageConfig.fit,
            objectPosition: imageConfig.position,
            backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
          }}
        />
      )}

      {/* 图片选取背景 - 精确复制选取区域 */}
      {config.type === 'image' && config.image?.crop && config.image.url && (
        <div
          className="background-selection-wrapper"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          {/* 背景层 - 与编辑器选取时相同 */}
          <div
            style={{
              position: 'absolute',
              top: `${(-config.image.crop.y * 100) / config.image.crop.height}%`,
              left: `${(-config.image.crop.x * 100) / config.image.crop.width}%`,
              width: `${10000 / config.image.crop.width}%`,
              height: `${10000 / config.image.crop.height}%`,
              backgroundImage: `url(${config.image.url})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center center',
              backgroundRepeat: 'no-repeat',
              backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
              opacity: config.image.opacity ?? 1,
            }}
          />
        </div>
      )}

      {/* 视频背景 */}
      {config.type === 'video' && config.video && (
        <>
          {config.video.crop ? (
            <div
              className="background-selection-wrapper"
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
                  top: `${(-config.video.crop.y * 100) / config.video.crop.height}%`,
                  left: `${(-config.video.crop.x * 100) / config.video.crop.width}%`,
                  width: `${10000 / config.video.crop.width}%`,
                  height: `${10000 / config.video.crop.height}%`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <video
                  ref={videoRef}
                  className="background-selection-video"
                  src={config.video.url}
                  loop={config.video.loop}
                  muted={config.video.muted}
                  autoPlay
                  playsInline
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    opacity: config.video.opacity ?? 1,
                  }}
                />
              </div>
            </div>
          ) : (
            <video
              ref={videoRef}
              className="background-video"
              src={config.video.url}
              loop={config.video.loop}
              muted={config.video.muted}
              autoPlay
              playsInline
              style={getVideoStyle()}
            />
          )}
        </>
      )}

      {/* HTML 背景 */}
      {config.type === 'html' && config.html && (
        <div
          className="background-html"
          dangerouslySetInnerHTML={{ __html: config.html.content }}
          style={{
            opacity: config.html.opacity ?? 1,
          }}
        />
      )}
    </div>
  );
}
