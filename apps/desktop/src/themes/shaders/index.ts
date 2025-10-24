/**
 * 着色器统一导出
 */

export { DefaultShader } from './default';
export { CyberpunkShader } from './cyberpunk';

import { DefaultShader } from './default';
import { CyberpunkShader } from './cyberpunk';
import { Shader } from '../types/shader';

/**
 * 所有内置着色器
 */
export const BUILTIN_SHADERS: Shader[] = [DefaultShader, CyberpunkShader];

/**
 * 着色器映射表
 */
export const SHADER_MAP: Record<string, Shader> = {
  [DefaultShader.id]: DefaultShader,
  [CyberpunkShader.id]: CyberpunkShader,
};
