import { useEffect, useMemo, useState } from 'react';

import type { PlatformCompatRegistryRecord } from '../../../modules/music-platform';
import {
  createMusicTemplateWorkspaceFallbackModel,
  getMusicTemplateWorkspaceModel,
  resolveMusicTemplateWorkspaceCapabilities,
  type MusicTemplateRuntimeTarget,
  type MusicTemplateWorkspaceCapabilities,
  type MusicTemplateWorkspaceModel,
} from './musicTemplateRuntime';

export interface UseMusicTemplateWorkspaceModelParams {
  contractRecord: PlatformCompatRegistryRecord | null;
  musicRuntimeTarget: MusicTemplateRuntimeTarget | null;
}

export interface MusicTemplateWorkspaceModelController {
  workspaceModel: MusicTemplateWorkspaceModel;
  workspaceCapabilities: MusicTemplateWorkspaceCapabilities;
}

export function useMusicTemplateWorkspaceModel(
  params: UseMusicTemplateWorkspaceModelParams
): MusicTemplateWorkspaceModelController {
  const { contractRecord, musicRuntimeTarget } = params;

  const [workspaceModel, setWorkspaceModel] = useState<MusicTemplateWorkspaceModel>(() =>
    createMusicTemplateWorkspaceFallbackModel(contractRecord)
  );

  useEffect(() => {
    const fallbackModel = createMusicTemplateWorkspaceFallbackModel(contractRecord);
    setWorkspaceModel(fallbackModel);

    if (!musicRuntimeTarget) {
      return;
    }

    let cancelled = false;
    void getMusicTemplateWorkspaceModel(musicRuntimeTarget, {
      contractRecord,
    }).then((nextModel) => {
      if (!cancelled) {
        setWorkspaceModel(nextModel);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [contractRecord, musicRuntimeTarget]);

  const workspaceCapabilities = useMemo(
    () => resolveMusicTemplateWorkspaceCapabilities(workspaceModel),
    [workspaceModel]
  );

  return {
    workspaceModel,
    workspaceCapabilities,
  };
}
