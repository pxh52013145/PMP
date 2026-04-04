import { describe, expect, it } from 'vitest';
import {
  getStreamProtocolDemoPluginDefinition,
  STREAM_PROTOCOL_DEMO_PLUGIN_ID,
  STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
} from './streamProtocolDemoPlugin';

describe('stream protocol demo plugin bundle', () => {
  it('exposes a valid PMPM demo definition with a visualizer contribution', () => {
    const parsed = getStreamProtocolDemoPluginDefinition();

    expect(parsed.manifest.metadata.id).toBe(STREAM_PROTOCOL_DEMO_PLUGIN_ID);
    expect(parsed.manifest.contributions?.visualizers).toEqual([
      expect.objectContaining({
        id: STREAM_PROTOCOL_DEMO_VISUALIZER_ID,
        title: 'Stream Protocol Lab',
      }),
    ]);
    expect(parsed.manifest.permissions).toEqual(
      expect.arrayContaining([
        'api:host',
        'api:host-capability',
        'api:audio-visual',
        'api:audio-input-adapter',
      ])
    );
    expect(parsed.entryCode).toContain('host.openStream');
    expect(parsed.entryCode).toContain('host.openSession');
    expect(parsed.entryCode).toContain('Crash Runtime');
  });
});
