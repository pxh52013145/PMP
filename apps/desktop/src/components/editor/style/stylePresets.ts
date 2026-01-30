import type { DynamicColorEffect } from '../../../themes/types/theme';

/**
 * Pixel shape presets.
 */
export interface PixelShapePreset {
  id: string;
  nameKey: string;
  shape: 'circle' | 'square' | 'rounded-square' | 'diamond' | 'hexagon';
  descriptionKey: string;
}

export const PIXEL_SHAPE_PRESETS: PixelShapePreset[] = [
  {
    id: 'circle',
    nameKey: 'editor.style-editor.pixelShape.circle.name',
    shape: 'circle',
    descriptionKey: 'editor.style-editor.pixelShape.circle.desc',
  },
  {
    id: 'square',
    nameKey: 'editor.style-editor.pixelShape.square.name',
    shape: 'square',
    descriptionKey: 'editor.style-editor.pixelShape.square.desc',
  },
  {
    id: 'rounded-square',
    nameKey: 'editor.style-editor.pixelShape.rounded-square.name',
    shape: 'rounded-square',
    descriptionKey: 'editor.style-editor.pixelShape.rounded-square.desc',
  },
  {
    id: 'diamond',
    nameKey: 'editor.style-editor.pixelShape.diamond.name',
    shape: 'diamond',
    descriptionKey: 'editor.style-editor.pixelShape.diamond.desc',
  },
  {
    id: 'hexagon',
    nameKey: 'editor.style-editor.pixelShape.hexagon.name',
    shape: 'hexagon',
    descriptionKey: 'editor.style-editor.pixelShape.hexagon.desc',
  },
];

/**
 * Background effect presets.
 */
export interface BackgroundEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

export const BACKGROUND_EFFECT_PRESETS: BackgroundEffectPreset[] = [
  {
    id: 'glow-pulse',
    nameKey: 'editor.style-editor.backgroundEffect.glow-pulse.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.glow-pulse.desc',
  },
  {
    id: 'scan-line',
    nameKey: 'editor.style-editor.backgroundEffect.scan-line.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.scan-line.desc',
  },
  {
    id: 'matrix-rain',
    nameKey: 'editor.style-editor.backgroundEffect.matrix-rain.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.matrix-rain.desc',
  },
  {
    id: 'particles',
    nameKey: 'editor.style-editor.backgroundEffect.particles.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.particles.desc',
  },
  {
    id: 'none',
    nameKey: 'editor.style-editor.backgroundEffect.none.name',
    descriptionKey: 'editor.style-editor.backgroundEffect.none.desc',
  },
];

/**
 * Border effect presets.
 */
export interface BorderEffectPreset {
  id: string;
  nameKey: string;
  descriptionKey: string;
}

export const BORDER_EFFECT_PRESETS: BorderEffectPreset[] = [
  {
    id: 'standard',
    nameKey: 'editor.style-editor.borderEffect.standard.name',
    descriptionKey: 'editor.style-editor.borderEffect.standard.desc',
  },
  {
    id: 'pulse',
    nameKey: 'editor.style-editor.borderEffect.pulse.name',
    descriptionKey: 'editor.style-editor.borderEffect.pulse.desc',
  },
  {
    id: 'glitch',
    nameKey: 'editor.style-editor.borderEffect.glitch.name',
    descriptionKey: 'editor.style-editor.borderEffect.glitch.desc',
  },
  {
    id: 'none',
    nameKey: 'editor.style-editor.borderEffect.none.name',
    descriptionKey: 'editor.style-editor.borderEffect.none.desc',
  },
];

/**
 * Color theme presets.
 */
export interface ColorThemePreset {
  id: string;
  nameKey: string;
  rgb: [number, number, number];
}

export const COLOR_THEME_PRESETS: ColorThemePreset[] = [
  { id: 'cyan', nameKey: 'editor.style-editor.colorTheme.cyan', rgb: [0, 255, 136] },
  { id: 'red', nameKey: 'editor.style-editor.colorTheme.red', rgb: [255, 59, 48] },
  { id: 'blue', nameKey: 'editor.style-editor.colorTheme.blue', rgb: [10, 132, 255] },
  { id: 'purple', nameKey: 'editor.style-editor.colorTheme.purple', rgb: [191, 90, 242] },
  { id: 'gold', nameKey: 'editor.style-editor.colorTheme.gold', rgb: [255, 204, 0] },
  // Base is cyan; UI will run hue cycling.
  { id: 'rainbow', nameKey: 'editor.style-editor.colorTheme.rainbow', rgb: [0, 255, 136] },
];

export interface CoverColorEffectPreset {
  id: DynamicColorEffect;
  nameKey: string;
  descriptionKey: string;
}

export const COVER_COLOR_EFFECT_PRESETS: CoverColorEffectPreset[] = [
  {
    id: 'tone',
    nameKey: 'editor.style-editor.coverColor.effect.tone.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.tone.desc',
  },
  {
    id: 'gradient',
    nameKey: 'editor.style-editor.coverColor.effect.gradient.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.gradient.desc',
  },
  {
    id: 'dynamic',
    nameKey: 'editor.style-editor.coverColor.effect.dynamic.name',
    descriptionKey: 'editor.style-editor.coverColor.effect.dynamic.desc',
  },
];

