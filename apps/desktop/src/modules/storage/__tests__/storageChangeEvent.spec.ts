import { describe, expect, it } from 'vitest';
import { PMP_STORAGE_CHANGE_EVENT, removeKey, writeString } from '../localStorage';

describe('storage change event', () => {
  it('emits PMP_STORAGE_CHANGE_EVENT on write/remove', () => {
    const events: Array<{ key: string; value: string | null }> = [];
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: string | null }>).detail;
      events.push(detail);
    };

    window.addEventListener(PMP_STORAGE_CHANGE_EVENT, handler);
    try {
      writeString('test-key', 'value');
      removeKey('test-key');
    } finally {
      window.removeEventListener(PMP_STORAGE_CHANGE_EVENT, handler);
    }

    expect(events).toEqual([
      { key: 'test-key', value: 'value' },
      { key: 'test-key', value: null },
    ]);
  });
});

