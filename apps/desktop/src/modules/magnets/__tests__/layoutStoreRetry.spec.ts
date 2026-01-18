import { describe, expect, it } from 'vitest';
import {
  magnetLayoutStoreApplyPatchWithRetry,
  type MagnetLayoutStoreApplyPatchFn,
  type MagnetLayoutStoreApplyPatchRequest,
  type MagnetLayoutStoreApplyPatchResponse,
  type MagnetLayoutStoreState,
} from '../index';

function createBaseState(revision: number): MagnetLayoutStoreState {
  return {
    version: 1,
    revision,
    spaces: {
      version: 1,
      activeSpaceId: 'space1',
      spaces: [{ id: 'space1', name: 'space1', order: 1, createdAt: 0 }],
    },
    layoutsBySpaceId: {},
    presetsBySpaceId: {},
    historyBySpaceId: {},
  };
}

describe('magnetLayoutStoreApplyPatchWithRetry', () => {
  it('returns immediately when ok=true', async () => {
    const requests: MagnetLayoutStoreApplyPatchRequest[] = [];
    const applyPatch: MagnetLayoutStoreApplyPatchFn = async (request) => {
      requests.push(request);
      const response: MagnetLayoutStoreApplyPatchResponse = {
        ok: true,
        state: createBaseState(1),
        error: null,
      };
      return response;
    };

    const response = await magnetLayoutStoreApplyPatchWithRetry(
      { expectedRevision: 1, patches: [], reason: 'ok' },
      { applyPatch, maxRetries: 2 }
    );

    expect(response?.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.expectedRevision).toBe(1);
    expect(requests[0]?.reason).toBe('ok');
  });

  it('retries once on revisionConflict and succeeds', async () => {
    const requests: MagnetLayoutStoreApplyPatchRequest[] = [];
    const applyPatch: MagnetLayoutStoreApplyPatchFn = async (request) => {
      requests.push(request);
      if (requests.length === 1) {
        const response: MagnetLayoutStoreApplyPatchResponse = {
          ok: false,
          state: createBaseState(2),
          error: { code: 'revisionConflict', message: 'conflict' },
        };
        return response;
      }
      const response: MagnetLayoutStoreApplyPatchResponse = {
        ok: true,
        state: createBaseState(3),
        error: null,
      };
      return response;
    };

    const response = await magnetLayoutStoreApplyPatchWithRetry(
      { expectedRevision: 1, patches: [], reason: 'switchToSpace' },
      { applyPatch, maxRetries: 2 }
    );

    expect(response?.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.expectedRevision).toBe(1);
    expect(requests[0]?.reason).toBe('switchToSpace');
    expect(requests[1]?.expectedRevision).toBe(2);
    expect(requests[1]?.reason).toBe('switchToSpace:retry');
  });

  it('does not retry when maxRetries=0', async () => {
    const requests: MagnetLayoutStoreApplyPatchRequest[] = [];
    const applyPatch: MagnetLayoutStoreApplyPatchFn = async (request) => {
      requests.push(request);
      const response: MagnetLayoutStoreApplyPatchResponse = {
        ok: false,
        state: createBaseState(2),
        error: { code: 'revisionConflict', message: 'conflict' },
      };
      return response;
    };

    const response = await magnetLayoutStoreApplyPatchWithRetry(
      { expectedRevision: 1, patches: [], reason: 'noRetry' },
      { applyPatch, maxRetries: 0 }
    );

    expect(response?.ok).toBe(false);
    expect(requests).toHaveLength(1);
  });
});

