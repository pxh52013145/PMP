import type { AppEvents } from '../../contracts/events';
import type {
  RuntimeCapsuleState,
  RuntimeLifecycleParticipant,
} from '../../contracts/runtimeCapsule';
import type { KernelModule } from '../../kernel';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from '../../services/runtime-capsules';
import { getTelemetryLogger } from '../../services/telemetry/TelemetryService';
import { getMusicPlatformActiveInstanceState } from './activeInstanceRegistry';
import {
  listPlatformRenderSelections,
  setPlatformRenderSelectionMounted,
} from './renderSelectionRegistry';

const PLATFORM_WORKSPACE_CAPSULE_ID = 'platform.workspace';
const PLATFORM_WORKSPACE_PARTICIPANT_ID = 'music-platform.workspace-governance';

const telemetry = getTelemetryLogger('music-platform', 'platformWorkspaceGovernanceModule');

export type PlatformWorkspaceGovernanceDeps = {
  getActiveInstanceState?: typeof getMusicPlatformActiveInstanceState;
  listRenderSelections?: typeof listPlatformRenderSelections;
  setRenderSelectionMounted?: typeof setPlatformRenderSelectionMounted;
  logger?: typeof telemetry;
};

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeInstanceIds(ids: readonly string[]): string[] {
  return Array.from(
    new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function countActiveInstances(activeByConnectorId: Record<string, string>): number {
  return normalizeInstanceIds(Object.values(activeByConnectorId)).length;
}

export function createPlatformWorkspaceLifecycleParticipant(
  deps: PlatformWorkspaceGovernanceDeps = {}
): RuntimeLifecycleParticipant {
  const logger = deps.logger ?? telemetry;
  const listRenderSelections = deps.listRenderSelections ?? listPlatformRenderSelections;
  const setRenderSelectionMounted =
    deps.setRenderSelectionMounted ?? setPlatformRenderSelectionMounted;
  const getActiveInstanceState =
    deps.getActiveInstanceState ?? getMusicPlatformActiveInstanceState;

  let participantState: RuntimeCapsuleState = 'active';
  let suspendedSelectionIds: string[] = [];

  const releaseWorkspaceRuntimeResources = (reason: string) => {
    const selections = listRenderSelections();
    const mountedSelectionIds = normalizeInstanceIds(
      selections
        .filter((selection) => selection.mounted === true)
        .map((selection) => selection.instanceId)
    );
    suspendedSelectionIds = normalizeInstanceIds([
      ...suspendedSelectionIds,
      ...mountedSelectionIds,
    ]);

    let releasedSelectionCount = 0;
    for (const instanceId of mountedSelectionIds) {
      try {
        setRenderSelectionMounted(instanceId, false);
        releasedSelectionCount += 1;
      } catch (error) {
        logger.warn('platform.workspace.render-selection.release.failed', {
          message: readErrorMessage(error),
          fields: {
            reason,
            instanceId,
          },
        });
      }
    }

    logger.info('platform.workspace.cleanup.completed', {
      fields: {
        reason,
        mountedSelectionCount: mountedSelectionIds.length,
        releasedSelectionCount,
        retainedRemountSelectionCount: suspendedSelectionIds.length,
      },
    });
  };

  const remountWorkspaceRuntimeResources = (reason: string) => {
    const remountSelectionIds = suspendedSelectionIds;
    if (remountSelectionIds.length === 0) return;

    let remountedSelectionCount = 0;
    for (const instanceId of remountSelectionIds) {
      try {
        setRenderSelectionMounted(instanceId, true);
        remountedSelectionCount += 1;
      } catch (error) {
        logger.warn('platform.workspace.render-selection.remount.failed', {
          message: readErrorMessage(error),
          fields: {
            reason,
            instanceId,
          },
        });
      }
    }

    suspendedSelectionIds = [];
    logger.info('platform.workspace.remount.completed', {
      fields: {
        reason,
        remountedSelectionCount,
      },
    });
  };

  return {
    id: PLATFORM_WORKSPACE_PARTICIPANT_ID,
    capsuleId: PLATFORM_WORKSPACE_CAPSULE_ID,
    onWarm: (reason) => {
      participantState = 'active';
      remountWorkspaceRuntimeResources(`platform-workspace:${reason.kind}`);
    },
    onSuspend: () => {
      participantState = 'suspended';
    },
    onHibernate: (reason) => {
      participantState = 'hibernated';
      releaseWorkspaceRuntimeResources(`platform-workspace:${reason.kind}`);
    },
    onTeardown: (reason) => {
      participantState = 'cold';
      releaseWorkspaceRuntimeResources(`platform-workspace:${reason.kind}`);
    },
    collectSnapshot: () => {
      const selections = listRenderSelections();
      const mountedSelectionCount = selections.filter(
        (selection) => selection.mounted === true
      ).length;
      const activeState = getActiveInstanceState();

      return {
        id: PLATFORM_WORKSPACE_PARTICIPANT_ID,
        capsuleId: PLATFORM_WORKSPACE_CAPSULE_ID,
        state: participantState,
        detail: {
          activeConnectorCount: Object.keys(activeState.activeByConnectorId).length,
          activeInstanceCount: countActiveInstances(activeState.activeByConnectorId),
          renderSelectionCount: selections.length,
          mountedRenderSelectionCount: mountedSelectionCount,
          suspendedSelectionCount: suspendedSelectionIds.length,
        },
      };
    },
  };
}

export function createPlatformWorkspaceGovernanceModule(): KernelModule<AppEvents> {
  return {
    id: 'platform-workspace-governance',
    activate: ({ services }) => {
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;
      if (!runtimeCapsuleManager) return undefined;

      const participant = createPlatformWorkspaceLifecycleParticipant();
      return runtimeCapsuleManager.registerParticipant(
        PLATFORM_WORKSPACE_CAPSULE_ID,
        participant
      );
    },
  };
}
