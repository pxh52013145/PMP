import type { RuntimeCapsuleState, RuntimeLifecycleParticipant } from '../../contracts/runtimeCapsule';
import type { RuntimeCapsuleManagerService } from '../runtime-capsules';
import type { ProcessPerfService } from './ProcessPerfService';

export const DEBUG_PROCESS_PERF_CAPABILITY_ID = 'debug.process-perf';

const DEBUG_PROCESS_PERF_PARTICIPANT_ID = 'performance-control.process-perf';

export interface ProcessPerfRuntimeCapsuleRegistrationOptions {
  runtimeCapsuleManager: RuntimeCapsuleManagerService;
  processPerfService: ProcessPerfService;
  onRuntimeActivityChanged?: () => void;
  refreshNow?: () => void;
}

export function registerProcessPerfRuntimeCapsuleParticipant(
  options: ProcessPerfRuntimeCapsuleRegistrationOptions
): () => void {
  let processPerfParticipantState: RuntimeCapsuleState = 'cold';

  const notifyRuntimeActivityChanged = (): void => {
    options.onRuntimeActivityChanged?.();
  };

  const participant: RuntimeLifecycleParticipant = {
    id: DEBUG_PROCESS_PERF_PARTICIPANT_ID,
    capsuleId: DEBUG_PROCESS_PERF_CAPABILITY_ID,
    onWarm: () => {
      processPerfParticipantState = 'active';
      notifyRuntimeActivityChanged();
      options.refreshNow?.();
    },
    onSuspend: (reason) => {
      processPerfParticipantState = 'suspended';
      options.processPerfService.releaseRuntimeCaches(reason.kind);
      notifyRuntimeActivityChanged();
    },
    onHibernate: (reason) => {
      processPerfParticipantState = 'hibernated';
      options.processPerfService.releaseRuntimeCaches(reason.kind);
      notifyRuntimeActivityChanged();
    },
    onTeardown: (reason) => {
      processPerfParticipantState = 'cold';
      options.processPerfService.releaseRuntimeCaches(reason.kind);
      notifyRuntimeActivityChanged();
    },
    collectSnapshot: () => {
      const snapshot = options.processPerfService.getSnapshot();
      return {
        id: DEBUG_PROCESS_PERF_PARTICIPANT_ID,
        capsuleId: DEBUG_PROCESS_PERF_CAPABILITY_ID,
        state: processPerfParticipantState,
        detail: {
          availability: snapshot.availability,
          detailLevel: snapshot.detailLevel,
          hasFullSnapshot: snapshot.fullSnapshot !== null,
          hasTotalsSnapshot: snapshot.totalsSnapshot !== null,
          lastSuccessAtMs: snapshot.lastSuccessAtMs,
        },
      };
    },
  };

  return options.runtimeCapsuleManager.registerParticipant(
    DEBUG_PROCESS_PERF_CAPABILITY_ID,
    participant
  );
}
