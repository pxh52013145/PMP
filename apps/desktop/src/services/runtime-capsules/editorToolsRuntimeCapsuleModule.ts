import type { AppEvents } from '../../contracts/events';
import type { RuntimeCapsuleState, RuntimeLifecycleParticipant } from '../../contracts/runtimeCapsule';
import { createServiceToken, type KernelModule } from '../../kernel';
import { invokeWithTelemetry } from '../telemetry/tauriInvokeTelemetry';
import { getTelemetryLogger } from '../telemetry/TelemetryService';
import { isTauriRuntime } from '../../utils/tauriRuntime';
import {
  RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN,
  type RuntimeCapsuleManagerService,
} from './RuntimeCapsuleManagerService';

const EDITOR_TOOLS_CAPSULE_ID = 'editor.tools';
const EDITOR_TOOLS_PARTICIPANT_ID = 'editor-tools.main-window';
const EDITOR_TOOLS_LEASE_KEY = 'editor.tools:main-window';

export interface EditorToolsRuntimeActivity {
  isEditing: boolean;
  editorMode: string;
  selectedMagnetId: string | null;
  selectedPixelCount: number;
  isEditorAuxWindowFocused: boolean;
  isMainWindowFocused: boolean;
  isMainWindowVisible: boolean;
  isDocumentVisible: boolean;
  isMainWindowMinimized: boolean;
  isPageFrozen: boolean;
  isWindowActive: boolean;
  shouldPollEditorAuxFocus: boolean;
}

export interface EditorToolsRuntimeCapsuleService {
  updateActivity(activity: EditorToolsRuntimeActivity): void;
  clearActivity(detail?: string): void;
  teardown(detail?: string): void;
  dispose(): void;
}

export const EDITOR_TOOLS_RUNTIME_CAPSULE_SERVICE_TOKEN =
  createServiceToken<EditorToolsRuntimeCapsuleService>('service.editorToolsRuntimeCapsule');

const telemetry = getTelemetryLogger('editor', 'editorToolsRuntimeCapsuleModule');

function activityToDetail(activity: EditorToolsRuntimeActivity): Record<string, unknown> {
  return {
    isEditing: activity.isEditing,
    editorMode: activity.editorMode,
    selectedMagnetId: activity.selectedMagnetId,
    selectedPixelCount: activity.selectedPixelCount,
    isEditorAuxWindowFocused: activity.isEditorAuxWindowFocused,
    isMainWindowFocused: activity.isMainWindowFocused,
    isMainWindowVisible: activity.isMainWindowVisible,
    isDocumentVisible: activity.isDocumentVisible,
    isMainWindowMinimized: activity.isMainWindowMinimized,
    isPageFrozen: activity.isPageFrozen,
    isWindowActive: activity.isWindowActive,
    shouldPollEditorAuxFocus: activity.shouldPollEditorAuxFocus,
  };
}

async function cleanupHiddenEditorWindows(reason: string): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const destroyedHiddenEditorWindowCount = await invokeWithTelemetry<number>(
      'governance_destroy_hidden_editor_windows',
      undefined,
      {
        moduleId: 'editor',
        component: 'editorToolsRuntimeCapsuleModule',
        event: 'editor.tools.hidden-windows.destroy',
        successLevel: 'info',
      }
    );
    telemetry.info('editor.tools.cleanup.completed', {
      fields: {
        reason,
        destroyedHiddenEditorWindowCount,
      },
    });
  } catch (error) {
    telemetry.warn('editor.tools.cleanup.failed', {
      message: error instanceof Error ? error.message : String(error),
      fields: {
        reason,
      },
    });
  }
}

export class DefaultEditorToolsRuntimeCapsuleService implements EditorToolsRuntimeCapsuleService {
  private participantState: RuntimeCapsuleState = 'cold';
  private participantDetail: Record<string, unknown> = {};
  private activeLeaseId: string | null = null;
  private teardownPending = false;
  private disposed = false;
  private readonly unregisterParticipant: () => void;

  constructor(private readonly runtimeCapsuleManager: RuntimeCapsuleManagerService) {
    const participant: RuntimeLifecycleParticipant = {
      id: EDITOR_TOOLS_PARTICIPANT_ID,
      capsuleId: EDITOR_TOOLS_CAPSULE_ID,
      onWarm: () => {
        this.participantState = 'active';
      },
      onSuspend: (reason) => {
        this.participantState = 'suspended';
        this.mergeDetail({ lastSuspendReason: reason.detail ?? reason.kind });
      },
      onFreeze: (reason) => {
        this.participantState = 'frozen';
        this.mergeDetail({ lastFreezeReason: reason.detail ?? reason.kind });
      },
      onHibernate: async (reason) => {
        this.participantState = 'hibernated';
        const detail = reason.detail ?? reason.kind;
        this.mergeDetail({ lastHibernateReason: detail });
        await cleanupHiddenEditorWindows(`editor-tools:${detail}`);
      },
      onTeardown: async (reason) => {
        this.participantState = 'tearing_down';
        const detail = reason.detail ?? reason.kind;
        this.mergeDetail({ lastTeardownReason: detail });
        await cleanupHiddenEditorWindows(`editor-tools:${detail}`);
        this.participantState = 'cold';
      },
      collectSnapshot: () => ({
        id: EDITOR_TOOLS_PARTICIPANT_ID,
        capsuleId: EDITOR_TOOLS_CAPSULE_ID,
        state: this.participantState,
        listeners: this.participantDetail.shouldPollEditorAuxFocus === true ? 1 : 0,
        detail: this.participantDetail,
      }),
    };

    this.unregisterParticipant = runtimeCapsuleManager.registerParticipant(
      EDITOR_TOOLS_CAPSULE_ID,
      participant
    );
  }

  updateActivity(activity: EditorToolsRuntimeActivity): void {
    if (this.disposed) return;
    if (activity.isEditing) {
      this.teardownPending = false;
    }
    this.participantDetail = activityToDetail(activity);
    if (this.teardownPending) {
      this.releaseLease('editor tools teardown pending');
      return;
    }
    this.syncLease(activity);
  }

  clearActivity(detail = 'editor tools activity cleared'): void {
    this.participantDetail = {
      ...this.participantDetail,
      isEditing: false,
      isEditorAuxWindowFocused: false,
      clearReason: detail,
    };
    this.releaseLease(detail);
  }

  teardown(detail = 'edit mode exited'): void {
    if (this.disposed) return;
    this.teardownPending = true;
    this.clearActivity(detail);
    const reclaimed = this.runtimeCapsuleManager.reclaimInactiveCapsules({
      mode: 'teardown',
      minMemoryTier: 'heavy',
      bypassWarmRetention: true,
      targetCapsuleIds: [EDITOR_TOOLS_CAPSULE_ID],
      reason: {
        kind: 'window-hidden',
        sourceId: EDITOR_TOOLS_PARTICIPANT_ID,
        detail,
      },
    });
    telemetry.info('editor.tools.teardown.requested', {
      fields: {
        detail,
        reclaimed: reclaimed.some((item) => item.capsuleId === EDITOR_TOOLS_CAPSULE_ID),
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseLease('editor tools capsule service disposed');
    this.unregisterParticipant();
  }

  private syncLease(activity: EditorToolsRuntimeActivity): void {
    const shouldRetainEditorToolsLease = activity.isEditing || activity.isEditorAuxWindowFocused;
    if (!shouldRetainEditorToolsLease) {
      this.releaseLease('editor tools inactive');
      return;
    }

    const detail = activity.isEditing
      ? 'matrix editor mode active'
      : 'editor auxiliary window focused';
    const priority = activity.isEditing ? 'foreground' : 'normal';
    if (this.activeLeaseId) {
      const renewed = this.runtimeCapsuleManager.renewLease(this.activeLeaseId, {
        priority,
        reason: {
          routeId: 'matrix-workbench',
          detail,
        },
      });
      if (renewed) return;
      this.activeLeaseId = null;
    }

    const lease = this.runtimeCapsuleManager.acquireLease({
      capabilityId: EDITOR_TOOLS_CAPSULE_ID,
      leaseKey: EDITOR_TOOLS_LEASE_KEY,
      ownerKind: 'window',
      ownerId: EDITOR_TOOLS_PARTICIPANT_ID,
      priority,
      reason: {
        routeId: 'matrix-workbench',
        detail,
      },
    });
    this.activeLeaseId = lease?.id ?? null;
  }

  private releaseLease(detail: string): void {
    if (!this.activeLeaseId) return;
    this.runtimeCapsuleManager.releaseLease(this.activeLeaseId, {
      kind: 'lease-expired',
      sourceId: EDITOR_TOOLS_PARTICIPANT_ID,
      detail,
    });
    this.activeLeaseId = null;
  }

  private mergeDetail(detail: Record<string, unknown>): void {
    this.participantDetail = {
      ...this.participantDetail,
      ...detail,
    };
  }
}

export function createEditorToolsRuntimeCapsuleModule(): KernelModule<AppEvents> {
  return {
    id: 'editor-tools-runtime-capsule',
    activate({ services }) {
      const runtimeCapsuleManager = services.getOptional(
        RUNTIME_CAPSULE_MANAGER_SERVICE_TOKEN
      ) as RuntimeCapsuleManagerService | null;
      if (!runtimeCapsuleManager) return undefined;

      const service = new DefaultEditorToolsRuntimeCapsuleService(runtimeCapsuleManager);
      const unregisterService = services.register(EDITOR_TOOLS_RUNTIME_CAPSULE_SERVICE_TOKEN, service);
      return () => {
        service.dispose();
        unregisterService();
      };
    },
  };
}
