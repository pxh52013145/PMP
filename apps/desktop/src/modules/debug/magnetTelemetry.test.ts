import { describe, expect, it } from 'vitest';
import type { TelemetryRecord } from '../../contracts/telemetry';
import {
  buildMagnetTelemetryAiQuery,
  matchesMagnetTelemetryRecord,
  resolveMagnetTelemetryProfile,
  summarizeTelemetryRecords,
} from './magnetTelemetry';

function createRecord(overrides: Partial<TelemetryRecord> = {}): TelemetryRecord {
  return {
    ts: 100,
    level: 'info',
    kind: 'log',
    side: 'frontend',
    moduleId: 'playlists',
    event: 'playlists.hydrate.completed',
    sessionId: 'session-1',
    component: 'Playlists',
    message: null,
    traceId: null,
    spanId: null,
    windowId: null,
    fields: null,
    ...overrides,
  };
}

describe('magnetTelemetry', () => {
  it('builds explicit registry-backed profiles for known magnets', () => {
    const profile = resolveMagnetTelemetryProfile({
      id: 'btn-playlists',
      renderer: undefined,
      name: 'Playlists',
    });

    expect(profile.source).toBe('registry');
    expect(profile.moduleIds).toContain('playlists');
    expect(profile.eventPrefixes).toContain('playlists.');
  });

  it('falls back to heuristic search for unregistered magnets', () => {
    const profile = resolveMagnetTelemetryProfile({
      id: 'custom-magnet',
      renderer: undefined,
      name: 'Custom Magnet',
    });

    expect(profile.source).toBe('heuristic');
    expect(profile.moduleIds).toEqual(['magnets']);
    expect(profile.searchTerms).toEqual(expect.arrayContaining(['custom-magnet', 'custom magnet']));
  });

  it('matches records using module and event scope', () => {
    const profile = resolveMagnetTelemetryProfile({
      id: 'btn-playlists',
      renderer: undefined,
      name: 'Playlists',
    });

    expect(matchesMagnetTelemetryRecord(createRecord(), profile)).toBe(true);
    expect(
      matchesMagnetTelemetryRecord(
        createRecord({
          moduleId: 'audio',
          event: 'audio.queue.updated',
        }),
        profile
      )
    ).toBe(false);
  });

  it('does not require fallback search terms for registry event scopes', () => {
    const profile = resolveMagnetTelemetryProfile({
      id: 'platform-magnet',
      renderer: undefined,
      name: 'Platform',
    });

    expect(
      matchesMagnetTelemetryRecord(
        createRecord({
          moduleId: 'music-platform',
          event: 'music-platform.pack.boot.store-bootstrap.failed',
          component: 'platformPackRegistry',
        }),
        profile
      )
    ).toBe(true);
  });

  it('summarizes matched telemetry buckets', () => {
    const summary = summarizeTelemetryRecords([
      createRecord(),
      createRecord({
        ts: 200,
        level: 'warn',
        event: 'playlists.cover.load.failed',
      }),
    ]);

    expect(summary.firstMatchedTs).toBe(100);
    expect(summary.lastMatchedTs).toBe(200);
    expect(summary.moduleCounts[0]).toEqual({ key: 'playlists', count: 2 });
    expect(summary.levelCounts).toEqual(
      expect.arrayContaining([
        { key: 'info', count: 1 },
        { key: 'warn', count: 1 },
      ])
    );
  });

  it('collects a broad magnets AI query surface', () => {
    const query = buildMagnetTelemetryAiQuery();
    expect(query.moduleIds).toEqual(
      expect.arrayContaining(['magnet.platform', 'music-platform', 'playlists', 'vst'])
    );
    expect(query.eventPrefixes).toEqual(
      expect.arrayContaining(['platform.', 'playlists.', 'vst.'])
    );
  });
});
