import type { RenderMode } from './performance';
import type { QualityLevel } from './quality';

export const EDITOR_SKIN_VARIANTS = ['neon', 'balanced', 'minimal'] as const;

export type EditorSkinVariant = (typeof EDITOR_SKIN_VARIANTS)[number];

export function resolveEditorSkinVariant(
  level: QualityLevel,
  lowPerformanceMode: boolean
): EditorSkinVariant {
  if (lowPerformanceMode) return 'minimal';

  if (level === 'ultra' || level === 'high') return 'neon';
  if (level === 'balanced') return 'balanced';
  return 'minimal';
}

export function shouldPauseEditorSkinMotion(renderMode: RenderMode): boolean {
  return renderMode !== 'full';
}

export function shouldMinimizeEditorSkinEffects(
  level: QualityLevel,
  lowPerformanceMode: boolean
): boolean {
  if (lowPerformanceMode) return true;
  return level === 'low' || level === 'potato';
}
