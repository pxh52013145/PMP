import type { Track } from '../../../services/audio';
import { isTauriRuntime } from '../../../utils/tauriRuntime';

const MAX_EMBEDDED_COVER_URL_LENGTH = 16 * 1024;

function isAbsolutePath(pathValue: string): boolean {
  if (!pathValue) return false;
  if (pathValue.startsWith('/')) return true;
  return /^[a-zA-Z]:[\\/]/.test(pathValue);
}

export function sanitizeTrackForRuntime(track: Track | null): Track | null {
  if (!track) return null;

  let changed = false;
  const sanitized: Track = { ...track };

  if ('file' in sanitized) {
    delete sanitized.file;
    changed = true;
  }

  if ('fileContent' in sanitized) {
    delete sanitized.fileContent;
    changed = true;
  }

  const normalizedPath =
    typeof sanitized.filePath === 'string' && sanitized.filePath.trim().length > 0
      ? sanitized.filePath
      : typeof sanitized.path === 'string' && sanitized.path.trim().length > 0
        ? sanitized.path
        : '';

  const isDesktopAbsolutePath = isTauriRuntime() && isAbsolutePath(normalizedPath);

  if (isDesktopAbsolutePath && 'fileHandle' in sanitized) {
    delete sanitized.fileHandle;
    changed = true;
  }

  const coverUrl = typeof sanitized.coverUrl === 'string' ? sanitized.coverUrl.trim() : '';
  if (!coverUrl) {
    if ('coverUrl' in sanitized) {
      delete sanitized.coverUrl;
      changed = true;
    }
  } else {
    const lowerCoverUrl = coverUrl.toLowerCase();
    const isEphemeralCover = lowerCoverUrl.startsWith('data:') || lowerCoverUrl.startsWith('blob:');
    const shouldDropCover =
      coverUrl.length > MAX_EMBEDDED_COVER_URL_LENGTH ||
      (isDesktopAbsolutePath && isEphemeralCover);

    if (shouldDropCover) {
      delete sanitized.coverUrl;
      changed = true;
    } else if (sanitized.coverUrl !== coverUrl) {
      sanitized.coverUrl = coverUrl;
      changed = true;
    }
  }

  return changed ? sanitized : track;
}

export function isSameTrackRenderIdentity(previous: Track | null, next: Track | null): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.id === next.id &&
    (previous.filePath || '') === (next.filePath || '') &&
    (previous.path || '') === (next.path || '') &&
    (previous.coverKey || '') === (next.coverKey || '') &&
    (previous.coverUrl || '') === (next.coverUrl || '') &&
    (previous.title || '') === (next.title || '') &&
    (previous.artist || '') === (next.artist || '') &&
    (previous.album || '') === (next.album || '')
  );
}
