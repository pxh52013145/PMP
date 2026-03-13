import { describe, expect, it } from 'vitest';
import {
  extractMagnetBorderStroke,
  normalizeMagnetOpacity,
  resolveMagnetChromeEnabled,
  resolveMagnetCurrentStyle,
  resolveMagnetInteractionState,
  resolveMagnetTransitionValue,
  toOpaqueMagnetColor,
} from '../runtimeStyle';

describe('runtimeStyle', () => {
  it('returns original base style when no interactive override applies', () => {
    const baseStyle = { width: '36px', height: '36px' };

    expect(
      resolveMagnetCurrentStyle(baseStyle, undefined, {
        isHovering: false,
        isActive: false,
        isDragging: false,
      })
    ).toBe(baseStyle);
  });

  it('applies interactive style overrides cumulatively with drag last', () => {
    expect(
      resolveMagnetCurrentStyle(
        { opacity: 0.6, transform: 'scale(1)' },
        {
          hoverStyle: { opacity: 0.7 },
          activeStyle: { transform: 'scale(0.98)' },
          dragStyle: { transform: 'scale(1.02)' },
        },
        {
          isHovering: true,
          isActive: true,
          isDragging: true,
        }
      )
    ).toEqual({ opacity: 0.7, transform: 'scale(1.02)' });
  });

  it('resolves chrome enablement from override mode first', () => {
    expect(resolveMagnetChromeEnabled({ enabled: false }, 'force-on')).toBe(true);
    expect(resolveMagnetChromeEnabled({ enabled: true }, 'force-off')).toBe(false);
    expect(resolveMagnetChromeEnabled(undefined, undefined)).toBe(true);
  });

  it('normalizes visual tokens for chrome rendering', () => {
    expect(normalizeMagnetOpacity('1.5')).toBe(1);
    expect(toOpaqueMagnetColor('rgba(10, 20, 30, 0.4)')).toBe('rgb(10, 20, 30)');
    expect(extractMagnetBorderStroke('2px solid rgba(255, 255, 255, 0.2)')).toEqual({
      width: '2px',
      color: 'rgba(255, 255, 255, 0.2)',
    });
  });

  it('resolves interaction state and transition policy', () => {
    expect(
      resolveMagnetInteractionState({
        isHovering: true,
        isActive: true,
        isDragging: false,
      })
    ).toBe('active');

    expect(resolveMagnetTransitionValue(true, false, 'opacity 120ms ease')).toBe('none');
    expect(resolveMagnetTransitionValue(false, false, 'opacity 120ms ease')).toBe(
      'opacity 120ms ease'
    );
  });
});
