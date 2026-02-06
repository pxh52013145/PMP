import { describe, expect, it } from 'vitest';
import {
  resolveEditorSkinVariant,
  shouldMinimizeEditorSkinEffects,
  shouldPauseEditorSkinMotion,
} from '../editorQualitySkin';

describe('editorQualitySkin', () => {
  it('maps quality levels to expected skin variants', () => {
    expect(resolveEditorSkinVariant('ultra', false)).toBe('neon');
    expect(resolveEditorSkinVariant('high', false)).toBe('neon');
    expect(resolveEditorSkinVariant('balanced', false)).toBe('balanced');
    expect(resolveEditorSkinVariant('low', false)).toBe('minimal');
    expect(resolveEditorSkinVariant('potato', false)).toBe('minimal');
  });

  it('forces minimal skin in low performance mode', () => {
    expect(resolveEditorSkinVariant('ultra', true)).toBe('minimal');
    expect(resolveEditorSkinVariant('balanced', true)).toBe('minimal');
  });

  it('pauses skin motion when render mode is not full', () => {
    expect(shouldPauseEditorSkinMotion('full')).toBe(false);
    expect(shouldPauseEditorSkinMotion('throttle')).toBe(true);
    expect(shouldPauseEditorSkinMotion('pause')).toBe(true);
  });

  it('reduces heavy skin effects on low tiers', () => {
    expect(shouldMinimizeEditorSkinEffects('high', false)).toBe(false);
    expect(shouldMinimizeEditorSkinEffects('balanced', false)).toBe(false);
    expect(shouldMinimizeEditorSkinEffects('low', false)).toBe(true);
    expect(shouldMinimizeEditorSkinEffects('potato', false)).toBe(true);
    expect(shouldMinimizeEditorSkinEffects('ultra', true)).toBe(true);
  });
});
