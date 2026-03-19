import { useEffect, useMemo, useRef, useState } from 'react';
import { useWindowActivity } from '../../contexts/WindowActivityContext';
import {
  computeMediaCropLayout,
  type GeometrySize,
} from '../../modules/background/cropGeometry';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { BackgroundConfig } from '../../types/background';
import './Background.css';

interface BackgroundProps {
  config: BackgroundConfig;
}

function isLikelyGifUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  if (normalized.startsWith('data:image/gif')) return true;
  return /\.gif($|[?#&])/.test(normalized);
}

function readElementSize(element: HTMLElement | null): GeometrySize {
  if (!element) return { width: 0, height: 0 };
  return {
    width: element.clientWidth,
    height: element.clientHeight,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function Background({ config }: BackgroundProps) {
  const { renderMode } = useWindowActivity();
  const telemetry = useMemo(() => getTelemetryLogger('background', 'Background'), []);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [containerSize, setContainerSize] = useState<GeometrySize>({ width: 0, height: 0 });
  const [imageNaturalSize, setImageNaturalSize] = useState<GeometrySize | null>(null);
  const [videoNaturalSize, setVideoNaturalSize] = useState<GeometrySize | null>(null);

  const imageConfig = config.type === 'image' ? config.image : undefined;
  const videoConfig = config.type === 'video' ? config.video : undefined;
  const imageCrop = imageConfig?.crop;
  const videoCrop = videoConfig?.crop;
  const imageCropInMediaSpace = imageCrop?.space === 'media';
  const videoCropInMediaSpace = videoCrop?.space === 'media';

  const shouldForceOpaqueBaseForGif =
    !!imageConfig &&
    typeof imageConfig.url === 'string' &&
    imageConfig.url.length > 0 &&
    isLikelyGifUrl(imageConfig.url);
  const shouldRenderImageElement =
    !!imageConfig && !!imageConfig.url && !imageConfig.crop && imageConfig.repeat === 'no-repeat';

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setContainerSize(readElementSize(container));

    const observer = new ResizeObserver(() => {
      setContainerSize(readElementSize(container));
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setImageNaturalSize(null);
  }, [imageConfig?.url]);

  useEffect(() => {
    setVideoNaturalSize(null);
  }, [videoConfig?.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || config.type !== 'video') return;

    if (renderMode !== 'full') {
      try {
        video.pause();
      } catch {
        return;
      }
      return;
    }

    try {
      const playPromise = video.play();
      if (playPromise && typeof (playPromise as Promise<void>).catch === 'function') {
        (playPromise as Promise<void>).catch((error) => {
          telemetry.warn('background.video_autoplay.failed', {
            message: readErrorMessage(error),
            fields: {
              url: config.video?.url ?? null,
              renderMode,
            },
          });
        });
      }
    } catch (error) {
      telemetry.warn('background.video_autoplay.failed', {
        message: readErrorMessage(error),
        fields: {
          url: config.video?.url ?? null,
          renderMode,
        },
      });
    }
  }, [config.type, config.video?.url, config.video?.loop, config.video?.muted, renderMode, telemetry]);

  const imageCropLayout = useMemo(() => {
    if (!imageConfig?.url || !imageCrop || !imageCropInMediaSpace || !imageNaturalSize) return null;
    return computeMediaCropLayout(imageCrop, containerSize, imageNaturalSize);
  }, [containerSize, imageConfig?.url, imageCrop, imageCropInMediaSpace, imageNaturalSize]);

  const videoCropLayout = useMemo(() => {
    if (!videoConfig?.url || !videoCrop || !videoCropInMediaSpace || !videoNaturalSize) return null;
    return computeMediaCropLayout(videoCrop, containerSize, videoNaturalSize);
  }, [containerSize, videoConfig?.url, videoCrop, videoCropInMediaSpace, videoNaturalSize]);

  const getBackgroundStyle = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      opacity: config.opacity ?? 1,
      filter: config.blur ? `blur(${config.blur}px)` : undefined,
      backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
    };

    switch (config.type) {
      case 'color':
        return {
          ...baseStyle,
          backgroundColor: config.color || '#000000',
        };
      case 'gradient':
        if (!config.gradient) return baseStyle;
        if (config.gradient.type === 'linear') {
          return {
            ...baseStyle,
            background: `linear-gradient(${config.gradient.angle || 135}deg, ${config.gradient.colors.join(', ')})`,
          };
        }
        return {
          ...baseStyle,
          background: `radial-gradient(circle, ${config.gradient.colors.join(', ')})`,
        };
      case 'image':
        if (!imageConfig) return baseStyle;
        if (!imageConfig.url) {
          return {
            ...baseStyle,
            backgroundColor: '#000000',
            opacity: imageConfig.opacity ?? config.opacity ?? 1,
          };
        }
        if (imageConfig.crop || shouldRenderImageElement) {
          return {
            ...baseStyle,
            opacity: imageConfig.opacity ?? config.opacity ?? 1,
          };
        }
        return {
          ...baseStyle,
          backgroundImage: `url(${imageConfig.url})`,
          backgroundSize: imageConfig.fit === 'fill' ? '100% 100%' : imageConfig.fit,
          backgroundPosition: imageConfig.position,
          backgroundRepeat: imageConfig.repeat,
          opacity: imageConfig.opacity ?? config.opacity ?? 1,
        };
      case 'video':
      case 'html':
      default:
        return baseStyle;
    }
  };

  const getVideoStyle = (): React.CSSProperties => {
    if (!videoConfig) return {};
    return {
      objectFit: videoConfig.fit,
      opacity: videoConfig.opacity ?? 1,
    };
  };

  return (
    <div ref={containerRef} className="background-container" style={getBackgroundStyle()}>
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

      {config.type === 'image' && imageConfig?.crop && imageConfig.url && (
        imageCropInMediaSpace ? (
          <img
            className="background-selection-image"
            src={imageConfig.url}
            alt=""
            aria-hidden="true"
            draggable={false}
            onLoad={(event) => {
              setImageNaturalSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            style={{
              position: 'absolute',
              left: imageCropLayout?.left ?? 0,
              top: imageCropLayout?.top ?? 0,
              width: imageCropLayout?.width ?? '100%',
              height: imageCropLayout?.height ?? '100%',
              opacity: imageConfig.opacity ?? 1,
              backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
              pointerEvents: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          />
        ) : (
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
                top: `${(-imageConfig.crop.y * 100) / imageConfig.crop.height}%`,
                left: `${(-imageConfig.crop.x * 100) / imageConfig.crop.width}%`,
                width: `${10000 / imageConfig.crop.width}%`,
                height: `${10000 / imageConfig.crop.height}%`,
                backgroundImage: `url(${imageConfig.url})`,
                backgroundSize: 'contain',
                backgroundPosition: 'center center',
                backgroundRepeat: 'no-repeat',
                backgroundColor: shouldForceOpaqueBaseForGif ? '#000000' : undefined,
                opacity: imageConfig.opacity ?? 1,
              }}
            />
          </div>
        )
      )}

      {config.type === 'video' && videoConfig && (
        <>
          {videoConfig.crop ? (
            videoCropInMediaSpace ? (
              <video
                ref={videoRef}
                className="background-selection-video"
                src={videoConfig.url}
                loop={videoConfig.loop}
                muted={videoConfig.muted}
                autoPlay
                playsInline
                onLoadedMetadata={(event) => {
                  setVideoNaturalSize({
                    width: event.currentTarget.videoWidth,
                    height: event.currentTarget.videoHeight,
                  });
                }}
                style={{
                  position: 'absolute',
                  left: videoCropLayout?.left ?? 0,
                  top: videoCropLayout?.top ?? 0,
                  width: videoCropLayout?.width ?? '100%',
                  height: videoCropLayout?.height ?? '100%',
                  opacity: videoConfig.opacity ?? 1,
                }}
              />
            ) : (
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
                    top: `${(-videoConfig.crop.y * 100) / videoConfig.crop.height}%`,
                    left: `${(-videoConfig.crop.x * 100) / videoConfig.crop.width}%`,
                    width: `${10000 / videoConfig.crop.width}%`,
                    height: `${10000 / videoConfig.crop.height}%`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <video
                    ref={videoRef}
                    className="background-selection-video"
                    src={videoConfig.url}
                    loop={videoConfig.loop}
                    muted={videoConfig.muted}
                    autoPlay
                    playsInline
                    style={{
                      maxWidth: '100%',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      opacity: videoConfig.opacity ?? 1,
                    }}
                  />
                </div>
              </div>
            )
          ) : (
            <video
              ref={videoRef}
              className="background-video"
              src={videoConfig.url}
              loop={videoConfig.loop}
              muted={videoConfig.muted}
              autoPlay
              playsInline
              style={getVideoStyle()}
            />
          )}
        </>
      )}

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
