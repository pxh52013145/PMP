import { open } from '@tauri-apps/api/dialog';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';

type BackgroundImportResult = {
  destPath: string;
  sourceBytes?: number;
};

function imageSizeFromUrl(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 160, height: image.naturalHeight || 160 });
    image.onerror = () => reject(new Error('Unable to decode ornament image'));
    image.src = url;
  });
}

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/*';
}

export async function importOrnamentImage(): Promise<{
  path: string;
  mime: string;
  sourceWidth: number;
  sourceHeight: number;
  name?: string;
} | null> {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'],
      },
    ],
  });
  if (!selected || typeof selected !== 'string') return null;

  const importResult = await invokeWithTelemetry<BackgroundImportResult>('background_import_media', {
    sourcePath: selected,
    kind: 'image',
    gifMaxFps: 30,
  }, {
    moduleId: 'ornaments',
    component: 'import',
    event: 'ornaments.media.import',
  });
  const path = importResult.destPath;
  const { convertFileSrc } = await import('@tauri-apps/api/tauri');
  const size = await imageSizeFromUrl(convertFileSrc(path));

  return {
    path,
    mime: mimeFromPath(path),
    sourceWidth: size.width,
    sourceHeight: size.height,
    name: selected.split(/[\\/]/).pop(),
  };
}
