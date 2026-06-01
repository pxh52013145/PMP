import type {
  ChromaprintRequest,
  ChromaprintResult,
  CoverArtDownloadRequest,
  CoverArtDownloadResult,
  CoverArtSearchRequest,
  CoverArtSearchResult,
  MusicTagBatchRequest,
  MusicTagBatchState,
  MusicTagCandidateSearchRequest,
  MusicTagCandidateSearchResult,
  MusicTagDbPatchRequest,
  MusicTagDbPatchResult,
  MusicTagReadLocalRequest,
  MusicTagReadLocalResult,
  MusicTagWriteFileRequest,
  MusicTagWriteFileResult,
} from '../../contracts/musicTag';
import { invokeWithTelemetry } from '../../services/telemetry/tauriInvokeTelemetry';
import { isTauriRuntime } from '../../utils/tauriRuntime';

export async function readLocalMusicTags(
  filePath: string
): Promise<MusicTagReadLocalResult | null> {
  const normalizedFilePath = filePath.trim();
  if (!normalizedFilePath || !isTauriRuntime()) return null;

  const request: MusicTagReadLocalRequest = {
    filePath: normalizedFilePath,
  };

  return invokeWithTelemetry<MusicTagReadLocalResult>(
    'music_tag_read_local_tags',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.local.read',
      includeResultSize: true,
    }
  );
}

export async function previewMusicTagDbPatch(
  request: MusicTagDbPatchRequest
): Promise<MusicTagDbPatchResult | null> {
  if (!isTauriRuntime() || !request.trackId.trim()) return null;

  return invokeWithTelemetry<MusicTagDbPatchResult>(
    'music_tag_preview_db_patch',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.db.preview',
      includeResultSize: true,
    }
  );
}

export async function applyMusicTagDbPatch(
  request: MusicTagDbPatchRequest
): Promise<MusicTagDbPatchResult | null> {
  if (!isTauriRuntime() || !request.trackId.trim()) return null;

  return invokeWithTelemetry<MusicTagDbPatchResult>(
    'music_tag_apply_db_patch',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.db.apply',
      includeResultSize: true,
    }
  );
}

export async function searchMusicTagCandidates(
  request: MusicTagCandidateSearchRequest
): Promise<MusicTagCandidateSearchResult | null> {
  if (!isTauriRuntime()) return null;

  return invokeWithTelemetry<MusicTagCandidateSearchResult>(
    'music_tag_search_candidates',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.candidates.search',
      includeResultSize: true,
    }
  );
}

export async function writeMusicTagFileTags(
  request: MusicTagWriteFileRequest
): Promise<MusicTagWriteFileResult | null> {
  if (!isTauriRuntime() || !request.filePath.trim()) return null;

  return invokeWithTelemetry<MusicTagWriteFileResult>(
    'music_tag_write_file_tags',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.file.write',
      includeResultSize: true,
    }
  );
}

export async function searchCoverArtCandidates(
  request: CoverArtSearchRequest
): Promise<CoverArtSearchResult | null> {
  if (!isTauriRuntime() || !request.mbidRelease.trim()) return null;

  return invokeWithTelemetry<CoverArtSearchResult>(
    'music_tag_search_cover_art',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.cover-art.search',
      includeResultSize: true,
    }
  );
}

export async function downloadCoverArt(
  request: CoverArtDownloadRequest
): Promise<CoverArtDownloadResult | null> {
  if (!isTauriRuntime() || !request.url.trim()) return null;

  return invokeWithTelemetry<CoverArtDownloadResult>(
    'music_tag_download_cover_art',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.cover-art.download',
      includeResultSize: true,
    }
  );
}

export async function generateChromaprint(
  filePath: string,
  maxDurationSeconds?: number
): Promise<ChromaprintResult | null> {
  const normalizedPath = filePath.trim();
  if (!normalizedPath || !isTauriRuntime()) return null;

  const request: ChromaprintRequest = {
    filePath: normalizedPath,
    maxDurationSeconds,
  };

  return invokeWithTelemetry<ChromaprintResult>(
    'music_tag_generate_chromaprint',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.chromaprint.generate',
      includeResultSize: true,
    }
  );
}

export async function startMusicTagBatch(
  request: MusicTagBatchRequest
): Promise<string | null> {
  if (!isTauriRuntime() || request.items.length === 0) return null;

  return invokeWithTelemetry<string>(
    'music_tag_batch_start',
    { request },
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.batch.start',
      includeResultSize: false,
    }
  );
}

export async function cancelMusicTagBatch(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;

  return invokeWithTelemetry<boolean>(
    'music_tag_batch_cancel',
    {},
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.batch.cancel',
      includeResultSize: false,
    }
  );
}

export async function getMusicTagBatchState(): Promise<MusicTagBatchState | null> {
  if (!isTauriRuntime()) return null;

  return invokeWithTelemetry<MusicTagBatchState>(
    'music_tag_batch_state',
    {},
    {
      moduleId: 'music-tag',
      component: 'nativeMusicTag',
      event: 'music-tag.batch.state',
      includeResultSize: true,
    }
  );
}
