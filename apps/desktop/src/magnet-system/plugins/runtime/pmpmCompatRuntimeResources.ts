type PmpmCompatSessionResource = {
  capabilityId: string;
  sessionId: string;
  close: (reason?: string) => Promise<void> | void;
  release?: () => void;
};

type PmpmCompatStreamResource = {
  capabilityId: string;
  streamId: string;
  cancel?: (reason?: string) => Promise<void> | void;
  dispose?: (reason?: string) => Promise<void> | void;
  release?: () => void;
};

export type PmpmCompatRuntimeResourceRegistry = {
  trackSession: (resource: PmpmCompatSessionResource) => void;
  releaseSession: (sessionId: string, capabilityId?: string) => void;
  disposeSession: (sessionId: string, reason?: string, capabilityId?: string) => Promise<boolean>;
  trackStream: (resource: PmpmCompatStreamResource) => void;
  releaseStream: (streamId: string) => void;
  cancelStream: (streamId: string, reason?: string) => Promise<boolean>;
  disposeStream: (streamId: string, reason?: string) => Promise<boolean>;
  cleanup: (reason?: string) => Promise<void>;
};

function sessionKey(capabilityId: string, sessionId: string): string {
  return `${capabilityId}::${sessionId}`;
}

function findSessionKey(
  sessions: Map<string, PmpmCompatSessionResource>,
  sessionId: string,
  capabilityId?: string
): string | null {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) return null;

  if (typeof capabilityId === 'string' && capabilityId.trim().length > 0) {
    const key = sessionKey(capabilityId.trim(), normalizedSessionId);
    return sessions.has(key) ? key : null;
  }

  for (const [key, resource] of sessions.entries()) {
    if (resource.sessionId === normalizedSessionId) {
      return key;
    }
  }

  return null;
}

async function settleResourceRelease(
  release: (() => void) | undefined,
  action: ((reason?: string) => Promise<void> | void) | undefined,
  reason?: string
): Promise<void> {
  try {
    if (typeof action === 'function') {
      await Promise.resolve(action(reason));
    }
  } finally {
    try {
      release?.();
    } catch {
      // ignore best-effort cleanup failures
    }
  }
}

export function createPmpmCompatRuntimeResourceRegistry(): PmpmCompatRuntimeResourceRegistry {
  const sessions = new Map<string, PmpmCompatSessionResource>();
  const streams = new Map<string, PmpmCompatStreamResource>();

  return {
    trackSession: (resource) => {
      const capabilityId = typeof resource.capabilityId === 'string' ? resource.capabilityId.trim() : '';
      const sessionId = typeof resource.sessionId === 'string' ? resource.sessionId.trim() : '';
      if (!capabilityId || !sessionId) return;
      sessions.set(sessionKey(capabilityId, sessionId), {
        ...resource,
        capabilityId,
        sessionId,
      });
    },
    releaseSession: (sessionId, capabilityId) => {
      const key = findSessionKey(sessions, sessionId, capabilityId);
      if (!key) return;
      const resource = sessions.get(key);
      sessions.delete(key);
      try {
        resource?.release?.();
      } catch {
        // ignore best-effort cleanup failures
      }
    },
    disposeSession: async (sessionId, reason, capabilityId) => {
      const key = findSessionKey(sessions, sessionId, capabilityId);
      if (!key) return false;
      const resource = sessions.get(key);
      sessions.delete(key);
      await settleResourceRelease(resource?.release, resource?.close, reason);
      return true;
    },
    trackStream: (resource) => {
      const capabilityId = typeof resource.capabilityId === 'string' ? resource.capabilityId.trim() : '';
      const streamId = typeof resource.streamId === 'string' ? resource.streamId.trim() : '';
      if (!capabilityId || !streamId) return;
      streams.set(streamId, {
        ...resource,
        capabilityId,
        streamId,
      });
    },
    releaseStream: (streamId) => {
      const normalizedStreamId = typeof streamId === 'string' ? streamId.trim() : '';
      if (!normalizedStreamId) return;
      const resource = streams.get(normalizedStreamId);
      streams.delete(normalizedStreamId);
      try {
        resource?.release?.();
      } catch {
        // ignore best-effort cleanup failures
      }
    },
    cancelStream: async (streamId, reason) => {
      const normalizedStreamId = typeof streamId === 'string' ? streamId.trim() : '';
      if (!normalizedStreamId) return false;
      const resource = streams.get(normalizedStreamId);
      if (!resource) return false;
      streams.delete(normalizedStreamId);
      await settleResourceRelease(resource.release, resource.cancel ?? resource.dispose, reason);
      return true;
    },
    disposeStream: async (streamId, reason) => {
      const normalizedStreamId = typeof streamId === 'string' ? streamId.trim() : '';
      if (!normalizedStreamId) return false;
      const resource = streams.get(normalizedStreamId);
      if (!resource) return false;
      streams.delete(normalizedStreamId);
      await settleResourceRelease(resource.release, resource.dispose ?? resource.cancel, reason);
      return true;
    },
    cleanup: async (reason) => {
      const activeStreams = Array.from(streams.values());
      const activeSessions = Array.from(sessions.values());
      streams.clear();
      sessions.clear();

      await Promise.allSettled(
        activeStreams.map((resource) =>
          settleResourceRelease(resource.release, resource.dispose ?? resource.cancel, reason)
        )
      );
      await Promise.allSettled(
        activeSessions.map((resource) =>
          settleResourceRelease(resource.release, resource.close, reason)
        )
      );
    },
  };
}
