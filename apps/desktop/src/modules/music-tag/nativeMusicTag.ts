import type {
  MusicTagCandidateSearchRequest,
  MusicTagCandidateSearchResult,
  MusicTagDbPatchRequest,
  MusicTagDbPatchResult,
  MusicTagReadLocalRequest,
  MusicTagReadLocalResult,
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
