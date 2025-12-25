import { describe, expect, it } from 'vitest';
import { buildPmpmSandboxSrcDoc } from '../pmpmSandboxSrcDoc';

describe('pmpmSandboxSrcDoc network gating', () => {
  it('includes deny-by-default network permission checks', () => {
    const doc = buildPmpmSandboxSrcDoc('frame-test');
    expect(doc).toContain('net:fetch');
    expect(doc).toContain('net:websocket');
    expect(doc).toContain('net:eventsource');
    expect(doc).toContain('globalThis.fetch');
  });
});

