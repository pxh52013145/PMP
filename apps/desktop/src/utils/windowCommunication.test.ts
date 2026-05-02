import { describe, expect, it } from 'vitest';

import {
  BROADCAST_DATA_UPDATE_PAYLOAD_HARD_LIMIT_BYTES,
  BROADCAST_DATA_UPDATE_PAYLOAD_SOFT_LIMIT_BYTES,
  inspectBroadcastDataUpdatePayloadBudget,
} from './windowCommunication';

describe('inspectBroadcastDataUpdatePayloadBudget', () => {
  it('keeps small config payloads below the warning threshold', () => {
    const budget = inspectBroadcastDataUpdatePayloadBudget(
      'pixel-matrix-theme-config-v1',
      JSON.stringify({ theme: 'dark', density: 'compact' }) ?? '{}'
    );

    expect(budget.reservedHeavyDomain).toBe(false);
    expect(budget.softLimitExceeded).toBe(false);
    expect(budget.hardLimitExceeded).toBe(false);
    expect(budget.shouldWarn).toBe(false);
    expect(budget.bytes).toBeLessThan(BROADCAST_DATA_UPDATE_PAYLOAD_SOFT_LIMIT_BYTES);
  });

  it('flags reserved heavy payload domains', () => {
    const budget = inspectBroadcastDataUpdatePayloadBudget(
      'pixel-matrix-music-library-cloud-fallback-audit-v1',
      JSON.stringify({
        entries: new Array(256).fill({
          id: 'track-1',
          path: '/music/very/long/path.mp3',
          coverUrl: 'pmp://cover/track-1',
        }),
      }) ?? '{}'
    );

    expect(budget.reservedHeavyDomain).toBe(true);
    expect(budget.matchedReservedHint).toBe('music-library');
    expect(budget.shouldWarn).toBe(true);
  });

  it('detects hard limit breaches', () => {
    const budget = inspectBroadcastDataUpdatePayloadBudget(
      'pixel-matrix-music-library-base-schema-v1',
      JSON.stringify({ blob: 'x'.repeat(BROADCAST_DATA_UPDATE_PAYLOAD_HARD_LIMIT_BYTES + 1) }) ?? '{}'
    );

    expect(budget.hardLimitExceeded).toBe(true);
    expect(budget.softLimitExceeded).toBe(true);
    expect(budget.shouldWarn).toBe(true);
  });
});
